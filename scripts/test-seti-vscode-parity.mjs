/**
 * Seti matcher parity with VS Code — cross-checks our setiKeyFor against a
 * faithful simulation of VS Code's real matching pipeline:
 *   getIconClasses (src/vs/editor/common/services/getIconClasses.ts)
 *   + FileIconThemeLoader.processIconThemeDocument
 *     (src/vs/workbench/services/themes/browser/fileIconThemeData.ts)
 *
 * The simulation builds the exact CSS selectors VS Code would generate from
 * the theme JSON, computes the class list VS Code would put on a file row,
 * and resolves the winner by CSS specificity (+ document order tie-break,
 * mirroring collectSelectors' languageIds → fileExtensions → fileNames order
 * and per-key JSON order inside each table).
 */
import { readFileSync } from 'node:fs'

const theme = JSON.parse(readFileSync(new URL('../src/client/icons/seti/vs-seti-icon-theme.json', import.meta.url), 'utf8'))

// ── VS Code simulation ───────────────────────────────────────────────────
// CSS specificity: class selectors only, so count classes per selector.
// Tie-break: later rule in the stylesheet wins (collectSelectors order:
// languageIds first, then fileExtensions, then fileNames; within a table,
// JSON key order). We track a global rule index.
const rules = [] // { spec: number, order: number, defKey: string }

function addRule(spec, order, defKey) { rules.push({ spec, order, defKey }) }

// languageIds → .{lang}-lang-file-icon.file-icon::before  (spec 2)
const langOrder = []
for (const [langId, defKey] of Object.entries(theme.languageIds ?? {})) {
  langOrder.push([langId, defKey])
}
// jsonc inheritance (fileIconThemeData.ts:337)
if (!langOrder.some(([id]) => id === 'jsonc')) {
  const json = langOrder.find(([id]) => id === 'json')
  if (json) langOrder.push(['jsonc', json[1]])
}
langOrder.forEach(([id, defKey], i) => addRule(2, 1000 + i, defKey))

// fileExtensions → for key "a.b": .a.b-ext + .b-ext + .ext + .file-icon (spec 4;
// base .{key}-ext + extra .ext-file-icon + .file-icon + inner suffix segment)
const extOrder = Object.entries(theme.fileExtensions ?? {})
extOrder.forEach(([key, defKey], i) => {
  const segs = key.split('.')
  // VS Code generates one selector per suffix combination of the KEY plus the
  // .ext-file-icon score booster; all share spec = segs.length + 2.
  addRule(segs.length + 2, 2000 + i, defKey)
})

// fileNames → .{name}-name-file-icon + .name-file-icon + [.{ext}-ext]* + .ext-file-icon + .file-icon
// (spec = 3 + number of dotted suffix segments; +name booster +ext booster)
const nameOrder = Object.entries(theme.fileNames ?? {})
nameOrder.forEach(([key, defKey], i) => {
  const segs = key.split('.')
  const suffixCount = Math.max(0, segs.length - 1)
  addRule(3 + suffixCount + 1, 3000 + i, defKey)
})

// default file → .file-icon::before (spec 1)
addRule(1, 0, theme.file ?? '_default')

// The language a file would resolve to via language contributions — the
// same table our generator folded in (extracted from VS Code built-in
// extensions' languages contribution points).
const extToLang = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
  mjs: 'javascript', cjs: 'javascript', py: 'python', md: 'markdown', json: 'json',
  jsonc: 'jsonc', yaml: 'yaml', yml: 'yaml', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', css: 'css', scss: 'scss', less: 'less', html: 'html',
  rb: 'ruby', php: 'php', xml: 'xml', toml: 'toml', sql: 'sql', sh: 'shellscript',
  vue: 'vue', svelte: 'svelte', swift: 'swift', kt: 'kotlin', scala: 'scala',
  dart: 'dart', lua: 'lua', r: 'r', pl: 'perl', ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hs: 'haskell', ml: 'ocaml', clj: 'clojure', gs: 'gradle',
  gradle: 'gradle', bat: 'bat', ps1: 'powershell', dockerfile: 'dockerfile',
  h: 'c', hpp: 'cpp', hxx: 'cpp', cc: 'cpp', cxx: 'cpp', m: 'objective-c',
  mm: 'objective-cpp', cs: 'csharp', fs: 'fsharp', fsi: 'fsharp', jsmap: 'json',
  gitignore: 'ignore', gitattributes: 'ignore', env: 'dotenv', npmrc: 'properties',
  eslintrc: 'jsonc',
}

/** Simulate getIconClasses + stylesheet resolution for one file name. */
function vscodeResolve(name) {
  const lower = name.toLowerCase()
  const matches = []
  // file name rule
  const nameRule = nameOrder.findIndex(([k]) => k === lower)
  if (nameRule >= 0) {
    const segs = lower.split('.')
    matches.push({ spec: 3 + Math.max(0, segs.length - 1) + 1, order: 3000 + nameRule, defKey: nameOrder[nameRule][1] })
  }
  // extension rules: every dot-suffix combination (getIconClasses:69-73), 255 cap
  if (lower.length <= 255) {
    const segs = lower.split('.')
    for (let i = 1; i < segs.length; i++) {
      const suffix = segs.slice(i).join('.')
      const idx = extOrder.findIndex(([k]) => k === suffix)
      if (idx >= 0) {
        // the theme-side selector for this key matches classes: .{suffix}-ext (+inner segs) + .ext booster + .file-icon
        const kSegs = suffix.split('.')
        matches.push({ spec: kSegs.length + 2, order: 2000 + idx, defKey: extOrder[idx][1] })
      }
    }
  }
  // language rule (via contribution-point table; VS Code also has shebang /
  // content-based detection which a name-only simulation cannot cover)
  const dot = lower.lastIndexOf('.')
  if (dot >= 0) {
    const lang = extToLang[lower.slice(dot + 1)]
    if (lang) {
      const idx = langOrder.findIndex(([id]) => id === lang)
      if (idx >= 0) matches.push({ spec: 2, order: 1000 + idx, defKey: langOrder[idx][1] })
    }
  }
  // default
  matches.push({ spec: 1, order: 0, defKey: theme.file ?? '_default' })
  // highest specificity wins; ties broken by later order
  matches.sort((a, b) => (b.spec - a.spec) || (b.order - a.order))
  return matches[0].defKey
}

// ── Our implementation (mirrors src/client/setiFileIcon.tsx setiKeyFor) ──
function readTable(name) {
  const src = readFileSync(new URL('../src/client/seti-icon-theme.ts', import.meta.url), 'utf8')
  const start = src.indexOf('export const ' + name)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return Function('return {' + src.slice(open + 1, i) + '}')() }
  }
  throw new Error('unbalanced ' + name)
}
const OUR_EXTS = readTable('SETI_FILE_EXTENSIONS')
const OUR_NAMES = readTable('SETI_FILE_NAMES')
const DEFAULT = /SETI_DEFAULT_FILE_KEY = "([^"]+)"/.exec(readFileSync(new URL('../src/client/seti-icon-theme.ts', import.meta.url), 'utf8'))[1]

function ourResolve(name) {
  const lower = name.toLowerCase()
  if (OUR_NAMES[lower] !== undefined) return OUR_NAMES[lower]
  if (lower.length <= 255) {
    const segs = lower.split('.')
    for (let i = 1; i < segs.length; i++) {
      const byExt = OUR_EXTS[segs.slice(i).join('.')]
      if (byExt !== undefined) return byExt
    }
  }
  return DEFAULT
}

// ── Parity sweep ─────────────────────────────────────────────────────────
const samples = []
for (const k of Object.keys(theme.fileExtensions ?? {})) samples.push('x.' + k)
for (const k of Object.keys(theme.fileNames ?? {})) samples.push(k)
const extra = [
  'a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.py', 'f.md', 'g.json', 'h.yaml', 'i.yml',
  'j.go', 'k.rs', 'l.java', 'm.c', 'n.cpp', 'o.css', 'p.html', 'q.rb', 'r.php',
  's.xml', 't.toml', 'u.sql', 'v.sh', 'w.vue', 'x.svelte', 'y.swift', 'z.kt',
  'README.md', 'readme.MD', 'package.json', 'PACKAGE.JSON', 'Makefile', 'makefile',
  'Dockerfile', 'dockerfile', 'noext', 'weird.xyzunknown', 'a.b.c.d.e',
  'deep.nested.spec.ts', 'foo.test.js', 'bar.js.map', 'baz.css.map',
  'x.tar.gz', 'y.min.js', 'z.d.ts', 'README', 'todo', 'mix',
  '.gitignore', '.env', '.npmrc', '.eslintrc', 'tsconfig.json', 'a.jsonc',
]
for (const s of extra) samples.push(s)

let failed = 0
const seen = new Set()
for (const s of samples) {
  if (seen.has(s)) continue
  seen.add(s)
  const vs = vscodeResolve(s)
  const ours = ourResolve(s)
  if (vs !== ours) {
    failed++
    console.log('DIFF ' + s + ': vscode=' + vs + ' ours=' + ours)
  }
}
console.log('checked ' + seen.size + ' names, ' + failed + ' mismatches')
console.log(failed === 0 ? 'PARITY OK — matcher matches VS Code semantics' : failed + ' mismatches need review')
process.exit(failed === 0 ? 0 : 1)
