/**
 * Path resolution for Go-to-Definition on FILE references.
 *
 * Clicking a symbol asks the language service (or the declaration index).
 * Clicking a PATH is a different question — "which file does this string
 * mean?" — and every ecosystem spells it differently:
 *
 *   TS/JS   import x from './util'            (extension-less, index.js, aliases)
 *   Python  from .models import User          (dotted, relative dots)
 *   Go      import "example.com/mod/pkg"      (module path, not a filesystem path)
 *   Rust    mod foo;  use crate::a::b;        (module tree, not files)
 *   Java    import com.acme.User;             (package = directory)
 *   C/C++   #include "util.h"                 (relative or include dir)
 *
 * This module turns each of those into an ordered list of candidate paths;
 * the caller stats them in order and opens the first that exists. Pure (no
 * host access) so it can be unit-tested directly.
 */

/** A resolved-or-candidate file path, plus the line/column to land on. */
export interface PathCandidate {
  /** Absolute path to try. */
  path: string
  /** 1-based line to reveal; 1 when the whole file is the target. */
  line: number
  /** 1-based column, when the target is a specific identifier. */
  column: number
}

/** Extensions tried in order when an import omits one. Order matters: a .ts
 *  next to a .js is the source, so TypeScript first for TS-flavoured dirs. */
const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

/** Extension order biased by the importing file, so a .tsx component import
 *  tries .tsx before .ts and a .mjs module tries .mjs before .js. */
export function extensionOrderFor(fromFile: string): string[] {
  if (/\.tsx$/.test(fromFile)) return ['.tsx', '.ts', '.jsx', '.js', '.mts', '.cts', '.mjs', '.cjs']
  if (/\.(mjs|cjs)$/.test(fromFile)) return ['.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.mts', '.cts']
  if (/\.jsx$/.test(fromFile)) return ['.jsx', '.js', '.tsx', '.ts', '.mjs', '.cjs', '.mts', '.cts']
  return TS_EXTENSIONS
}

/** /a/b/c.ts -> /a/b */
export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

/** Join and normalise: collapses '//', '.' and '..' without touching the drive
 *  or a leading slash. Implemented locally because the client bundle has no
 *  node:path and these paths are always POSIX-style workspace paths. */
export function joinPath(...parts: string[]): string {
  const joined = parts.filter((p) => p !== '').join('/')
  const absolute = joined.startsWith('/')
  const out: string[] = []
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { out.pop(); continue }
    out.push(seg)
  }
  return (absolute ? '/' : '') + out.join('/')
}
/** What kind of path reference sits under the caret. */
export interface PathReference {
  /** The raw text as written between quotes (no quotes). */
  raw: string
  /** 1-based column of the first character inside the quotes. */
  column: number
  /** How to interpret `raw`. */
  kind: 'ts-import' | 'py-import' | 'go-import' | 'rust-mod' | 'rust-use' | 'java-import' | 'c-include' | 'literal-path'
}

/** Strip quotes from a quoted literal at `at`, returning the inner text and
 *  its start column (1-based). */
function quotedAt(line: string, at: number): { raw: string; column: number } | null {
  const q = line[at]
  if (q !== String.fromCharCode(34) && q !== String.fromCharCode(39) && q !== '`') return null
  const end = line.indexOf(q, at + 1)
  if (end === -1) return null
  return { raw: line.slice(at + 1, end), column: at + 2 }
}

/** Find the quoted literal covering `column` (1-based), if the caret sits
 *  inside or on the edge of it. */
function quotedAtCaret(line: string, column: number): { raw: string; column: number; start: number } | null {
  const quotes = [String.fromCharCode(34), String.fromCharCode(39), '`']
  for (const q of quotes) {
    let start = line.indexOf(q)
    while (start !== -1) {
      const end = line.indexOf(q, start + 1)
      if (end === -1) break
      // Caret anywhere in [opening quote, closing quote] counts as a hit.
      if (column - 1 >= start && column - 1 <= end) return { raw: line.slice(start + 1, end), column: start + 2, start }
      start = line.indexOf(q, end + 1)
    }
  }
  return null
}

/** Recognise a path reference on `line` at `column`, using the syntax of
 *  `language`. Returns null when the caret is not on one. */
export function pathReferenceAt(line: string, column: number, language: string): PathReference | null {
  const hit = quotedAtCaret(line, column)
  if (hit === null) return null
  const { start: _start, ...quoted } = hit
  const trimmed = line.trim()

  if (language === 'typescript' || language === 'javascript') {
    // import … from 'x'   |   export … from 'x'   |   import 'x'
    if (/(^|\s)(import|export)\b/.test(trimmed) && /\bfrom\b/.test(line)) return { ...quoted, kind: 'ts-import' }
    if (/^\s*import\s/.test(line)) return { ...quoted, kind: 'ts-import' }
    // require('x') / import('x')
    // Slice up to the literal's OWN opening quote: indexOf(quoted.raw) finds
    // the first textual occurrence, which can be a comment or identifier
    // earlier on the line, making a real require() look like something else.
    if (/\b(require|import)\s*\($/.test(line.slice(0, hit.start))) return { ...quoted, kind: 'ts-import' }
  }
  if (language === 'python') {
    if (/^\s*(from|import)\s/.test(line)) return { ...quoted, kind: 'py-import' }
  }
  if (language === 'go') {
    if (/^\s*"[^"]+"\s*$/.test(trimmed)) return { ...quoted, kind: 'go-import' }
    if (/^\s*import\b/.test(line)) return { ...quoted, kind: 'go-import' }
  }
  if (language === 'rust') {
    if (/^\s*(pub\s+)?mod\s/.test(line)) return { ...quoted, kind: 'rust-mod' }
    if (/^\s*use\s/.test(line) || /^\s*pub\s+use\s/.test(line)) return { ...quoted, kind: 'rust-mod' }
    if (/^\s*(#\[)?include(_str|_bytes)?!?\s*\(?/.test(line)) return { ...quoted, kind: 'c-include' }
  }
  if (language === 'java' || language === 'kotlin') {
    if (/^\s*import\s/.test(line)) return { ...quoted, kind: 'java-import' }
  }
  if (language === 'c' || language === 'cpp') {
    if (/^\s*#\s*include/.test(line)) return { ...quoted, kind: 'c-include' }
  }
  // Anything else: only treat it as a path when it LOOKS like one, so a
  // random string literal does not hijack the click.
  if (/^(\.{1,2}\/|\/)/.test(quoted.raw) || /^[\w@-]+(\/[\w@.-]+)+\.\w+$/.test(quoted.raw)) {
    return { ...quoted, kind: 'literal-path' }
  }
  return null
}
/** Candidate files a reference could mean, most likely first. The caller stats
 *  them in order. `fromFile` is the file containing the reference. */
export function candidatesFor(ref: PathReference | null, fromFile: string, workspaceRoot: string): PathCandidate[] {
  // Tolerate a missing reference: callers often obtain one via
  // pathReferenceAt(...) and may pass the result straight through.
  if (ref === null) return []
  const here = dirname(fromFile)
  const out: PathCandidate[] = []
  const push = (path: string): void => {
    const p = joinPath(path)
    if (!out.some((c) => c.path === p)) out.push({ path: p, line: 1, column: 1 })
  }
  const order = extensionOrderFor(fromFile)
  const pushWithExtensions = (base: string): void => {
    // Any trailing extension is authoritative: './data.json' must resolve to
    // data.json, not data.json.ts/.tsx/… (the old filter only recognised
    // .[cm]?[jt]sx? and manufactured impossible names for every other file).
    if (/\.[A-Za-z0-9]+$/.test(base) && !/\.(d)$/.test(base)) { push(base); return }
    for (const ext of order) push(base + ext)
    // Directory import: index/mod files.
    for (const ext of order) push(joinPath(base, 'index' + ext))
    for (const ext of order) push(joinPath(base, 'mod' + ext))
  }

  switch (ref.kind) {
    case 'ts-import': {
      if (ref.raw.startsWith('/')) {
        // Absolute specifier: keep it absolute. Joining it onto the referrer's
        // directory produced /w/src/home/u/... for '/home/u/...'.
        pushWithExtensions(ref.raw)
      } else if (ref.raw.startsWith('.')) pushWithExtensions(joinPath(here, ref.raw))
      else if (ref.raw.startsWith('@/')) pushWithExtensions(joinPath(workspaceRoot, 'src', ref.raw.slice(2)))
      else if (ref.raw.startsWith('~/')) pushWithExtensions(joinPath(workspaceRoot, ref.raw.slice(2)))
      else {
        // Bare specifier: a workspace package source dir is worth trying
        // before giving up (monorepos alias their own packages this way).
        pushWithExtensions(joinPath(workspaceRoot, 'src', ref.raw))
        pushWithExtensions(joinPath(workspaceRoot, 'packages', ref.raw))
      }
      break
    }
    case 'py-import': {
      // from .models import User   /   import pkg.mod   /   from pkg.mod import x
      const dotted = ref.raw
      const dots = /^(\.+)/.exec(dotted)?.[1] ?? ''
      // `.` means the current package, each extra dot goes up one level.
      let base = here
      if (dots.length > 0) {
        let up = dots.length - 1
        while (up > 0) { base = dirname(base); up -= 1 }
      } else {
        base = workspaceRoot
      }
      const rest = dotted.slice(dots.length).replace(/\./g, '/')
      // An absolute import may be rooted at the workspace OR at a src/
      // layout (Django apps, MaxKB, most modern packages).
      const roots = dots.length > 0 ? [base] : [base, joinPath(base, 'src')]
      if (rest !== '') {
        for (const root of roots) {
          push(joinPath(root, rest + '.py'))
          push(joinPath(root, rest, '__init__.py'))
        }
      } else {
        for (const root of roots) push(joinPath(root, '__init__.py'))
      }
      break
    }
    case 'go-import': {
      // A Go import path is MODULE-relative: 'github.com/gin-gonic/gin/router'
      // is never a directory under the repo. Try the progressively shorter
      // suffixes so a repo whose go.mod module is the prefix still resolves
      // ('.../v2' stripped, since /vN is a version marker, not a directory).
      const clean = ref.raw.replace(/\/v[0-9]+$/, '')
      const segs = clean.split('/').filter((x: string) => x !== '')
      // i starts at 1: segs[0] is a registry host ('github.com'), which is
      // never a directory inside the repo, so grafting it on the root can
      // only produce a dead path.
      for (let i = 1; i < segs.length; i += 1) {
        push(joinPath(workspaceRoot, segs.slice(i).join('/')))
      }
      push(joinPath(workspaceRoot, 'vendor', clean))
      break
    }
    case 'rust-mod': {
      const name = ref.raw.trim()
      if (name === '') break
      if (name.includes('/')) { pushWithExtensions(joinPath(here, name)); break }
      // mod foo;  ->  foo.rs  or  foo/mod.rs
      if (name.includes('::')) {
        const segs = name.replace(/^(crate|self|super)::/, '').split('::')
        push(joinPath(here, segs.join('/') + '.rs'))
        push(joinPath(here, segs.join('/'), 'mod.rs'))
        push(joinPath(workspaceRoot, 'src', segs.join('/') + '.rs'))
      } else {
        push(joinPath(here, name + '.rs'))
        push(joinPath(here, name, 'mod.rs'))
      }
      break
    }
    case 'java-import': {
      // `import com.acme.User;` -> com/acme/User.java under each source root.
      // The dotted name is PACKAGE.CLASS, so only the package dots become
      // separators; appending '.java' to the whole string produced
      // `User.java.java` for an import that already carried the suffix.
      const bare = ref.raw.replace(/\.java$/, '')
      const parts = bare.split('.').filter((x: string) => x !== '')
      if (parts.length === 0) break
      const rel = parts.join('/') + '.java'
      for (const root of ['src/main/java', 'src', '']) push(joinPath(workspaceRoot, root, rel))
      break
    }
    case 'c-include': {
      push(joinPath(here, ref.raw))
      for (const root of ['include', 'src', '']) push(joinPath(workspaceRoot, root, ref.raw))
      break
    }
    case 'literal-path': {
      if (ref.raw.startsWith('/')) push(ref.raw)
      else push(joinPath(here, ref.raw))
      break
    }
  }
  return out
}
/** Python `from .models import User` carries the path WITHOUT quotes, so the
 *  generic quoted-literal scan cannot see it. This recognises the token under
 *  the caret in that form and returns it as a reference. */
export function pythonDottedAt(line: string, column: number): PathReference | null {
  const m = /^\s*(from|import)\s+([\w.]+)/.exec(line)
  if (m === null) return null
  const token = m[2]
  if (token === undefined || token === '') return null
  const start = line.indexOf(token, m[1].length)
  // The caret must sit inside the token (or on its boundary).
  if (column - 1 < start || column - 1 > start + token.length) return null
  return { raw: token, column: start + 1, kind: 'py-import' }
}