/**
 * Explorer type-to-filter: the box lives at the top of the tree but is hidden
 * until the title-bar magnifier toggles it; closing it must clear the filter,
 * and Esc closes it too. Source-level checks (the repo's other UI tests do the
 * same) plus a real-browser pass for the interaction.
 */
import { readFileSync } from 'node:fs'

let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }
const tree = readFileSync(new URL('../src/client/explorer/FileTree.tsx', import.meta.url), 'utf8')
const ide = readFileSync(new URL('../src/client/IdeView.tsx', import.meta.url), 'utf8')

// --- handle contract ---
check('ExplorerHandle exposes toggleFilter', /toggleFilter\(\): void/.test(tree))
check('toggleFilter flips the open flag', /toggleFilter: \(\) => setFilterOpen\(\(open\) => !open\)/.test(tree))
check('box starts hidden', /const \[filterOpen, setFilterOpen\] = useState\(false\)/.test(tree))

// --- the box is conditional, not a permanent row ---
const filterRow = tree.indexOf('className="ide-tree-filter"')
check('filter row exists', filterRow !== -1)
const before = tree.slice(Math.max(0, filterRow - 120), filterRow)
check('filter row is guarded by filterOpen', before.includes('{filterOpen && ('))

// --- open focuses, close clears ---
check('opening focuses the input', /if \(filterOpen\) \{\s*filterInputRef\.current\?\.focus\(\)/.test(tree))
check('closing clears the filter text', /\}\s*setFilterText\(''\)\s*\}, \[filterOpen\]\)/.test(tree))
check('Escape closes and clears', /e\.key !== 'Escape'[\s\S]{0,160}setFilterText\(''\)[\s\S]{0,80}setFilterOpen\(false\)/.test(tree))

// --- header wiring: the magnifier drives the box, never the search view ---
check('header magnifier calls toggleFilter', ide.includes('onClick={() => explorerRef.current?.toggleFilter()}'))
check('header magnifier uses the filter tooltip', /title=\{t\('explorer\.filterFiles'\)\}/.test(ide))

// --- the workspace root renders as its own expandable row (VS Code parity) ---
check('root row component exists', tree.includes('function RootRow('))
check('root row is rendered before the children', tree.indexOf('RootRow') < tree.indexOf('renderDir(rootDir, rootState, 1)'))
check('root starts expanded', /useState<Set<string>>\(\(\) => new Set\(\[rootDir\.replace/.test(tree))
check('root children render only while expanded', tree.includes('renderDir(rootDir, rootState, 1)') && /expanded\.has\(rootDir\.replace[\s\S]{0,40}\)\) && renderDir\(rootDir, rootState, 1\)/.test(tree))
check('root row carries the chevron and folder icon', /ide-tree-root-row[\s\S]{0,400}ide-tree-chevron[\s\S]{0,200}setiFileIcon\(name, true, expanded\)/.test(tree))
check('root row opens the blank-area context menu', tree.includes('onContextMenu={handleBlankContextMenu}'))
check('reveal always re-expands the root', /next\.add\(rootDir\.replace\(/.test(tree))
// Scope to the header button itself: the activity bar legitimately hosts its
// own search icon that DOES switch the sidebar view (they are two different
// magnifiers living side by side).
const headerAction = ide.slice(ide.indexOf('data-testid="ide-explorer-filter"'), ide.indexOf('data-testid="ide-explorer-new-file"'))
check('header magnifier does not open the search sidebar', headerAction.length > 0 && !headerAction.includes('toggleSidebarFor'))

// --- explorer visibility follows VS Code files.exclude defaults ---
const exclude = readFileSync(new URL('../src/client/explorer/exclude.ts', import.meta.url), 'utf8')
const { isExplorerExcluded } = await import('../src/client/explorer/exclude.ts')

check('hidden: .DS_Store', isExplorerExcluded('.DS_Store') === true)
check('hidden: VCS folders', ['.git', '.svn', '.hg', '.jj'].every((n) => isExplorerExcluded(n)))
check('hidden: Thumbs.db', isExplorerExcluded('Thumbs.db') === true)
check('hidden: crswap swap files', isExplorerExcluded('a.crswap') === true)
check('visible: .gitignore (VS Code lists ordinary dotfiles)', isExplorerExcluded('.gitignore') === false)
check('visible: .github / .env / .vscode', ['.github', '.env', '.vscode'].every((n) => isExplorerExcluded(n) === false))
check('visible: a name merely containing a dot', isExplorerExcluded('my.git.notes') === false)
check('visible: ordinary files', isExplorerExcluded('README.md') === false && isExplorerExcluded('src') === false)
check('filter is applied when a directory is listed', /sortEntries\(filterExplorerEntries\(listing\.entries\)\)/.test(tree))
check('exclude module documents the VS Code source of the rules', exclude.includes('files.contribution.ts'))

// --- .gitignore'd paths are shown muted, like VS Code's
//     gitDecoration.ignoredResourceForeground (#8C8C8C dark / #8E8E90 light) ---
const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

check('git status asks for ignored paths', host.includes("'--ignored=matching'"))
check('ignored records become kind ignored', /first === '!'[\s\S]{0,500}kind: 'ignored'/.test(host))
check('ignored directory trailing slash is stripped', /record\.slice\(2\)\.replace\(\/\\\/\+\$\/,\s*''\)/.test(host))
check('ignored maps to the themed muted color', /case 'ignored': return 'var\(--ide-git-ignored/.test(tree))
check('ignored has no letter badge', /case 'ignored': return ''/.test(tree))
check('ignored does not tint parent folders', /entry\.kind === 'ignored'\) continue/.test(tree))
check('tree icons inherit the git color', /ide-tree-icon" style=\{gitColor \?/.test(tree))
check('ignored color defined for all three themes', (readFileSync(new URL('../src/client/theme.ts', import.meta.url), 'utf8').match(/--ide-git-ignored/g) || []).length === 3)

// --- activity-bar launcher icons default to HIDDEN (Settings > Appearance) ---
const settingsStore = readFileSync(new URL('../src/client/settingsStore.ts', import.meta.url), 'utf8')
const dialogs = readFileSync(new URL('../src/client/SettingsDialogs.tsx', import.meta.url), 'utf8')

check('app-menu icon defaults to hidden', /'appearance\.appMenuIcon': false,/.test(settingsStore))
check('vscode icon defaults to VISIBLE', /'appearance\.vscodeIcon': true,/.test(settingsStore))
check('both settings still exist in the panel', dialogs.includes('ide-settings-appmenu-icon') && dialogs.includes('ide-settings-vscode-icon'))
check('hidden icons are removed, not blanked', /\{settings\['appearance\.appMenuIcon'\] && \(/.test(ide))
check('vscode icon is conditionally rendered too', /\{settings\['appearance\.vscodeIcon'\] && /.test(ide))
check('one-time migration resets pre-existing visible flags', settingsStore.includes('SETTINGS_VERSION') && settingsStore.includes('!(version >= SETTINGS_VERSION)'))
check('palette can restore the vscode icon', ide.includes("id: 'ide.vscodeIcon'"))
check('palette can restore the app menu icon', ide.includes("id: 'ide.appMenuIcon'"))

// --- Timeline RPC must be exposed by the host, not only implemented ---
check('host registers gitTimeline in the remote method list', /method: 'gitTimeline'/.test(host))
check('host implements gitTimeline', /async gitTimeline\(/.test(host))
check('client degrades when the host lacks gitTimeline', /typeof \(ideTools as unknown as \{ gitTimeline\?: unknown \}\)\.gitTimeline === 'function'/.test(ide))

// --- Seti file-icon webfont must be installed by the view that renders the tree ---
check('IdeView imports installSetiFont', ide.includes("import { installSetiFont } from './setiFileIcon.js'"))
check('IdeView calls installSetiFont on mount', ide.includes('installSetiFont()'))
check('seti icon keeps its 150% glyph size', /.ide-seti-icon\{[^}]*font-size:150%/.test(
  readFileSync(new URL('../src/client/theme.ts', import.meta.url), 'utf8')))

// --- .gitignore'd entries must NOT leak into Source Control groups ---
const scm = readFileSync(new URL('../src/client/git/SourceControlPanel.tsx', import.meta.url), 'utf8')
check('SCM has an ignored-entry detector', /const isIgnoredEntry = useCallback/.test(scm))
check('ignored entries are excluded from Staged Changes', /const staged = result\.entries\.filter\(\(e\) => e\.kind !== 'conflicted' && !isIgnoredEntry\(e\) && isStagedEntry\(e\)\)/.test(scm))
check('ignored entries are excluded from Changes', /const changes = result\.entries\.filter\(\(e\) => e\.kind !== 'conflicted' && !isIgnoredEntry\(e\) && !isStagedEntry\(e\)\)/.test(scm))
check('ignored entries never make the index look staged', /hasStaged = result\?\.entries\.some\(\(entry\) => !isIgnoredEntry\(entry\) && isStagedEntry\(entry\)\)/.test(scm))

// --- markdown Outline: headings become symbols (VS Code markdown outline parity) ---
const mdOutline = readFileSync(new URL('../src/client/editor/markdownOutline.ts', import.meta.url), 'utf8')
check('markdown outline provider exists', mdOutline.includes('registerDocumentSymbolProvider'))
check('markdown outline provider is registered on load', ide.includes('registerMarkdownOutline(Monaco)'))
check('markdown outline handles ATX headings', /#{1,6}/.test(mdOutline))
check('markdown outline handles setext headings', mdOutline.includes('setext'))
check('markdown outline skips fenced code', mdOutline.includes('fence'))

// --- the Source Control badge counts real changes, never ignored paths ---
check('badge uses a filtered change count', ide.includes('const changeCount = useMemo('))
check('badge excludes ignored entries', /filter\(\(e\) => e\.kind !== 'ignored'\)\.length/.test(ide))
check('badge renders changeCount, not raw entries', ide.includes('{changeCount}') && !ide.includes('{gitEntries.length}</span>'))
check('tree still receives raw entries for muted ignored coloring', ide.includes('gitEntries={gitEntries}'))

// --- VS Code tab: IDE chrome (toolbar + sidebar) yields to the workbench ---
const css = readFileSync(new URL('../src/client/theme.ts', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/client/settingsStore.ts', import.meta.url), 'utf8')
const frameHost = readFileSync(new URL('../src/client/vscodeFrameHost.ts', import.meta.url), 'utf8')
const hostSrc = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
check('editor area is flagged while VS Code is active', ide.includes("data-vscode={activeIsVscode || undefined}"))
check('IDE toolbar is hidden over the VS Code iframe', /\.ide-editor-area\[data-vscode\] \.ide-editor-toolbar\{display:none\}/.test(css))
check('opening VS Code collapses the primary sidebar', /setSidebarCollapsed\(true\)/.test(ide))

// --- git status refresh is event-driven, not a 15s poll (VS Code parity) ---
check('git status falls back to a 60s net, not 15s', /setInterval\(fetch, 60000\)/.test(ide))
check('no 15s git poll remains', !/setInterval\(fetch, 15000\)/.test(ide))
check('git poll is gated on page visibility', /visibilitychange/.test(ide) && /document\.visibilityState === 'visible'/.test(ide))
check('window focus triggers a git refresh', /addEventListener\('focus', onFocus\)/.test(ide))

// --- three fixes: default view setting, status bar, iframe restore ---
check('default sidebar view is a setting, defaulting to Source Control',
  /'appearance\.defaultSidebarView': 'git'/.test(settings) && /appearance\.defaultSidebarView/.test(ide))
check('status bar yields to the VS Code workbench',
  /!activeIsVscode && \(<StatusBar/.test(ide))
check('overlay re-resolves its anchor every frame (stale ref = blank pane)',
  /querySelector\('\[data-testid="ide-vscode-anchor"\]'\)/.test(frameHost))
check('park keeps the frame alive (hide only, never detach)',
  /parkVscodeFrame[\s\S]{0,600}display = 'none'/.test(frameHost))

// --- code-server missing: install guide, searched paths, retry ---
const vscodeTab = readFileSync(new URL('../src/client/VscodeTab.tsx', import.meta.url), 'utf8')
check('missing code-server renders an install guide', /ide-vscode-missing-guide/.test(vscodeTab))
check('guide offers both brew and npm commands', /brew install code-server/.test(vscodeTab) && /npm install -g code-server/.test(vscodeTab))
check('guide can copy each command', /ide-vscode-copy-command/.test(vscodeTab))
check('guide lists the paths that were searched', /searchedPaths/.test(vscodeTab))
check('guide has a retry button', /ide-vscode-retry/.test(vscodeTab))
check('retry re-detects instead of restarting', /onRetry=\{\(\) => \{ void openVscode\(false\) \}\}/.test(ide))
check('host reports searched paths with the error', /searchedPaths: codeServerCandidates\(\)/.test(hostSrc))

// --- color theme lives in the gear (Manage) menu, not in Settings ---
check('settings dialog no longer offers the color theme', !/settings\.theme/.test(readFileSync(new URL('../src/client/SettingsDialogs.tsx', import.meta.url), 'utf8')))
check('gear menu has a color theme submenu', /manage\.colorTheme/.test(ide))
check('the submenu lists every bundled theme', /THEME_CHOICES = \['dark-modern', 'light-modern', 'dark-2026'\]/.test(ide))
check('the active theme is marked with a check', /\\u2713/.test(ide))
check('theme submenu sits right after Settings in the gear menu', ide.indexOf("'settings', label: t('manage.settings')") < ide.indexOf("id: 'color-theme'"))

// --- terminal survives a client hot reload (ideTools stub window) ---
const term = readFileSync(new URL('../src/client/terminal/TerminalPanel.tsx', import.meta.url), 'utf8')
const entrySrc = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
check('the degraded ideTools face is tagged', /__isStub: true/.test(entrySrc))
check('terminal waits for the real face instead of attaching to the stub',
  /__isStub === true\) \{\s*const retry = setTimeout/.test(term))
check('fit is skipped on the degraded face (no terminalResize)', /__isStub === true\) return/.test(term))
check('no term.reset() on re-attach (it blanked the pane)', !/\.term\.reset\(\)/.test(term))

// --- terminal code-review batch 1 ---
check('terminal owns its chords (Cmd+F reaches the find widget)', /const inTerminal = el instanceof HTMLElement && el\.closest\('\.xterm'\)/.test(ide))
check('run-task focuses the added terminal, not index+1', /setActiveTerminalIdx\(nextIdx\)/.test(ide))
check('terminal commands are in the palette', /ide\.terminalNew/.test(ide) && /terminalPanelRef\.current\?\.newTerminal/.test(ide))
check('terminal panel ref is wired', /ref=\{terminalPanelRef\}/.test(ide))
check('unknown stub methods resolve to ok:false instead of throwing', /new Proxy\(stubMethods/.test(entrySrc))
check('stub proxy is not a thenable', /prop === 'then'\) return undefined/.test(entrySrc))
check('every terminalOpen call has a catch', (term.match(/terminalOpen\([^;]*?\.catch\(/g) ?? []).length >= 3)

// --- terminal code-review batch 2 + 3 ---
check('closing the panel disposes every xterm', /useEffect\(\(\) => \(\) => \{[\s\S]{0,400}entry\.dispose\(\)/.test(term))
check('terminal names/colors/panel state persist', /dsh-web-ide\.terminal\./.test(term) && /loadPref<Record<string, string>>/.test(term))
check('multi-line paste asks first', /terminal\.pasteWarn/.test(term) && /ide-terminal-paste-warn/.test(term))
check('paste warning can be disabled permanently', /pasteWarnSkip/.test(term))
check('find keys match VS Code (Enter = previous)', /runFind\(e\.shiftKey \? 1 : -1\)/.test(term))
check('split supports a vertical orientation', /data-split-dir/.test(term) && /split-dir=column/.test(css))

// --- terminal code-review batch 4 ---
check('CLICOLOR_FORCE is not forced (redirects stay plain)', !/^\s*CLICOLOR_FORCE:/m.test(hostSrc))
check('terminal offers Copy as HTML', /terminal\.copyHtml/.test(term))
check('run selected text is a command', /ide\.runSelectionInTerminal/.test(ide) && /sendText/.test(term))
check('terminal list supports drag reorder', /onDragStart/.test(term) && /onReorderTerminal/.test(ide))
check('reorder keeps focus on the same terminal', /next\.indexOf\(terminalIds\[prevIdx\]/.test(ide))

console.log(failed === 0 ? '\nall explorer filter checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
