
# DSH Web IDE

DSH Web IDE 插件 — 基于 Monaco Editor 构建的现代化 Web IDE 集成方案。

## 项目简介

DSH Web IDE 是一个专为 DSH 平台设计的 Web IDE 插件，提供完整的代码编辑、文件管理、Git 版本控制、终端模拟及全局搜索功能。该插件深度集成于 DSH 工作区，支持暗色主题，拥有流畅的用户体验和高效的开发工作流。

## 核心功能预览

![资源管理 - 文件浏览](browser-screenshots/resource.png)

![Git 源代码管理](browser-screenshots/git.png)

## 核心功能

### 文件浏览与管理
- 递归式目录树展示，支持无限层级展开
- 文件图标自动识别（通过扩展名）
- 基础文件操作：新建文件/文件夹、重命名、删除
- 大文件自动截断展示，优化内存使用
- Git 状态可视化（未跟踪/已修改/已暂存/已删除）

### 代码编辑器
- 基于 Monaco Editor，提供 VS Code 级别编辑体验
- 支持多种编程语言语法高亮
- 行号显示与代码折叠
- 多 Tab 页签管理，支持快捷切换
- 实时文件内容加载与保存

### Git 源代码管理
- 完整的 Git 状态面板
- 文件变更追踪与显示
- 分支信息查看
- 提交历史浏览
- 提交图表（泳道式拓扑视图，支持按当前/全部分支过滤）
- 分支管理（新建/检出/删除本地与远程分支）
- 文件对比（Diff）编辑器，支持查看提交内单文件差异

### 终端模拟器
- 集成 xterm.js 终端组件
- 支持多终端实例
- Base64 编码输出传输
- 完善的信号处理（中断/终止）

### 全局搜索
- 支持目录范围搜索
- 结果高亮与路径匹配
- 搜索结果快速定位

### UI 特性
- Dark Modern 暗色主题
- 响应式布局适配
- 右键上下文菜单
- 侧边栏与 IDE 联动交互

## 技术架构

```
dsh-web-ide/
├── src/
│   ├── client/                # 浏览器端 UI 组件
│   │   ├── editor/            # 编辑器组件（TabBar、StatusBar）
│   │   ├── explorer/          # 文件树组件（FileTree）
│   │   ├── git/               # Git 集成面板
│   │   ├── icons/             # SVG 图标资源
│   │   ├── locale/            # 国际化资源
│   │   ├── search/            # 搜索面板
│   │   ├── sidebarBridge.ts   # 侧边栏桥接
│   │   ├── terminal/          # 终端面板
│   │   ├── theme.ts           # 暗色主题定义
│   │   ├── icons.tsx          # 图标组件
│   │   ├── language.ts        # 文件类型映射
│   │   └── index.ts           # 客户端入口
│   ├── index.ts               # Host 端入口
│   ├── typert.host.ts         # 远程方法类型定义
│   └── typert.remote-client.ts# 远程调用客户端
├── tsdown.config.ts           # 构建配置
├── tsconfig.json              # TypeScript 配置
├── cordis.patch.yml           # Cordis 插件补丁
└── package.json               # 项目依赖
```

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 8+
- TypeScript 5.0+

### 安装依赖

```bash
pnpm install
```

### 开发构建

```bash
# 开发模式（监听构建）
pnpm dev

# 生产构建
pnpm build
```

### 插件装载

**方式 A：通过 dsh plugin 自动转发**

确保 `cordis.patch.yml` 已正确配置，插件构建后自动装载。

**方式 B：手动装载 web profile**

在目标 web profile 的 `package.json` 中添加依赖：

```json
"dependencies": {
  "@zhaoyang10/dsh-web-ide": "file:/path/to/dsh-web-ide"
}
```

并在 `cordis.patch.yml` 的浏览器 roster 中添加：

```yaml
- id: ui-ide
  name: '@zhaoyang10/dsh-web-ide'
```

### 验证装载

1. 重启 DSH 工作区
2. 打开右侧工具栏，确认 "IDE" 入口可见
3. 点击进入 IDE 界面，检查文件树、编辑器、终端等功能是否正常

## 使用指南

### 文件操作

- **打开文件**：点击文件树中的文件或使用搜索功能
- **新建文件/文件夹**：使用顶部操作栏或右键菜单
- **重命名**：右键文件选择重命名
- **删除**：右键文件选择删除（带二次确认）

### Git 操作

- 打开 Source Control 面板查看变更
- 暂存/取消暂存文件
- 编写提交信息并执行提交
- 查看文件历史与差异对比

### 终端使用

- 新建终端实例
- 输入命令执行
- 使用 Ctrl+C 中断当前进程
- 关闭终端实例

### 搜索功能

- 输入搜索关键词
- 选择搜索范围（当前目录/工作区）
- 点击结果跳转至目标位置

## 插件配置

### package.json 入口

```json
{
  "main": "dist/index.js",
  "cordis": {
    "host": true
  }
}
```

### 主题定制

通过 `src/client/theme.ts` 可自定义 IDE 配色方案。当前内置 Dark Modern 主题，符合现代化设计规范。

### 文件类型映射

编辑 `src/client/language.ts` 的 `EXT_MAP` 与 `NAME_MAP` 可扩展支持更多文件类型。

## 浏览器兼容性

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## 版本历史

详见 [CHANGELOG.md](./CHANGELOG.md)（待补充）

## 贡献指南

欢迎提交 Issue 和 Pull Request 共建项目。

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/xxx`)
3. 提交更改 (`git commit -am 'Add xxx feature'`)
4. 推送到分支 (`git push origin feature/xxx`)
5. 创建 Pull Request

## 许可证

本项目基于 MIT 许可证开源，详见 [LICENSE](./LICENSE) 文件。

## 致谢

- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — 强大的代码编辑器
- [xterm.js](https://xtermjs.org/) — 终端模拟器
- [Cordis](https://github.com/kyour-cn/cordis) — 插件框架
- [React](https://react.dev/) — UI 组件库

---

**维护者**: [fengzhaoy](https://gitee.com/fengzhaoy)  
**问题反馈**: [Issue 页面](https://gitee.com/fengzhaoy/dsh-web-ide/issues)