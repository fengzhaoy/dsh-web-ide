# DSH Client UI IDE

DSH Web IDE Plugin — A modern web IDE integration solution built upon Monaco Editor.

## Project Introduction

DSH Client UI IDE is a web IDE plugin designed specifically for the DSH platform. It provides complete code editing, file management, Git version control, terminal simulation, and global search functionality. The plugin is deeply integrated into the DSH workspace, supports a dark theme, offers a smooth user experience, and enables an efficient development workflow.

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
dsh-client-ui-ide/
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
# Development mode (watch build)
pnpm dev

# Production build
pnpm build
```

### Plugin Loading

**Method A: Automatic forwarding via dsh plugin**

Ensure `cordis.patch.yml` is configured correctly; the plugin will be loaded automatically after building.

**Method B: Manual web profile loading**

Add the dependency to the target web profile's `package.json`:

```json
"dependencies": {
  "@deepseek-ai/dsh-client-ui-ide": "file:/path/to/dsh-web-ide"
}
```

And add the following to the browser roster in `cordis.patch.yml`:

```yaml
- id: ui-ide
  name: '@deepseek-ai/dsh-client-ui-ide'
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
  "main": "dist/index.js",
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

See [CHANGELOG.md](./CHANGELOG.md) (To be added)

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
**Issue Feedback**: [Issue Page](https://gitee.com/fengzhaoy/dsh-client-ui-ide/issues)