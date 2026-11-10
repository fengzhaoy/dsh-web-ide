/**
 * Seti file icons — source-level wiring checks, same style as the other UI
 * tests. The Seti icon theme (the same webfont + mapping VS Code / code-server
 * ship) replaces the old symbol-icon ext map across every file row surface:
 * explorer tree, SCM panel, commit graph, and the search results.
 */
import { readFileSync } from 'node:fs'

let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

// --- generated theme data exists and is populated ---
const theme = read('../src/client/seti-icon-theme.ts')
check('icon definitions projected', theme.includes('"_typescript": { char: ') && theme.includes(', color: '))
check('extension map has ts -> _typescript', /^  "ts": "_typescript",/m.test(theme))
check('file-name map has readme.md -> _info', /^  "readme\.md": "_info",/m.test(theme))
check('default file key exported', /SETI_DEFAULT_FILE_KEY = "_default"/.test(theme))

// --- runtime component ---
const comp = read('../src/client/setiFileIcon.tsx')
check('font-face injects the woff data URI', comp.includes('data:font/woff;base64'))
check('matcher prefers file name over extension', comp.includes('SETI_FILE_NAMES[lower]'))
check('matcher falls back to default key', comp.includes('SETI_DEFAULT_FILE_KEY'))
check('matcher tries every dot-suffix (VS Code getIconClasses parity)', comp.includes("const segs = lower.split('.')") && comp.includes('segs.slice(i).join'))
check('matcher caps at 255 chars (vscode#116199)', comp.includes('lower.length <= 255'))
check('directories keep codicon folder SVGs', /isDir.*folderOpen.*folder/s.test(comp))

// --- every file-row surface renders setiFileIcon ---
const tree = read('../src/client/explorer/FileTree.tsx')
check('explorer rows use setiFileIcon', tree.includes('setiFileIcon(entry.name, isDir, isOpen)'))
check('explorer create-row uses setiFileIcon', tree.includes("setiFileIcon(kind === 'directory'"))
check('explorer no longer imports fileIcon', !/import \{[^}]*fileIcon[^}]*\} from '..\/icons/.test(tree))
const scm = read('../src/client/git/SourceControlPanel.tsx')
check('SCM entries use setiFileIcon', scm.includes('setiFileIcon(name, false)'))
const graph = read('../src/client/git/GraphView.tsx')
check('commit graph files use setiFileIcon', graph.includes('setiFileIcon(name, false)'))
const search = read('../src/client/search/SearchPanel.tsx')
check('search file rows use setiFileIcon', search.includes('setiFileIcon(path.split('))

// --- font installed with the codicon bootstrap at mount ---
const ide = read('../src/client/IdeView.tsx')
check('IdeView installs the seti font', ide.includes('installCodiconFont()') && ide.includes('installSetiFont()'))

// --- styles ---
const css = read('../src/client/theme.ts')
check('.ide-seti-icon styles the glyph', css.includes('.ide-seti-icon{font-family:seti'))
check('search file name row centers the icon', css.includes('.ide-search-file-name{padding:3px 8px;font-size:12px;font-weight:600;color:var(--ide-fg,#cccccc);display:flex;align-items:center;gap:6px}'))

// --- build pipeline embeds the font ---
const build = read('../scripts/build-monaco-worker.mjs')
check('build embeds seti.woff as base64', build.includes("'seti-font-source.js'"))

console.log(failed === 0 ? '\nall seti icon checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
