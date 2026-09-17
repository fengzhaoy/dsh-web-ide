# DSH Web IDE

[![npm version](https://img.shields.io/npm/v/@zhaoyang10/dsh-web-ide.svg)](https://www.npmjs.com/package/@zhaoyang10/dsh-web-ide)
[![npm downloads](https://img.shields.io/npm/dm/@zhaoyang10/dsh-web-ide.svg)](https://www.npmjs.com/package/@zhaoyang10/dsh-web-ide)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

DSH Web IDE Plugin — A modern web IDE integration solution built upon Monaco Editor.

## Install

Current version: [`0.1.0`](https://www.npmjs.com/package/@zhaoyang10/dsh-web-ide/v/0.1.0)

```bash
# Install into a DSH web profile (recommended)
dsh plugin --profile web add @zhaoyang10/dsh-web-ide

# Or install the npm package alone
npm install @zhaoyang10/dsh-web-ide
```

> After installing, append `@zhaoyang10/dsh-web-ide` to the profile's `dsh.profile.bundles` and restart `dsh web` — see [Install into DSH](#install-into-dsh) for details.

## Project Introduction

DSH Web IDE is a web IDE plugin designed specifically for the DSH platform. It provides complete code editing, file management, Git version control, terminal simulation, and global search functionality. The plugin is deeply integrated into the DSH workspace, supports a dark theme, offers a smooth user experience, and enables an efficient development workflow.

## Core Features

### File Browsing & Management
- Recursive directory tree display supporting infinite-level expansion
- Automatic file icon recognition (via extension)
- Basic file operations: Create file/folder, rename, delete
- Large file automatic truncation display to optimize memory usage
- Visual Git status (Untracked/Modified/Staged/Deleted)

### Code Editor
- Built on Monaco Editor, providing a VS Code-level editing experience
- Supports syntax highlighting for multiple programming languages
- Line number display and code folding
- Multi-tab management with quick switching support
- Real-time file content loading and saving

### Git Source Control
- Complete Git status panel
- Commit split button dropdown (VS Code parity): Amend, Signed Off, Commit & Push, Commit & Sync
- Post-commit action button (VS Code parity): with changes → Commit; clean tree → Synchronize Changes (pull+push with ahead/behind counts) or Publish Branch (no upstream, push -u origin)
- Terminal dock pinned to the bottom (VS Code layout): opening a file diff never covers the terminal
- File change tracking and display
- Branch information viewing
- Commit history browsing
- File comparison (Diff) editor

### Terminal Emulator
- Integrated xterm.js terminal component
- Support for multiple terminal instances
- Base64 encoded output transmission
- Comprehensive signal handling (Interrupt/Terminate)

### Global Search
- Supports directory-range search
- Result highlighting and path matching
- Quick navigation to search results

### UI Features
- Dark Modern theme
- Responsive layout adaptation
- Right-click context menu
- Sidebar and IDE linked interaction

## Technical Architecture

```
dsh-web-ide/
├── src/
│   ├── client/                # Browser-side UI components
│   │   ├── editor/            # Editor components (TabBar, StatusBar)
│   │   ├── explorer/          # File tree component (FileTree)
│   │   ├── git/               # Git integration panel
│   │   ├── icons/             # SVG icon resources
│   │   ├── locale/            # Internationalization resources
│   │   ├── search/            # Search panel
│   │   ├── sidebarBridge.ts   # Sidebar bridge
│   │   ├── terminal/          # Terminal panel
│   │   ├── theme.ts           # Dark theme definition
│   │   ├── icons.tsx          # Icon components
│   │   ├── language.ts        # File type mapping
│   │   └── index.ts           # Client entry point
│   ├── index.ts               # Host entry point
│   ├── typert.host.ts         # Remote method type definitions
│   └── typert.remote-client.ts# Remote call client
├── tsdown.config.ts           # Build configuration
├── tsconfig.json              # TypeScript configuration
├── cordis.patch.yml           # Cordis plugin patch
└── package.json               # Project dependencies
```

## Quick Start

### Environment Requirements

- Node.js 18+
- pnpm 8+
- TypeScript 5.0+

### Install Dependencies

```bash
pnpm install
```

### Development Build

```bash
# Production build (outputs lib/)
pnpm bundle

# Development mode (watch build, works with HMR)
pnpm watch
```

> The `@deepseek-ai/*` packages are not on the public npm registry; they are referenced via `link:` to the local global DSH installation in `devDependencies`. Adjust those paths after checking out on another machine (they only participate in local type checking and do not affect the published artifact).

### Install into DSH

**Method A: Install from npm (recommended)**

The plugin is published on the public npm registry: [@zhaoyang10/dsh-web-ide](https://www.npmjs.com/package/@zhaoyang10/dsh-web-ide).

```bash
dsh plugin --profile web add @zhaoyang10/dsh-web-ide
dsh plugin --profile web add @deepseek-ai/dsh-api-workspace-files-write
```

Then append `@zhaoyang10/dsh-web-ide` to the `dsh.profile.bundles` array in `~/.dsh/profiles/web/package.json` and restart `dsh web`. The bundled `cordis.patch.yml` registers the IDE tab and its workspace-files-write companion automatically.

**Method B: Install from a local directory (development)**

```bash
dsh plugin --profile web add link:/absolute/path/to/dsh-web-ide
dsh plugin --profile web add link:/absolute/path/to/dsh-api-workspace-files-write
```

The `link:` form always points at the source directory — rebuild and restart to pick up changes; use `file:` instead if you prefer an install-time snapshot.

**Method C: Manual roster registration (without the bundle patch)**

```yaml
- insert:
    - id: workspace-files-write
      name: '@deepseek-ai/dsh-api-workspace-files-write'
    - id: ui-ide
      name: '@zhaoyang10/dsh-web-ide'
```

### Verification

1. Restart the DSH workspace
2. Open the right-hand toolbar and confirm the "IDE" entry is visible
3. Click to enter the IDE interface and verify that the file tree, editor, terminal, and other functions work normally

## User Guide

### File Operations

- **Open File**: Click a file in the file tree or use the search function
- **Create File/Folder**: Use the top operation bar or right-click menu
- **Rename**: Right-click the file and select Rename
- **Delete**: Right-click the file and select Delete (with secondary confirmation)

### Git Operations

- Open the Source Control panel to view changes
- Stage/unstage files
- Write commit message and execute commit
- View file history and diff comparisons

### Terminal Usage

- Create new terminal instance
- Enter commands to execute
- Use Ctrl+C to interrupt the current process
- Close terminal instance

### Search Function

- Enter search keywords
- Select search scope (Current Directory/Workspace)
- Click result to jump to target location

## Plugin Configuration

### package.json Entry

```json
{
  "main": "lib/index.js",
  "cordis": {
    "host": true
  }
}
```

### Theme Customization

You can customize the IDE color scheme through `src/client/theme.ts`. The current built-in Dark Modern theme complies with modern design specifications.

### File Type Mapping

Edit `EXT_MAP` and `NAME_MAP` in `src/client/language.ts` to extend support for more file types.

## Browser Compatibility

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Version History

See [CHANGELOG.md](./CHANGELOG.md).

| Version | Notes |
| --- | --- |
| 0.1.0 | First release: file tree, Monaco editor, Git panel, terminal, global search. Published on [npm](https://www.npmjs.com/package/@zhaoyang10/dsh-web-ide). |

## Contribution Guidelines

Welcome to submit Issues and Pull Requests to co-build the project.

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/xxx`)
3. Commit changes (`git commit -am 'Add xxx feature'`)
4. Push to branch (`git push origin feature/xxx`)
5. Create Pull Request

## License

This project is open sourced under the MIT License. See the [LICENSE](./LICENSE) file for details.

## Acknowledgements

- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — Powerful code editor
- [xterm.js](https://xtermjs.org/) — Terminal emulator
- [Cordis](https://github.com/kyour-cn/cordis) — Plugin framework
- [React](https://react.dev/) — UI component library

---

**Maintainer**: [fengzhaoy](https://gitee.com/fengzhaoy)  
**Repository**: [gitee.com/fengzhaoy/dsh-web-ide](https://gitee.com/fengzhaoy/dsh-web-ide) · [npm package](https://www.npmjs.com/package/@zhaoyang10/dsh-web-ide)  
**Issue Feedback**: [Issue Page](https://gitee.com/fengzhaoy/dsh-web-ide/issues)