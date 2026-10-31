/**
 * Go to Definition for every language the IDE can show.
 *
 * The IDE runs in a browser tab and ships as a single client bundle, so it
 * has no language server to ask. What it does have is the host's ripgrep and
 * Monaco's own TypeScript worker. Resolution therefore goes in two tiers:
 *
 *   1. The language service (TypeScript/JavaScript only): Monaco's TS worker
 *      indexes the workspace, resolves imports, path aliases and node_modules
 *      — the same engine VS Code uses. Results there are compiler-accurate.
 *
 *   2. A declaration index (every other language): grep the workspace for the
 *      symbol once, then parse each hit with that language's declaration
 *      grammar (func/fn/def/class/…) to decide whether the hit IS a
 *      definition or merely a use. This is declaration-level, not type-level:
 *      `obj.Method()` cannot be type-resolved without a compiler, so it
 *      degrades to "pick from the declarations with that name".
 *
 * Everything here is pure and host-agnostic — the file that talks to the
 * remotes lives in IdeView — so the grammar can be unit-tested directly.
 */

/** One resolved definition target. `column`/`endColumn` are 1-based. */
export interface DefinitionTarget {
  /** Absolute path, as the host lists it. */
  path: string
  line: number
  column: number
  endColumn: number
  /** The declaration's own line, trimmed — shown in the picker. */
  preview: string
}

/** Languages whose declarations this module can index. */
const INDEXED_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'go', 'rust', 'java',
  'c', 'cpp', 'csharp', 'kotlin', 'swift', 'ruby', 'php',
])

/** Files the indexer never greps: build output and vendored trees would bury
 *  real definitions under thousands of duplicates. */
const EXCLUDED_GLOBS = [
  '!**/node_modules/**', '!**/dist/**', '!**/build/**', '!**/out/**',
  '!**/target/**', '!**/.git/**', '!**/vendor/**', '!**/.next/**',
  '!**/coverage/**', '!**/__pycache__/**', '!**/*.min.js',
]

const MAX_LINE_BYTES = 512

/** Source extensions per language, for narrowing the grep. */
const EXTENSIONS_OF: Record<string, string[]> = {
  typescript: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'],
  javascript: ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'],
  python: ['py', 'pyi'],
  go: ['go'],
  rust: ['rs'],
  java: ['java'],
  c: ['c', 'h'],
  cpp: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'h'],
  csharp: ['cs'],
  kotlin: ['kt', 'kts'],
  swift: ['swift'],
  ruby: ['rb'],
  php: ['php'],
}

/** The `include` glob for the host's search Remote. */
export function searchIncludeFor(language: string): string | undefined {
  const ext = EXTENSIONS_OF[language]
  if (ext === undefined) return undefined
  // ripgrep treats a comma-separated glob list as several patterns, but a
  // NEGATION inside a {} expansion silently matches nothing — so the includes
  // must be one alternative group and the excludes must stay top-level entries.
  const includes = '{' + ext.map((e) => '**/*.' + e).join(',') + '}'
  // ORDER MATTERS: ripgrep applies later entries as further filters, so a
  // trailing '!pattern' turns the whole list into an exclusion. Excludes go
  // FIRST, the include union LAST.
  return EXCLUDED_GLOBS.concat([includes]).join(',')
}

export function supportsDefinition(language: string): boolean {
  return INDEXED_LANGUAGES.has(language)
}

/** True when Monaco's own language service can resolve this file — the
 *  TypeScript worker is compiler-accurate, the index is only a fallback. */
export function hasLanguageService(language: string): boolean {
  return language === 'typescript' || language === 'javascript'
}

/** The identifier under the cursor, or the whole `a.b.c` chain it belongs
 *  to, plus the last segment — what a definition search actually keys on. */
export function symbolAt(lineText: string, column: number): { chain: string; name: string } | null {
  const isIdentChar = (c: string | undefined): boolean =>
    c !== undefined && (/[A-Za-z0-9_$]/.test(c) || c === '.' || c.charCodeAt(0) > 127)
  const idx = Math.min(Math.max(column - 1, 0), Math.max(lineText.length - 1, 0))
  // A caret sitting right after an identifier still belongs to it.
  let start = idx
  if (start >= lineText.length || !isIdentChar(lineText[start])) start = idx - 1
  if (start < 0 || !isIdentChar(lineText[start])) return null
  let s = start
  let e = start + 1
  while (s > 0 && isIdentChar(lineText[s - 1])) s -= 1
  while (e < lineText.length && isIdentChar(lineText[e])) e += 1
  const chain = lineText.slice(s, e).replace(/^\.+|\.+$/g, '')
  if (chain === '') return null
  const segments = chain.split('.').filter((x) => x !== '')
  const name = segments[segments.length - 1] ?? ''
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return null
  return { chain, name }
}
// ── declaration grammars ────────────────────────────────────────────────

/** A declaration head recognised on one line. `index` is the offset of the
 *  declared NAME inside that line, so the caret lands on the identifier. */
interface DeclHit { index: number; container?: string }

interface Grammar {
  /** Does this line DECLARE `name` (rather than merely use it)? */
  decl(line: string, name: string): DeclHit | null
}

/** Offset of a whole-word occurrence of `name` in `line`, or -1. */
function wholeWordIndex(line: string, name: string): number {
  const isW = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_$]/.test(c)
  let at = line.indexOf(name)
  while (at !== -1) {
    if (!isW(line[at - 1]) && !isW(line[at + name.length])) return at
    at = line.indexOf(name, at + 1)
  }
  return -1
}

/** True when `before` ends with `kw` as a standalone word. */
function endsWithKeyword(before: string, kw: string): boolean {
  const trimmed = before.replace(/[\s*&<>,]+$/, '')
  if (!trimmed.endsWith(kw)) return false
  const c = trimmed[trimmed.length - kw.length - 1]
  return c === undefined || !/[A-Za-z0-9_$]/.test(c)
}

/** Strip a leading comment/attribute decoration so a declaration that follows
 *  it on the same line is still recognised. */
/** True when the whole line is commented out (or a block-comment body). A
 *  commented-out declaration must never be offered as a definition:
 *  `/*String result = retryer.execute(() -> test("test"), ...` used to parse
 *  as a declaration of `test`. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  return /^(\/\/|\/\*|\*|#(?![\[!])|--\s)/.test(trimmed)
}

function stripLeading(line: string): string {
  return line.replace(/^\s*(\/\/|#(?![\[!])|\/\*+\s*|\*\s+)/, ' ').replace(/\s+$/, '')
}

/** TypeScript / JavaScript declarations. */
const TS_GRAMMAR: Grammar = {
  decl(line, name) {
    const l = stripLeading(line)
    const at = wholeWordIndex(l, name)
    if (at === -1) return null
    const before = l.slice(0, at)
    const after = l.slice(at + name.length)
    // function name( / class name / interface name / type name = / enum name
    for (const kw of ['function', 'class', 'interface', 'enum', 'namespace'] as const) {
      if (endsWithKeyword(before, kw)) return { index: at }
    }
    if (endsWithKeyword(before, 'type') && /^\s*[=<]/.test(after)) return { index: at }
    // const name = / let name: / var name
    for (const kw of ['const', 'let', 'var'] as const) {
      if (endsWithKeyword(before, kw)) return { index: at }
    }
    // name(params) { — a method inside a class/object literal. A bare
    // `name(...)` at statement start is a CALL, so the line must carry a
    // declaration marker before the name: a modifier/type, an opening brace
    // or comma (object literal), or 'async'/'get'/'set'.
    if (/^\s*\??\s*[(<]/.test(after) && !/[.=]\s*$/.test(before)) {
      const modifierish = /(^|[\s;{},])(public|private|protected|static|readonly|abstract|override|async|get|set|\*)\s+$/.test(before)
      const objectKey = /[{{,]\s*$/.test(before)
      // An INDENTED `name(params) {` is a method in a class or object
      // literal (the `{`/`}` is on another line); requiring a marker on
      // the same line missed `  bar(x) {` — the common object-literal
      // method in plain JS, config files and .mjs modules.
      const trailingBrace = /\{\s*$/.test(after.replace(/:\s*$/, ''))
      const indented = /^[ \t]+$/.test(before)
      if (modifierish || objectKey) return { index: at }
      const CONTROL = /^(if|for|while|switch|catch|with|do|else|try|finally|function|return|typeof|await|yield)$/
      if (indented && trailingBrace && !CONTROL.test(name)) return { index: at }
    }
    return null
  },
}

/** Python: def name( / async def name( / class Name. */
const PY_GRAMMAR: Grammar = {
  decl(line, name) {
    const l = stripLeading(line)
    const at = wholeWordIndex(l, name)
    if (at === -1) return null
    const before = l.slice(0, at)
    if (endsWithKeyword(before, 'def')) return { index: at }
    if (endsWithKeyword(before, 'class')) return { index: at }
    // `name = ...` at module level is a definition too (constants).
    if (endsWithKeyword(before, 'async')) return { index: at }
    return null
  },
}

/** Go: func name( / func (r T) name( / type Name struct { ... }. */
const GO_GRAMMAR: Grammar = {
  decl(line, name) {
    const l = stripLeading(line)
    const at = wholeWordIndex(l, name)
    if (at === -1) return null
    const before = l.slice(0, at)
    const after = l.slice(at + name.length)
    // func name(   |   func (r *T) name(   |   func (r T) name(  — the
    // receiver sits between the keyword and the name.
    if (/\bfunc\s*(\([^)]*\)\s*)?$/.test(before) && /^\s*[\[(]/.test(after)) return { index: at }
    // type Name struct/interface/…
    if (/\btype\s*$/.test(before) && /^\s+(struct|interface|func|map|\[|[A-Za-z_])/.test(after)) return { index: at }
    // Interface method: an INDENTED `Name(...)` — `\tSave(file *multipart
    // .FileHeader, dst string) (string, error)`. Go has no keyword here, so
    // the shape must be tight enough to exclude calls: an empty parameter
    // list, a body-less signature, or parameters that carry a TYPE (`x string`,
    // `*T`, `[]T`, `...T`). A plain `foo(1)` / `handle(req)` is a CALL and
    // must not match, so require at least one typed parameter.
    if (/^[ \t]+$/.test(before) && /^\s*\(([^()]*)\)/.test(after)) {
      const params = /^\s*\(([^()]*)\)/.exec(after)?.[1] ?? ''
      const typed = /[\w\]>.]\s+[*\[\w]/.test(params) || /\*[A-Za-z_]|\[\]|\[\d*\]|\.\.\./.test(params)
      // `Name()` alone is a CALL (`showLogo()`); an interface method with no
      // parameters still carries a result type: `Name() error`.
      const rest = after.slice(/^\s*\(([^()]*)\)/.exec(after)?.[0].length ?? 0)
      const hasResult = /^\s+[*\[\w(]/.test(rest) || /^\s*$/.test(rest) && params.trim() !== ''
      if (typed || (params.trim() === '' && hasResult && /^\s*\S/.test(rest))) return { index: at }
    }
    return null
  },
}

/** Rust: fn name / struct / enum / trait / impl / type / const / static. */
const RUST_GRAMMAR: Grammar = {
  decl(line, name) {
    const l = stripLeading(line)
    const at = wholeWordIndex(l, name)
    if (at === -1) return null
    const before = l.slice(0, at)
    const after = l.slice(at + name.length)
    for (const kw of ['fn', 'struct', 'enum', 'trait', 'mod', 'type', 'const', 'static'] as const) {
      if (endsWithKeyword(before, kw)) return { index: at }
    }
    // `impl Level for X {…}` IMPLEMENTS the trait, it does not declare it, and
    // neither does `impl Level`. Treating them as declarations ranked an impl
    // block above the real `trait Level` line and sent the jump to the wrong
    // file. Only a bare `impl Name {` (an inherent impl) is accepted here.
    if (/\bimpl\s*(<[^>]*>\s*)?(\w+::)*$/.test(before)) {
      if (/^\s*(<|for\b|where\b)/.test(after)) return null
      return { index: at }
    }
    return null
  },
}

/** Java: class/interface/enum/record, and `ReturnType name(` methods. */
const JAVA_GRAMMAR: Grammar = {
  decl(line, name) {
    const l = stripLeading(line)
    const at = wholeWordIndex(l, name)
    if (at === -1) return null
    const before = l.slice(0, at)
    const after = l.slice(at + name.length)
    for (const kw of ['class', 'interface', 'enum', 'record'] as const) {
      if (endsWithKeyword(before, kw)) return { index: at }
    }
    // `public static void run(` — a method: type + name + '('. Instance
    // creation (`new X()`) and plain calls share the shape, so exclude the
    // `new`/`return new` forms: a `return new RedisService();` line was
    // ranked ahead of the real `class RedisService` declaration.
    if (/^\s*[(<]/.test(after) && /[\w\]>]\s+$/.test(before) && !/[.=]\s*$/.test(before)) {
      if (/\bnew\s+([\w.]*\.)?$/.test(before)) return null
      if (/\breturn\s*$/.test(before)) return null
      return { index: at }
    }
    return null
  },
}

/** C / C++ / C# / Kotlin / Swift / Ruby / PHP share keyword-led shapes. */
function keywordGrammar(keywords: readonly string[], allowMethodShape = false): Grammar {
  return {
    decl(line, name) {
      const l = stripLeading(line)
      const at = wholeWordIndex(l, name)
      if (at === -1) return null
      const before = l.slice(0, at)
      const after = l.slice(at + name.length)
      for (const kw of keywords) if (endsWithKeyword(before, kw)) return { index: at }
      // `ReturnType name(` declares; `net.test()` / `p->run()` CALL. Rejecting
      // only a trailing '.'/'=' let qualified calls through, because the dot
      // sits two characters back from the name.
      if (allowMethodShape && /^\s*[(<]/.test(after) && /[\w\]>*]\s+$/.test(before) && !/[.=]\s*$/.test(before)) {
        const isCall = /->$/.test(before) || /\b(new|delete)\s+(\w+::)?$/.test(before)
        if (!isCall) return { index: at }
      }
      return null
    },
  }
}

const GRAMMARS: Record<string, Grammar> = {
  typescript: TS_GRAMMAR,
  javascript: TS_GRAMMAR,
  python: PY_GRAMMAR,
  go: GO_GRAMMAR,
  rust: RUST_GRAMMAR,
  java: JAVA_GRAMMAR,
  c: keywordGrammar(['struct', 'enum', 'union', 'typedef'], true),
  cpp: keywordGrammar(['class', 'struct', 'enum', 'namespace', 'using'], true),
  csharp: keywordGrammar(['class', 'interface', 'struct', 'enum', 'record', 'void'], true),
  kotlin: keywordGrammar(['fun', 'class', 'interface', 'object', 'val', 'var']),
  swift: keywordGrammar(['func', 'class', 'struct', 'enum', 'protocol', 'extension', 'let', 'var']),
  ruby: keywordGrammar(['def', 'class', 'module']),
  php: keywordGrammar(['function', 'class', 'interface', 'trait']),
}

export function grammarFor(language: string): Grammar | undefined {
  return GRAMMARS[language]
}

// ── search result → definition targets ──────────────────────────────────

/** A grep hit, as the host's search Remote reports it. */
export interface GrepHit { path: string; lineNumber: number; line: string }

/** Keep only hits that DECLARE the symbol, best-effort ordered by how likely
 *  they are the real definition. Use sites are dropped so a common name does
 *  not produce a wall of identical offers. */
export function definitionsFromHits(
  hits: readonly GrepHit[],
  name: string,
  language: string,
  workspaceRoot: string,
): DefinitionTarget[] {
  const grammar = grammarFor(language)
  if (grammar === undefined) return []
  const out: DefinitionTarget[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    // A commented-out line is not a definition in any language.
    if (isCommentLine(hit.line)) continue
    const decl = grammar.decl(hit.line, name)
    if (decl === null) continue
    const key = hit.path + ':' + String(hit.lineNumber)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      path: hit.path,
      line: hit.lineNumber,
      column: decl.index + 1,
      endColumn: decl.index + 1 + name.length,
      preview: hit.line.trim().slice(0, MAX_LINE_BYTES),
    })
  }
  return rankTargets(out, name, workspaceRoot)
}

/** Sort: exact-name declarations in non-test files first, then test files,
 *  then anything else — so `button.ts` beats `button.test.ts`. */
function rankTargets(targets: DefinitionTarget[], name: string, workspaceRoot: string): DefinitionTarget[] {
  const isTest = (p: string): boolean => /(\.test\.|\.spec\.|_test\.|(^|\/)test(s)?\/|(^|\/)__tests__\/)/.test(p)
  const depth = (p: string): number => p.replace(workspaceRoot, '').split('/').length
  return [...targets].sort((a, b) => {
    const at = isTest(a.path) ? 1 : 0
    const bt = isTest(b.path) ? 1 : 0
    if (at !== bt) return at - bt
    // A declaration whose line starts with the name (``name(` `def name(`)
    // ranks above one buried behind modifiers.
    const aLead = a.preview.indexOf(name) <= 8 ? 0 : 1
    const bLead = b.preview.indexOf(name) <= 8 ? 0 : 1
    if (aLead !== bLead) return aLead - bLead
    const ad = depth(a.path)
    const bd = depth(b.path)
    if (ad !== bd) return ad - bd
    return a.path.localeCompare(b.path)
  })
}

/** Grammar language of a path. Kept local (rather than importing the editor's
 *  full extension table) so this module stays free of client dependencies and
 *  can be unit-tested in plain Node. */
export function languageOfPath(path: string): string {
  const ext = (path.split('/').pop() ?? '').toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', pyi: 'python', go: 'go', rs: 'rust', java: 'java',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
    cs: 'csharp', kt: 'kotlin', kts: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php',
  }
  return map[ext] ?? 'plaintext'
}
