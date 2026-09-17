# DSH Web IDE

[![npm version](https://img.shields.io/npm/v/@zhaoyang10/dsh-web-ide.svg)](https://www.npmjs.com/package/@zhaoyang10/dsh-web-ide)
[![npm downloads](https://img.shields.io/npm/dm/@zhaoyang10/dsh-web-ide.svg)](https://www.npmjs.com/package/@zhaoyang10/dsh-web-ide)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

DSH Web IDE 插件 —— 基于 Monaco Editor，在 DSH 会话页中内置一个 VSCode 风格的开发工作台：资源管理器、代码编辑与保存、Git 全流程管理、交互式终端、全局搜索，以及会话与 IDE 的双向联动。

| 资源管理器与编辑器 | Git 源代码管理 |
| :---: | :---: |
| ![资源管理器与编辑器](browser-screenshots/resource.png) | ![Git 源代码管理](browser-screenshots/git.png) |

## 安装

```bash
# 安装到 DSH web profile（推荐）
dsh plugin --profile web add @zhaoyang10/dsh-web-ide

# 或仅安装 npm 包本体
npm install @zhaoyang10/dsh-web-ide
```

> 安装后还需把 `@zhaoyang10/dsh-web-ide` 加入 profile 的 `dsh.profile.bundles` 并重启 `dsh web`，详见 [安装到 DSH](#安装到-dsh)。

## 目录

- [功能特性](#功能特性)
- [安装到 DSH](#安装到-dsh)
- [使用指南](#使用指南)
- [工作原理](#工作原理)
- [开发指南](#开发指南)
- [发布到 npm（维护者）](#发布到-npm维护者)
- [版本历史](#版本历史)
- [贡献指南](#贡献指南)

## 功能特性

### 资源管理器

- 无限层级目录树，按扩展名自动匹配文件图标
- 新建文件 / 文件夹、重命名、删除，全部经 host 侧工作区路径校验，杜绝越界访问
- 文件条目带 Git 状态标记（未跟踪 / 修改 / 已暂存 / 已删除 / 冲突）
- 超过 2MB 的大文件自动分页截断展示，避免界面卡顿

### 代码编辑器

- Monaco Editor（VS Code 同款内核）+ Dark Modern 暗色主题
- 常用编程语言语法高亮、行号、代码折叠，多 Tab 页签管理与快捷切换
- 直接编辑并保存（`Ctrl/Cmd+S` 或状态栏按钮），关闭未保存 Tab 时询问保存 / 放弃
- 保存冲突检测：磁盘文件被其他工具（或 AI）改动时，可选择覆盖磁盘或放弃修改并重新加载
- Markdown 文件一键切换 编辑 / 预览 双视图
- 内嵌真实 Monaco Editor Worker（Blob 实例化），diff 增删高亮离线可用，无 CDN 依赖

### 源代码管理（Git）

- 更改列表：逐文件或全部 暂存 / 取消暂存 / 丢弃变更
- 提交：常规 / 修正（amend）/ 签名（signoff）/ 提交并推送 / 提交并同步
- **AI 生成提交信息**：复用当前会话模型自动撰写提交语
- 分支管理：检出 / 新建 / 删除分支，领先 / 落后计数，一键发布分支（`git push -u origin`）
- 图形化提交历史（Graph 视图）与提交详情浏览
- 双栏 Diff 对比编辑器，增删行高亮
- Fetch / Sync（拉取并推送）

### 终端

- node-pty 驱动的真实交互式终端，支持多实例与分屏
- `Ctrl+C` 中断、终止终端、最大化 / 展开 / 还原
- 关闭面板不终止进程，重新打开自动回放历史输出（scrollback 回放）

### 全局搜索

- 基于 ripgrep 的全工作区检索
- 支持正则表达式、区分大小写、include glob 过滤（如 `*.ts`）
- 匹配计数与截断提示，点击结果直达目标文件与行

### 平台集成

- 注册为会话页第三个 Tab（会话 → 轨迹 → IDE），随插件卸载自动移除
- 侧边栏联动：会话侧打开的文件自动落入 IDE，IDE 浏览时同步高亮
- 中 / 英双语界面，跟随 DSH 客户端语言设置

## 安装到 DSH

本插件以 DSH bundle 形式分发。安装分两步：**把插件包装入 profile 依赖**，再把**包名加入 profile 清单的 `dsh.profile.bundles` 数组**。DSH 启动时会自动套用插件自带的 `cordis.patch.yml`，把 `ui-ide` 客户端插件注册进 web 客户端 roster，无需手动改 roster。**除 DSH 本体外没有其他前置包**：IDE 的保存 / 新建等文件操作由本插件自己的 host 服务实现。

### 前置条件

- 已安装 DSH CLI（`dsh` 命令可用，建议 0.1.6+）
- 已有 web profile，且 `dsh web` 可正常启动（profile 目录默认在 `~/.dsh/profiles/web`）

### 方式一：从 npm 安装（推荐）

1. 把插件装入 web profile：

   ```bash
   dsh plugin --profile web add @zhaoyang10/dsh-web-ide
   ```

2. 编辑 `~/.dsh/profiles/web/package.json`，在 `dsh.profile.bundles` 数组**末尾**追加本插件包名：

   ```json
   "dsh": {
     "profile": {
       "bundles": [
         "...其他 bundle...",
         "@zhaoyang10/dsh-web-ide"
       ]
     }
   }
   ```

3. 重启 DSH web：

   ```bash
   dsh web
   ```

### 方式二：本地目录安装（开发调试用）

1. 构建插件（在本仓库检出目录执行，产出 `lib/`）：

   ```bash
   pnpm install
   pnpm bundle
   ```

2. 把插件以本地 link 方式装入 web profile（`dsh plugin` 会把命令转发到 profile 目录执行 `pnpm add`，`link:` 后接绝对路径）：

   ```bash
   dsh plugin --profile web add link:/absolute/path/to/dsh-web-ide
   ```

3. 同方式一第 2 步，把 `@zhaoyang10/dsh-web-ide` 加入 `dsh.profile.bundles` 并重启 `dsh web`。

> `link:` 始终引用源目录，改动后重新构建并重启即可生效；若希望安装时拷贝一份快照，可改用 `dsh plugin --profile web add file:/absolute/path/to/dsh-web-ide`。

### 方式三：手动注册 roster（不启用 bundle patch）

若不想把插件列为 bundle（例如仅在某个 profile 临时启用），可以只完成依赖安装，然后在 profile 用户层 `~/.dsh/profiles/web/cordis.patch.yml` 中手动插入 roster 条目：

```yaml
- insert:
    - id: ui-ide
      name: '@zhaoyang10/dsh-web-ide'
```

### 验证安装

1. 重启 DSH web（`dsh web`）
2. 打开浏览器右侧工具栏，确认 "IDE" 入口可见
3. 点击进入 IDE 界面，检查文件树、编辑器、终端、Git 面板等功能是否正常

### 卸载

1. 从 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 中移除 `@zhaoyang10/dsh-web-ide`
2. 移除依赖：`dsh plugin --profile web remove @zhaoyang10/dsh-web-ide`
3. 重启 `dsh web`

## 使用指南

### 界面入口

在会话页顶部 Tab 栏切换：**会话 → 轨迹 → IDE**。IDE 视图与当前 session 绑定，工作区即该会话的 cwd。

### 文件操作

- **打开文件**：点击文件树中的文件，或使用搜索结果直达
- **新建文件 / 文件夹**：使用资源管理器顶部操作栏或右键菜单
- **重命名 / 删除**：右键文件选择对应操作（删除带二次确认）

### 代码编辑与保存

- 编辑器可直接修改内容，改动后 Tab 与状态栏出现未保存标记
- `Ctrl/Cmd+S` 或点击状态栏未保存指示保存
- 关闭未保存的 Tab 会弹出 保存 / 不保存 / 取消 确认
- 磁盘文件被外部（其他工具或 AI）修改后再保存会提示冲突：覆盖磁盘，或放弃修改并重新加载

### Git 操作

- 打开 Source Control 面板查看更改，逐文件或全部暂存 / 取消暂存 / 丢弃
- 点击文件查看 Diff；编写提交信息后 `Ctrl/Cmd+Enter` 提交
- 点击「AI 生成提交信息」按钮，让会话模型代写提交语
- 「更多提交操作」菜单：修正提交、签名提交、提交并推送、提交并同步
- 分支视图检出 / 新建 / 删除分支；Graph 视图浏览提交历史

### 终端

- 终端面板新建终端，支持分屏与最大化
- `Ctrl+C` 中断当前进程；关闭面板终端保持后台运行，重新打开自动回放输出

### 全局搜索

- 支持正则、区分大小写与 include glob（如 `*.ts`）过滤
- 输入关键词回车搜索，点击结果跳转到对应文件与行

### Markdown 预览

打开 `.md` 文件后，点击编辑器工具栏的预览按钮，即可在 编辑 / 预览 之间切换。

### 会话联动

在会话中打开文件（如让模型把文件打开到侧边栏），文件会自动在 IDE 中打开；在 IDE 侧边栏浏览文件时，会话侧同步跟随高亮。

## 工作原理

```
会话页 Tab：  [ 会话 ]  [ 轨迹 ]  [ IDE ]
                                  │
        浏览器 bundle：lib/client.js
        注册 ide Tab · 文件树 · Monaco · Git · 终端 · 搜索
                                  │
                                  │  typert 远程调用
                                  │  workspaceFiles（读） / ideTools（写 · git · 终端）
                                  ▼
        Host 服务：lib/index.js
        ripgrep 搜索 · node-pty 终端 · git 全流程 · 文件写（+ 工作区校验 + sandbox 围栏）
```

- **双入口**：`lib/index.js` 为 host 侧入口，挂载 `ideTools` 远程命名空间；`lib/client.js` 为浏览器 bundle，注册 `ide` 会话 Tab。
- **自动注册**：DSH 启动时套用包内 `cordis.patch.yml`，把 `ui-ide` 写入浏览器 roster。
- **依赖注入**：`package.json` 的 `dsh.client.inject` 声明所需浏览器服务（slots / sessions / locale / remote 等），由启动内核先行解析。
- **保存链路自持**：编辑器保存走 `ideTools.writeFile`（本包 host 服务，非独立包）：先按会话工作区做路径校验，再交给宿主 `fs` seam 的 `writeText` —— 由 sandbox 策略围栏目标、按文件真实版本做原子并发校验（过期保存报冲突而非静默覆盖），成功后 `fs/observed` 回灌会话的文件变更流，会话侧与 agent 都能看到这次改动。

## 开发指南

### 环境要求

- Node.js 20.19+（tsdown / rolldown 要求）
- pnpm 8+
- TypeScript 5.6+

### 本地开发

```bash
# 安装依赖
pnpm install

# 生产构建（产出 lib/）
pnpm bundle

# 开发模式（监听重建，配合 HMR 热更新）
pnpm watch

# 远程契约测试
pnpm test:contract
```

> `@deepseek-ai/*` 系列依赖已发布在公共 npm 上，`devDependencies` 中以版本范围声明（与 `peerDependencies` 保持一致），`pnpm install` 即可直接装好，无需任何本机路径或 `link:`。tsdown 会把它们保持为 external，运行时由宿主 DSH 从自己的 `node_modules` 解析，因此这些依赖只参与本地类型检查，不影响发布产物。

### 目录结构

```
dsh-web-ide/
├── src/
│   ├── index.ts                    # Host 入口：ideTools 远程服务（搜索/终端/Git/文件操作）
│   ├── typert.host.ts              # 远程方法 zod 协议定义
│   ├── typert.remote-client.ts     # 浏览器侧远程客户端
│   └── client/
│       ├── index.ts                # 客户端入口：注册 ide Tab + 字典 + 侧边栏桥
│       ├── IdeView.tsx             # IDE 主视图（Tab / 编辑器 / 面板编排）
│       ├── ContextMenu.tsx         # 右键菜单
│       ├── sidebarBridge.ts        # 会话 ↔ IDE 联动
│       ├── theme.ts                # Dark Modern 主题定义
│       ├── locales.ts              # zh / en 字典
│       ├── language.ts             # 扩展名 → 语言映射
│       ├── icons.tsx / icons/      # SVG 图标（含生成脚本）
│       ├── monaco-worker.ts        # Monaco Worker 打包入口
│       ├── monacoWorkerBootstrap.ts # Blob URL Worker 引导
│       ├── editor/                 # TabBar / StatusBar / MarkdownPreview
│       ├── explorer/               # FileTree
│       ├── git/                    # SourceControlPanel / DiffEditor / GraphView / BranchesView
│       ├── search/                 # SearchPanel
│       └── terminal/               # TerminalPanel
├── scripts/
│   ├── build-monaco-worker.mjs     # 把 Monaco Worker 源码内嵌进客户端产物
│   ├── tsdown.worker.config.ts     # Worker 构建配置
│   └── test-remote-contract.mjs    # 远程契约测试
├── cordis.patch.yml                # bundle patch：自动注册 ui-ide 到浏览器 roster
└── tsdown.config.ts                # 主构建配置
```

### 定制扩展

- **主题**：`src/client/theme.ts` 定义 Dark Modern 配色，可调整 IDE CSS 变量与 Monaco 主题色
- **文件类型**：编辑 `src/client/language.ts` 的 `EXT_MAP` / `NAME_MAP` 扩展图标与语言映射
- **多语言**：`src/client/locales.ts` 维护 zh / en 字典

### 热更新调试（可选）

在 profile 用户层 `cordis.patch.yml` 中启用 `hmr` 行并指向本仓库，host 侧服务即可在 `pnpm watch` 重建后自动热载（浏览器侧仍需刷新页面）：

```yaml
- id: hmr
  disabled: false
  config:
    base: /absolute/path/to/dsh-web-ide
    root:
      - lib
```

在本仓库执行 `pnpm watch`，并重启一次 `dsh web` 使配置生效。

## 发布到 npm（维护者）

```bash
# 1. 版本号（会自动打 git tag）
npm version patch   # 或 minor / major

# 2. 发布（prepublishOnly 钩子自动执行 pnpm run bundle）
npm publish --registry=https://registry.npmjs.org/

# 3. 验证
npm view @zhaoyang10/dsh-web-ide version --registry=https://registry.npmjs.org/
```

> npm 已强制发布需 2FA：请在 npmjs.com 账号设置中绑定安全密钥 / 通行密钥（WebAuthn，macOS 可用 Touch ID），发布时按提示在浏览器中确认；新增 TOTP 验证器已不被支持。

## 浏览器兼容性

| 浏览器 | 最低版本 |
| --- | --- |
| Chrome | 90+ |
| Firefox | 88+ |
| Safari | 14+ |
| Edge | 90+ |

## 版本历史

| 版本 | 说明 |
| --- | --- |
| 0.1.0 | 首次发布：文件树、Monaco 编辑器、Git 面板、终端、全局搜索，已上架 [npm](https://www.npmjs.com/package/@zhaoyang10/dsh-web-ide) |

## 贡献指南

欢迎提交 Issue 和 Pull Request 共建项目。

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/xxx`）
3. 提交更改（`git commit -am 'Add xxx feature'`）
4. 推送到分支（`git push origin feature/xxx`）
5. 创建 Pull Request

## 许可证

本项目基于 [MIT](./LICENSE) 许可证开源。

## 致谢

- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — 代码编辑器内核
- [xterm.js](https://xtermjs.org/) — 终端前端组件
- [Cordis](https://github.com/satorijs/cordis) — 插件化上下文框架
- [React](https://react.dev/) — UI 组件库

---

**维护者**：[fengzhaoy](https://gitee.com/fengzhaoy) · **仓库**：[gitee.com/fengzhaoy/dsh-web-ide](https://gitee.com/fengzhaoy/dsh-web-ide) · **问题反馈**：[Issues](https://gitee.com/fengzhaoy/dsh-web-ide/issues) · **npm**：[@zhaoyang10/dsh-web-ide](https://www.npmjs.com/package/@zhaoyang10/dsh-web-ide)
