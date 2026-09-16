# DSH IDE 插件 — 技术设计文档

> 在 dsh Web GUI 的「会话 / 轨迹」tab 后面新增「IDE」tab，点击后呈现 VSCode Web 风格的代码编辑器界面，默认 VSCode「Dark Modern」深色主题。第一版为**只读查看器**（浏览 / 打开 / 查看 workspace 文件），编辑器状态挂在当前 session 上。

---

## 1. 背景与已验证事实

本设计基于对 DSH 0.1.5-rc.2 实际安装包源码的逆向调研，所有 API 均已确认存在且可用。

### 1.1 Tab 注册机制

会话 tab（`ui-chat`）与轨迹 tab（`ui-trajectory`）都是通过注册 `conversation.view` 这个 slot 实现的：

- slot 类型：`list`，`scope: "session"`（每个 session 绑定一次）
- 注册调用：`ctx.slots.inject("conversation.view", () => ctx.slots.register(opts, Component))`
- 排序由 `opts.order` 决定：chat=`0`，trajectory=`10`
- `opts.id` 是 tab 唯一标识，`opts.label` 是 tab 标题（支持函数返回本地化文本）
- `opts.inject(sessionId)` 返回注入给组件的 props（hooks、回调等）
- `opts.children` 声明子 slot
- 视图选择规则：持久化的偏好优先 → 否则 `chat` → 否则不渲染

**IDE tab 设 `order: 20`，id: `"ide"`，排在轨迹后面。**

### 1.2 插件打包结构

每个浏览器插件是独立 npm 包，双入口：

```
@deepseek-ai/dsh-client-ui-ide/
├── package.json          # dsh.client.inject 声明依赖
├── cordis.patch.yml      # 可选，本插件不需要 host 行
├── src/                  # TypeScript 源码
│   ├── index.ts          # host 端空 apply（无 host 行为）
│   └── client/           # 浏览器端
│       ├── index.ts      # apply(ctx)：注册 tab + 字典 + view
│       ├── IdeView.tsx   # IDE 主组件
│       ├── explorer/     # 文件资源管理器
│       ├── editor/       # Monaco 编辑器封装
│       ├── theme.ts      # Dark Modern 主题数据
│       └── locales.ts    # i18n
├── lib/                  # 构建产物（tsdown 产出）
│   ├── index.js
│   ├── client.js         # window.__ModuleLoader__.load 工厂
│   └── types/**/*.d.ts
└── README.md
```

**装载方式**：在 web profile 的 `cordis.patch.yml` 浏览器 roster 加一行，或用 `dsh plugin --profile web add <包路径>`。

### 1.3 文件读写 API（关键限制）

`@deepseek-ai/dsh-api-workspace-files` 服务（前端经 `ctx.remote.workspaceFiles` 调用）：

| 方法 | 用途 |
|---|---|
| `stat(sessionId, path, signal)` | 文件元信息 `{ absolutePath, version, bytes? }` |
| `read(sessionId, path, {offset,limit}, signal)` | UTF-8 文本按行分页 `{ text, lines, eof, offset, version }` |
| `readBytes(sessionId, path, {offset,length}, signal)` | 原始字节窗口（base64） |
| `readAll(sessionId, path, signal)` | 完整字节（≤32MB） |
| `list(sessionId, path, signal)` | 目录子项 `{ entries, truncated }` |
| `changes(sessionId, signal)` | 文件变更流（`{kind:"ready"}` 后 `{kind:"change",change}`） |

**该服务明确无写操作。** 第一版只读，完全匹配此服务能力。后续加写需新增 host 端 API。

### 1.4 Session 与 workspace 根

- `ctx.sessions` 是 session 列表 store，`useSessions((s) => s.byId[sessionId]?.cwd)` 取当前 session 的 workspace 根目录
- 文件路径可绝对（相对 workspace 根解析）或相对
- IDE tab 的 view 注册 `inject(sessionId)` 会拿到当前 session id

### 1.5 编辑器选型

DSH 依赖树无 Monaco/CodeMirror/Shiki/Prism。本插件**自带 Monaco Editor**（`monaco-editor`）作为 `dependencies`，因为：
- VSCode 同款内核，「VSCode Web IDE 风格 + Dark Modern」还原度最高
- Monaco 内置 `vs-dark` 基础主题，可定义与 VSCode「Dark Modern」等价的 token 颜色
- 自带 web-worker、语法高亮、minimap、命令面板、多标签

---

## 2. 架构设计

### 2.1 组件树

```
IdeView (conversation.view slot 组件)
├── ActivityBar          # 最左 48px 竖条：explorer/search/git/extensions 图标（explorer/search/git 可用，debug/extensions 占位禁用）
├── SideBar              # 240px：根据 activity bar 选中项切换
│   ├── (explorer) FileTree          # 递归文件树（lazy 展开，复用 workspaceFiles.list）
│   ├── (search) SearchPanel          # 工作区 grep（复用 ideTools.search）
│   └── (git) SourceControlPanel      # 源代码管理：分支信息 + 变更文件列表
├── EditorArea
│   ├── TabBar / DiffEditor           # 普通 tab 或 git diff 视图（互斥）
│   ├── MonacoEditor                  # Monaco 实例，只读模式
│   └── StatusBar                     # 底部状态栏
└── TerminalPanel (底部 dock)
```

布局用 CSS Grid / Flex，颜色全部从 Dark Modern 主题 token 取值。

### 2.2 数据流

```
workspaceFiles.list(sessionId, '', signal)
    → 文件树根目录 entries
用户点击文件
    → workspaceFiles.stat(sessionId, path) 取 version/bytes
    → workspaceFiles.read(sessionId, path, {offset:1, limit:maxLines}) 取首页
    → 文件 ≤ maxFileBytes(32MB) 时 readAll 一次性加载；否则分页 + 虚拟滚动提示
文件变更
    → workspaceFiles.changes(sessionId, signal) 流订阅
    → 收到 {absolutePath, version} 时刷新对应已打开文件
Monaco 只读
    → model.setValue(text)，editor.updateOptions({readOnly:true})
```

### 2.3 状态归属（挂 session）

- `inject(sessionId)` 每次绑定 session 时重建 IDE 实例的 store
- 已打开文件列表、当前活动文件、文件树展开状态、光标位置 → 都挂在当前 session
- 切换 session → IDE 状态重置（符合 `conversation.view` 的 `scope: session` 语义）
- 不做跨 session 持久化（首版范围外）

### 2.4 与现有右侧栏的关系

首版**自渲染文件树**（不与 `ui-sidebar-files` / `ui-sidebar-documentpreview` 联动），保持 IDE 界面自包含。两者数据源相同（都是 `workspaceFiles`），但 UI 独立。

---

## 3. 关键实现细节

### 3.1 package.json

```json
{
  "name": "@deepseek-ai/dsh-client-ui-ide",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-api-session-controller",
        "@deepseek-ai/dsh-api-workspace-files",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-session"
      ],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.2"
  },
  "dependencies": {
    "monaco-editor": "^0.52.0"
  },
  "devDependencies": {
    "@types/react": "~18.3.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@deepseek-ai/cordis": "^4.0.2",
    "tsdown": "^0.11.0",
    "typescript": "^5.6.0"
  },
  "scripts": {
    "bundle": "tsdown",
    "watch": "tsdown --watch"
  }
}
```

### 3.2 host 端入口 src/index.ts

```ts
// host 端无行为，符合 ui-trajectory 的空 apply 模式
export function apply() {}
```

### 3.3 client 端入口 src/client/index.ts（核心）

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-ui-renderer'
import { IdeView } from './IdeView.js'
import { zh, en } from './locales.js'

const NS = 'ide'

// 必需的浏览器服务。"remote.workspaceFiles" 是 workspaceFiles 命名空间 Remote。
const inject = [
  'slots',
  'sessions',
  'locale',
  'remote',
  'remote.workspaceFiles',
] as const

export { inject }

export function apply(ctx: ClientContext<typeof inject>) {
  // 1. 注册字典
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-ide: dictionaries')
  const t = ctx.locale.bind(NS)

  // 2. 注册 IDE view tab —— 排在 trajectory(order:10) 后面
  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'ide',
        order: 20,
        locale: NS,
        label: () => t('view.ide'),
        // 注入给 IdeView 的 props：当前 session id + workspaceFiles 句柄
        inject: (sessionId) => {
          const sessions = ctx.sessions.list.getSnapshot()
          const cwd = sessions.byId[sessionId]?.cwd
          return {
            sessionId,
            cwd,
            // 透传 remote.workspaceFiles 给组件内部用
            workspaceFiles: ctx.remote.workspaceFiles,
            // 变更流订阅句柄
            subscribeChanges: (signal: AbortSignal) =>
              ctx.remote.workspaceFiles.changes(sessionId, signal),
          }
        },
      },
      IdeView,
    ),
  )
}
```

### 3.4 IdeView.tsx 骨架

```tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import * as monaco from 'monaco-editor'
import { defineDarkModernTheme } from './theme.js'
import { FileTree } from './explorer/FileTree.js'
import { TabBar } from './editor/TabBar.js'
import { StatusBar } from './editor/StatusBar.js'
import { DARK_MODERN_TOKENS } from './theme.js'

interface IdeViewProps {
  sessionId: string
  cwd?: string
  workspaceFiles: WorkspaceFilesRemote
  subscribeChanges: (signal: AbortSignal) => AsyncIterable<WatchFrame>
}

export function IdeView(props: IdeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>()
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])      // 挂 session
  const [activePath, setActivePath] = useState<string>()
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  // 1. 初始化 Monaco + Dark Modern 主题（全局一次）
  useEffect(() => {
    defineDarkModernTheme(monaco)
    monaco.editor.defineTheme('dsh-dark-modern', DARK_MODERN_TOKENS)
  }, [])

  // 2. 创建 editor 实例（只读）
  useEffect(() => {
    if (!containerRef.current) return
    editorRef.current = monaco.editor.create(containerRef.current, {
      theme: 'dsh-dark-modern',
      readOnly: true,                 // ← 第一版只读
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 13,
      lineHeight: 20,
      scrollBeyondLastLine: false,
      fontFamily: 'var(--ds-font-family-code, Menlo, monospace)',
    })
    return () => editorRef.current?.dispose()
  }, [])

  // 3. 打开文件：stat → readAll(小) 或 read 分页(大)
  const openFile = useCallback(async (path: string) => {
    const wf = props.workspaceFiles
    const stat = await wf.stat(props.sessionId, path)
    let text: string
    if (stat.bytes && stat.bytes > 2 * 1024 * 1024) {
      // 大文件：只读首页 + 提示
      const page = await wf.read(props.sessionId, path, { offset: 1, limit: 5000 })
      text = page.text + (page.eof ? '' : '\n[文件过大，仅显示前 5000 行]...')
    } else {
      const bytes = await wf.readAll(props.sessionId, path)
      text = new TextDecoder().decode(uint8FromBase64(bytes.data))
    }
    const lang = detectLanguage(path)
    const model = monaco.editor.createModel(text, lang)
    // 加入 openTabs，切换 activePath，editor.setModel(model)
  }, [props.sessionId, props.workspaceFiles])

  // 4. 订阅文件变更，刷新已打开文件
  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      for await (const frame of props.subscribeChanges(ctrl.signal)) {
        if (frame.kind === 'change') {
          // 比对 version，重新 read 已打开的同路径文件
        }
      }
    })()
    return () => ctrl.abort()
  }, [props.sessionId])

  return (
    <div className="ide-root" style={DARK_MODERN_TOKENS.cssVars}>
      <ActivityBar />
      <SideBar>
        <FileTree
          sessionId={props.sessionId}
          cwd={props.cwd}
          workspaceFiles={props.workspaceFiles}
          expanded={expandedDirs}
          onToggle={setExpandedDirs}
          onOpenFile={openFile}
        />
      </SideBar>
      <main className="ide-editor-area">
        <TabBar tabs={openTabs} active={activePath} onSelect={setActivePath} onClose={...} />
        <div ref={containerRef} className="ide-monaco-container" />
        <StatusBar active={activePath} tabs={openTabs} />
      </main>
    </div>
  )
}
```

### 3.5 Dark Modern 主题 src/client/theme.ts

VSCode「Dark Modern」核心色板（从 VSCode 源 `dark_modern.json` 提取的等价值）：

```ts
export const DARK_MODERN_TOKENS = {
  cssVars: {
    // 布局色
    '--ide-bg': '#1f1f1f',           // editor background
    '--ide-sidebar-bg': '#181818',   // activity bar + sidebar
    '--ide-tab-bg': '#252526',
    '--ide-tab-active-bg': '#1f1f1f',
    '--ide-statusbar-bg': '#1e1e1e',
    '--ide-border': '#2b2b2b',
    // 前景
    '--ide-fg': '#cccccc',
    '--ide-fg-muted': '#9d9d9d',
    '--ide-accent': '#0e639c',      // selection/active (VSCode blue)
    '--ide-accent-hover': '#1177bb',
  },
  monaco: {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a9955' },   // 绿注释
      { token: 'keyword', foreground: '569cd6' },     // 蓝 keyword
      { token: 'string', foreground: 'ce9178' },     // 橙字符串
      { token: 'number', foreground: 'b5cea8' },
      { token: 'type', foreground: '4ec9b0' },
      { token: 'function', foreground: 'dcdcaa' },
      { token: 'variable', foreground: '9cdcfe' },
      { token: 'tag', foreground: '569cd6' },
    ],
    colors: {
      'editor.background': '#1f1f1f',
      'editor.foreground': '#cccccc',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editor.selectionBackground': '#264f78',
      'editor.lineHighlightBackground': '#2a2a2a',
      'editorCursor.foreground': '#aeafad',
      'editorIndentGuide.background': '#404040',
      'editorIndentGuide.activeBackground': '#707070',
      'editorGutter.background': '#1f1f1f',
      'scrollbarSlider.background': '#79797966',
      'minimap.background': '#1f1f1f',
      'sideBar.background': '#181818',
      'activityBar.background': '#181818',
      'statusBar.background': '#1e1e1e',
      'tab.activeBackground': '#1f1f1f',
      'tab.inactiveBackground': '#252526',
    },
  },
}

export function defineDarkModernTheme(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme('dsh-dark-modern', DARK_MODERN_TOKENS.monaco as any)
}
```

### 3.6 文件树 src/client/explorer/FileTree.tsx

```tsx
// 递归树，lazy 展开：点击目录 → workspaceFiles.list(sessionId, path)
// 点击文件 → props.onOpenFile(path)
// entries: { name, kind: 'file'|'directory', absolutePath }[]
// 用 DSH 的 --ide-* CSS 变量着色
```

### 3.7 Monaco web-worker 配置

Monaco 需要 language worker（JSON/TS/CSS/HTML）。在 Vite/打包环境用 `monaco-editor/esm/vs/editor/editor.worker`：

```ts
// src/client/editor/workers.ts
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'typescript') return new tsWorker()
    if (label === 'css') return new cssWorker()
    if (label === 'html') return new htmlWorker()
    return new editorWorker()
  },
}
```

tsdown 需配置 `worker` 格式输出（或用 `monaco-editor` 的 AMD loader 回退方案，避免 worker 模块依赖——**作为构建期 Plan B**）。

---

## 4. 构建配置

### 4.1 tsdown.config.ts

```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client/index.ts',
  },
  format: 'esm',
  dts: true,
  // Monaco 体积大，client.js 会包含编辑器；接受单 bundle（与 ui-trajectory 8259 行同模式）
  // worker 用独立 chunk 或内联 base64（构建期决定）
})
```

### 4.2 体积预期

- `monaco-editor` 全量 gzip ~3MB。首版可接受（IDE 是按需打开的 tab，不进入首屏）。
- 后续优化：用 `monaco-editor/esm/vs/editor/editor.api` 按需引入语言，减小到 ~1MB。

---

## 5. 安装与装载

### 5.1 构建

```sh
cd /Users/fengzy/Documents/gitmy/dsh-web-ide
pnpm install
pnpm run bundle     # 产出 lib/index.js + lib/client.js + lib/types/**
```

### 5.2 装入 web profile

```sh
# 方式 A：dsh plugin 转发给 pnpm
dsh plugin --profile web add /Users/fengzy/Documents/gitmy/dsh-web-ide

# 方式 B：手动在 web profile 的 package.json 加依赖
#   "@deepseek-ai/dsh-client-ui-ide": "file:/Users/fengzy/Documents/gitmy/dsh-web-ide"
# 然后在 cordis.patch.yml 浏览器 roster 加：
#   - id: ui-ide
#     name: '@deepseek-ai/dsh-client-ui-ide'
```

`dsh plugin` 的 reconcile 会自动把声明了 `dsh.bundle` 的包加入 `dsh.profile.bundles` 层栈。本插件**不**声明 `dsh.bundle`（无 host patch），仅靠 `dsh.client` 的浏览器 roster 行生效——与 `ui-trajectory` 一致（trajectory 也无 cordis.patch.yml）。

### 5.3 验证

1. 重启 `dsh --profile web`（或等 client-hmr 热更，需 `pnpm run dev:web` 同时跑）
2. 打开 GUI，新建/打开一个 session
3. 会话 / 轨迹 tab 后应出现「IDE」tab
4. 点击 → VSCode 风格界面，Dark Modern 配色
5. 文件树展开 workspace，点击文件 → Monaco 只读打开

---

## 6. 第一版范围（已确认）

| 项 | 状态 |
|---|---|
| IDE tab 注册到 conversation.view，order:20 排在轨迹后 | ✅ 做 |
| VSCode 风格布局（活动栏+资源管理器+编辑区+标签页+状态栏） | ✅ 做 |
| Dark Modern 主题（Monaco + CSS token） | ✅ 做 |
| 浏览/打开/查看 workspace 文件（workspaceFiles API） | ✅ 做 |
| Monaco 只读编辑（高亮、minimap、行号、查找） | ✅ 做 |
| 文件变更流刷新已打开文件 | ✅ 做 |
| 文件保存/写操作 | ❌ 不做（workspaceFiles 无写 API） |
| 终端、搜索面板、Git、扩展、设置 | ❌ 不做 |
| 跨 session 状态持久化 | ❌ 不做 |
| 与右侧栏 sidebar-files 联动 | ❌ 不做（自渲染树） |

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Monaco worker 在 DSH 模块加载器（`window.__ModuleLoader__`）下可能不兼容 | Plan B：用 Monaco AMD loader（`monaco-editor/min/vs/loader.js` + `require.config`），绕过 ESM worker |
| `conversation.view` scope=session 导致无 session 时不渲染 IDE | 接受：IDE 本就需要 session 提供 cwd，与 chat 一致 |
| 大文件（>32MB）readAll 失败 | 捕获 `too-large` 错误，UI 提示「文件过大无法打开」 |
| Monaco 体积影响首次打开 IDE 的加载时间 | 懒加载：IDE tab 首次激活才动态 import monaco-editor |

---

## 8. 后续可扩展（不在第一版）

- 写操作：新增 `@deepseek-ai/dsh-api-workspace-files-write` host 端 API（bounded write + agent-write 回灌）
- 终端集成：复用 `dsh-terminal` / `dsh-tool-bash`
- 全局搜索：复用 `dsh-tool-fs-search`
- 多 session 状态持久化：session-scoped store 升级为 workspace-scoped
- 与右侧栏联动：点文件树在 IDE 打开，IDE 活动文件高亮右侧栏

---

## 9. 开发顺序

1. 搭包骨架：package.json + tsdown.config + 空 src/index.ts + src/client/index.ts 空 apply
2. 构建 + 装入 profile + 验证 tab 出现（最小可用）
3. IdeView 布局骨架 + Dark Modern CSS（无 Monaco，先纯布局）
4. 接入 Monaco + Dark Modern 主题 + 只读打开一个文件
5. FileTree（list 递归）+ TabBar 多标签
6. changes 流刷新
7. 打磨：语言检测、大文件处理、错误态、空 session 态
8. README + 验收

每步可独立验证，逐步上色。



---

## 10. 第二阶段（进行中）

### 10.1 写操作 ✅（已完成并验证）

**新增包 '@deepseek-ai/dsh-api-workspace-files-write'**（/Users/fengzy/Documents/gitmy/dsh-api-workspace-files-write）：

- host 端 'WorkspaceFilesWrite extends TypertRemoteService'（namespace 'workspaceFilesWrite'），单方法 write(scope, path, content, intent, signal)：
  - 有界：maxWriteBytes 配置（默认 2MiB）；
  - 圈禁：fs.resolve + fs.contains 限定在 session workspace root 内；
  - 拒绝非普通文件（lstat type check）；
  - 乐观并发：intent createIfAbsent / replaceIfVersion 直通 ctx.fs.writeText；
  - 回灌：写成功后 ctx.emit('fs/observed', target, {kind:'present', version}, undefined) —— 与 agent 的 dsh-tool-fs 写入同一条管道（changes 流只重放 instrumented 写入，OS 不被监视；直接 writeText 不经过工具层，必须手动 emit）；
  - 错误码映射：FS_STALE_VERSION→'workspace-file-write/stale-version'、FS_NOT_OBSERVED→'already-exists'、FS_SANDBOX_DENIED→'outside-workspace'、FS_NOT_TEXT→'not-text'。
- typert 工件为 strict 模式（手写 zod v4 schema 的 typert.host.ts / typert.remote-client.ts）：client $mount 拒绝 src-json codec（requireStrictCodec），strict 是唯一可挂载形态。
- 不用装饰器语法：rolldown 原生转换不降级 Stage-3 装饰器（Node 无法解析），改为构造函数里手写协议 marker（'@deepseek-ai/dsh-typert-protocol/remote-methods' prototype 属性）。
- client bundle 自挂载：apply 直接 return await ctx.remote.$mount(TYPERT_REMOTE)。关键坑：async apply 中 await 之后注册 ctx.effect(dispose) 会落在已 settle 的 fiber 上并立即执行、把 namespace 卸载掉 —— 必须像 dsh-api-remotes 一样从 apply 返回 disposer。

**IDE 编辑流**（IdeView.tsx）：

- Monaco readOnly: false；truncated 视图强制只读（防把截断内容写盘）；
- dirty 跟踪：ideEditor.saved（path → 已存文本基线）+ 内容监听器对比，dirtyRef 防 React 重渲染抖动；
- 保存：Cmd/Ctrl+S（editor.addCommand）+ 状态栏'未保存'可点按钮；intent 用 tab.version（replaceIfVersion）；
- 冲突：stale-version → 对话框'覆盖磁盘 / 放弃修改并重新加载'（覆盖 = 无 intent 写；重载 = reopenFile）；
- dirty tab 关闭确认（保存 / 不保存 / 取消）；
- changes 流刷新跳过 dirty tab（用户编辑优先，保存时由冲突流收口）；自己的写回灌帧因 version 相等被守卫跳过（无自刷新抖动）。

验证记录：编辑→保存→磁盘内容变化 ✓；外部改盘→Cmd+S→冲突对话框 ✓；覆盖/重载两路 ✓；保存产生 fs/observed change 帧（path+version）✓；对话↔IDE 往返无回归 ✓。

### 10.2 状态持久化 workspace-scoped ✅（已完成并验证）

- workspaceTabs: Map<cwd, {tabs, activePath}> 模块级 store；Monaco models 与 saved 基线本就按绝对路径存于模块层；
- 切 session（同 cwd）不打扰；切 workspace 时 park/restore；view ring 重挂载自动恢复；
- 验证：切走再切回，tabs + active + 内容完整恢复 ✓。

### 10.3 右侧栏联动 ✅（已完成并验证）

src/client/sidebarBridge.ts（模块级，apply 时安装一次）：

- 右栏 → IDE：document 捕获阶段拦截主键点击（built-in 树 'li[data-files-entry="file"][data-files-path]'；better-sidebar 树 'div[role="button"][title^="/"]'），preventDefault + stopPropagation 阻断内置预览，requestIdeOpen(path)：优先 live openView('ide', path)（view ring 一次性 focus request，viewRequest/completeViewRequest 消费）；首次激活前（view 未挂载、openView 未注册）回退点击 IDE tab 按钮 + takePendingOpenPath() 在挂载时开文件。
- IDE → 右栏高亮：活动文件发布 → syncSidebarHighlight 给两棵树的行打 'data-ide-active'；MutationObserver 在树懒加载后重打；CSS 用 DSW 别名变量注入。仅标可见行（VS Code 同款语义）。
- 验证：右栏点 .zshrc → 自动切 IDE + 打开 tab ✓；活动文件行带 data-ide-active ✓；活动切换后旧标记清除 ✓。

### 10.4 剩余（未开始）

- 终端面板：宿主 remote 封装 ctx.subprocess.spawnTerminal（pid/output 流/write/signal/terminate；无 resize API）+ xterm.js（@xterm/xterm + fit addon，需打包）底部面板。注意 dsh-terminal/ctx.terminals 仅 Agent 可用（TERM=dumb），不适用人类终端。
- 全局搜索：复用 dsh-tool-fs-search 的 runRipgrep/buildGrepCommand/parseGrepMatches（需 exec shim ctx）做宿主服务，IDE 侧搜索面板。

### 10.5 源代码管理（Git）✅（已完成并验证）

**Host 端 git 方法**（src/index.ts，复用 ctx.subprocess.spawn 前台 collect 模式跑 git，与 ripgrep 同原语）：

- gitStatus(scope, signal) — git status --porcelain=v2 --branch -z，解析分支名、upstream、ahead/behind、detached、所有变更条目（modified/added/deleted/renamed/untracked/conflicted，含 oldPath）；
- gitBranches(scope, signal) — git for-each-ref refs/heads，拿本地分支列表 + 当前分支 + 各分支 ahead/behind/最近提交；
- gitDiff(scope, path, kind, signal) — git diff [--cached|HEAD] -- path 拿 unified diff 文本，再 git show HEAD:path 拿旧内容、git show :path 拿新内容，返回 diff + oldContent + newContent + language。
- 错误映射：exit 128 + not a git repository → ide-tools/not-a-repo（client 端映射为 notARepo 空状态，非报错）。
- typert strict schema 同步手写于 typert.host.ts / typert.remote-client.ts；REMOTE_METHODS_KEY marker 注册三个 direct 方法。

**Client 端组件**：

- src/client/git/SourceControlPanel.tsx — 左侧栏源代码管理面板：标题 + 刷新按钮；分支行（branch 图标 + 名称 + ahead/behind 计数）；更改分组列表，每条目显示文件名 + 父目录 + 彩色状态字母（M=琥珀/A=绿/D=红/R=蓝/U=绿/C=琥珀）；点击条目 onOpenDiff(path)；挂载时 + 每 15s 自动轮询刷新。
- src/client/git/DiffEditor.tsx — 中间面板 diff 视图：动态 import Monaco，createDiffEditor（side-by-side，只读，Dark Modern 主题），original=oldContent、modified=newContent；路径切换时 dispose 重建；loading/empty/error 三态 overlay。
- src/client/IdeView.tsx — activity bar git 按钮 data-active + setSidebarView('git')；sidebar 三分支（git/search/explorer）；editor area 当 diffPath 存在时渲染 DiffEditor（替换普通 TabBar + 编辑器容器），从搜索/资源管理器打开文件时 setDiffPath(undefined) 回到普通模式。
- src/client/icons.tsx — 新增 codicon 风格 SVG：branch、refresh、check、discard、diff、diffAdded/Removed/Modified/Renamed、chevronDown、sync、more、splitEditor、eye；优化 explorer/search/git/debug/extensions 图标路径精度；activity bar 增加 hover 背景过渡。
- src/client/theme.ts — 新增 .ide-git-* 面板样式 + .ide-diff-* diff 视图样式；activity bar 间距优化（padding 6px、gap 1px、hover 半透明白底）。
- src/client/locales.ts — 新增 35 条 git 相关 i18n（zh + en）。

验证记录：构建通过；非 git 仓库显示空状态；git 仓库显示分支 + 变更列表；点击变更文件在中间面板打开 Monaco diff。

