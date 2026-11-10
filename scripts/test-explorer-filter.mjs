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
check('vscode icon defaults to hidden', /'appearance\.vscodeIcon': false,/.test(settingsStore))
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

console.log(failed === 0 ? '\nall explorer filter checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
