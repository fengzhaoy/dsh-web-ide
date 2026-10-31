/**
 * Path-reference tests for Go-to-Definition on file imports.
 * Run: node --experimental-strip-types scripts/test-path-resolve.mjs
 */
import { pathReferenceAt, candidatesFor, joinPath, dirname, pythonDottedAt } from '../src/client/editor/path-resolve.ts'

let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed += 1
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -> ' + detail))
}

// ── join / dirname ──────────────────────────────────────────────────────
check('join collapses ..', joinPath('/a/b', '../c') === '/a/c', joinPath('/a/b', '../c'))
check('join collapses .', joinPath('/a/b', './c.ts') === '/a/b/c.ts', joinPath('/a/b', './c.ts'))
check('join keeps leading slash', joinPath('/a', 'b') === '/a/b')
check('dirname of nested file', dirname('/a/b/c.ts') === '/a/b')
check('dirname of root file', dirname('/c.ts') === '/')

// ── TS / JS ─────────────────────────────────────────────────────────────
{
  const line = "import { runTask } from './util'"
  const ref = pathReferenceAt(line, line.indexOf('./util') + 2, 'typescript')
  check('ts: detects a relative import', ref?.kind === 'ts-import' && ref.raw === './util', JSON.stringify(ref))
  const cands = candidatesFor(ref, '/w/src/app.ts', '/w')
  check('ts: tries ./util.ts first', cands[0]?.path === '/w/src/util.ts', JSON.stringify(cands.slice(0, 3)))
  check('ts: also tries index files', cands.some((c) => c.path === '/w/src/util/index.ts'))
}
{
  const line = "export * from '../lib/core'"
  const ref = pathReferenceAt(line, line.indexOf('../lib/core') + 3, 'typescript')
  check('ts: export-from detected', ref?.kind === 'ts-import', JSON.stringify(ref))
  const cands = candidatesFor(ref, '/w/src/app.ts', '/w')
  check('ts: .. resolves upward', cands[0]?.path === '/w/lib/core.ts', JSON.stringify(cands.slice(0, 2)))
}
{
  const line = "const x = require('./legacy')"
  const ref = pathReferenceAt(line, line.indexOf('./legacy') + 2, 'javascript')
  check('js: require detected', ref?.kind === 'ts-import', JSON.stringify(ref))
}
{
  const line = "import x from './already.ts'"
  const ref = pathReferenceAt(line, 20, 'typescript')
  const cands = candidatesFor(ref, '/w/src/a.ts', '/w')
  check('ts: explicit extension not duplicated', cands[0]?.path === '/w/src/already.ts', JSON.stringify(cands.slice(0, 2)))
}
{
  // .tsx file importing a component
  const line = "import { Button } from './Button'"
  const ref = pathReferenceAt(line, line.indexOf('./Button') + 2, 'typescript')
  const cands = candidatesFor(ref, '/w/src/App.tsx', '/w')
  check('tsx: component import candidate', cands.some((c) => c.path === '/w/src/Button.tsx'), JSON.stringify(cands.slice(0, 3)))
}

// ── Python ──────────────────────────────────────────────────────────────
{
  const line = 'from .models import User'
  const ref = pathReferenceAt(line, 12, 'python')
  // A bare dotted import has no quotes; detection is by line shape, so the
  // resolver reports null here and the caller falls back to symbol search.
  check('py: dotted import without quotes is not a quoted path', ref === null, JSON.stringify(ref))
}
{
  const line = 'from .models import User'
  // Simulate the reference the caller builds for a dotted import.
  const cands = candidatesFor({ raw: '.models', column: 1, kind: 'py-import' }, '/w/pkg/app.py', '/w')
  check('py: relative import -> sibling module', cands[0]?.path === '/w/pkg/models.py', JSON.stringify(cands.slice(0, 2)))
  const deep = candidatesFor({ raw: '..core.utils', column: 1, kind: 'py-import' }, '/w/pkg/sub/app.py', '/w')
  check('py: ../.. goes up', deep[0]?.path === '/w/pkg/core/utils.py', JSON.stringify(deep.slice(0, 2)))
  const pkg = candidatesFor({ raw: 'models', column: 1, kind: 'py-import' }, '/w/pkg/app.py', '/w')
  check('py: absolute import from root', pkg[0]?.path === '/w/models.py', JSON.stringify(pkg.slice(0, 2)))
}

// ── Rust ────────────────────────────────────────────────────────────────
{
  const line = 'mod util;'
  const ref = pathReferenceAt(line, 5, 'rust')
  void ref
  const cands = candidatesFor({ raw: 'util', column: 1, kind: 'rust-mod' }, '/w/src/main.rs', '/w')
  check('rust: mod util -> util.rs', cands[0]?.path === '/w/src/util.rs', JSON.stringify(cands.slice(0, 2)))
  check('rust: also tries util/mod.rs', cands.some((c) => c.path === '/w/src/util/mod.rs'))
  const useCands = candidatesFor({ raw: 'crate::net::http', column: 1, kind: 'rust-mod' }, '/w/src/main.rs', '/w')
  check('rust: use crate::a::b', useCands[0]?.path === '/w/src/net/http.rs', JSON.stringify(useCands.slice(0, 2)))
}

// ── Java ────────────────────────────────────────────────────────────────
{
  const cands = candidatesFor({ raw: 'com.acme.User', column: 1, kind: 'java-import' }, '/w/src/main/java/App.java', '/w')
  check('java: package -> src/main/java', cands[0]?.path === '/w/src/main/java/com/acme/User.java', JSON.stringify(cands.slice(0, 2)))
  check('java: also tries bare src', cands.some((c) => c.path === '/w/src/com/acme/User.java'))
}

// ── C / C++ ─────────────────────────────────────────────────────────────
{
  const line = '#include "util.h"'
  const ref = pathReferenceAt(line, 12, 'c')
  check('c: #include detected', ref?.kind === 'c-include' && ref.raw === 'util.h', JSON.stringify(ref))
  const cands = candidatesFor(ref, '/w/src/main.c', '/w')
  check('c: relative first', cands[0]?.path === '/w/src/util.h', JSON.stringify(cands.slice(0, 2)))
  check('c: then include/', cands.some((c) => c.path === '/w/include/util.h'))
}

// ── guards ──────────────────────────────────────────────────────────────
{
  const line = 'const message = "hello world"'
  check('plain string not treated as a path', pathReferenceAt(line, 20, 'typescript') === null)
  check('code outside a string is not a path', pathReferenceAt('const x = 1', 7, 'typescript') === null)
  const rel = pathReferenceAt('const p = "./config.json"', 14, 'typescript')
  check('a relative literal is still a path', rel?.kind === 'literal-path', JSON.stringify(rel))
}


// ── Python dotted (no quotes) ───────────────────────────────────────────
{
  const line = 'from .models import User'
  const ref = pythonDottedAt(line, line.indexOf('.models') + 2)
  check('py: dotted form detected under the caret', ref?.kind === 'py-import' && ref.raw === '.models', JSON.stringify(ref))
  const away = pythonDottedAt(line, 2)
  check('py: caret outside the token is ignored', away === null, JSON.stringify(away))
  const cands = candidatesFor(ref, '/w/pkg/app.py', '/w')
  check('py: dotted form resolves to sibling', cands[0]?.path === '/w/pkg/models.py', JSON.stringify(cands.slice(0, 2)))
  const plain = pythonDottedAt('import os', 8)
  check('py: absolute import token', plain?.raw === 'os', JSON.stringify(plain))
}

// ── extension bias by importing file ────────────────────────────────────
import { extensionOrderFor } from '../src/client/editor/path-resolve.ts'
check('tsx importer tries .tsx first', extensionOrderFor('/w/App.tsx')[0] === '.tsx', extensionOrderFor('/w/App.tsx')[0])
check('mjs importer tries .mjs first', extensionOrderFor('/w/a.mjs')[0] === '.mjs', extensionOrderFor('/w/a.mjs')[0])
check('jsx importer tries .jsx first', extensionOrderFor('/w/a.jsx')[0] === '.jsx', extensionOrderFor('/w/a.jsx')[0])
check('ts importer keeps .ts first', extensionOrderFor('/w/a.ts')[0] === '.ts', extensionOrderFor('/w/a.ts')[0])
{
  const ref = pathReferenceAt("import { Button } from './Button'", 26, 'typescript')
  const cands = candidatesFor(ref, '/w/src/App.tsx', '/w')
  check('tsx: component import resolves .tsx first', cands[0]?.path === '/w/src/Button.tsx', JSON.stringify(cands.slice(0, 2)))
}
{
  const ref = pathReferenceAt("import { util } from './util'", 23, 'javascript')
  const cands = candidatesFor(ref, '/w/src/tool.mjs', '/w')
  check('mjs: prefers .mjs from a .mjs importer', cands[0]?.path === '/w/src/util.mjs', JSON.stringify(cands.slice(0, 2)))
}

// ── Path-resolution defects found by code review ──
const candsOf = (ref) => candidatesFor(ref, '/w/src/a.ts', '/w')

// Explicit non-JS extensions are authoritative.
{
  const ref = pathReferenceAt("import d from './data.json'", 20, 'typescript')
  const c = ref === null ? [] : candsOf(ref)
  check('path: ./data.json resolves to data.json', c.some((x) => x.path === '/w/src/data.json'), JSON.stringify(c.slice(0, 3)))
  check('path: ./data.json does not become data.json.ts', !c.some((x) => x.path === '/w/src/data.json.ts'))
}
// Java: the dotted name is PACKAGE.CLASS; no doubled extension.
{
  const c = candidatesFor({ raw: 'com.acme.User', column: 8, kind: 'java-import' }, '/w/src/X.java', '/w')
  check('path: java import -> com/acme/User.java', c.some((x) => x.path === '/w/src/main/java/com/acme/User.java'), JSON.stringify(c.slice(0, 3)))
  check('path: java import has no .java.java', c.every((x) => !x.path.includes('.java.java')))
}
// Python absolute imports also try a src/ layout.
{
  const line = 'from pkg.mod import User'
  const r = pythonDottedAt(line, line.indexOf('pkg') + 2)
  const c = r === null ? [] : candidatesFor(r, '/w/apps/app.py', '/w')
  check('path: python resolves at the workspace root', c.some((x) => x.path === '/w/pkg/mod.py'), JSON.stringify(c.slice(0, 4)))
  check('path: python also tries src/', c.some((x) => x.path === '/w/src/pkg/mod.py'), JSON.stringify(c.slice(0, 4)))
}
// Go imports are module-relative, never grafted onto the root.
{
  const line = 'import "github.com/gin-gonic/gin/router"'
  const r = pathReferenceAt(line, line.indexOf('github') + 3, 'go')
  const c = r === null ? [] : candidatesFor(r, '/w/cmd/main.go', '/w')
  check('path: go never grafts the registry host onto the root', !c.some((x) => x.path.startsWith('/w/github.com')), JSON.stringify(c.slice(0, 3)))
  check('path: go tries a shortened module suffix', c.some((x) => x.path === '/w/router'), JSON.stringify(c.slice(0, 4)))
}
// require() detected when the literal text also appears earlier on the line.
{
  const line = '/* from glog */ const x = require("./util")'
  const r = pathReferenceAt(line, line.indexOf('util') + 1, 'javascript')
  check('path: require() survives a duplicate token earlier on the line', r !== null && r.kind === 'ts-import', JSON.stringify(r))
}
// An absolute specifier stays absolute.
{
  const line = "import x from '/home/u/src/data.json'"
  const r = pathReferenceAt(line, line.indexOf('/home') + 2, 'typescript')
  const c = r === null ? [] : candidatesFor(r, '/w/src/a.ts', '/w')
  check('path: absolute import is not re-rooted under the referrer', !c.some((x) => x.path.startsWith('/w/src/home')), JSON.stringify(c.slice(0, 3)))
}
// A null reference must not throw.
check('path: candidatesFor tolerates null', candidatesFor(null, '/w/a.ts', '/w').length === 0)
console.log(failed === 0 ? '\nall path-resolution checks passed' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)