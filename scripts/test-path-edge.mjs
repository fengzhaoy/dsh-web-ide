/** Windows-style path handling for reveal — the IDE runs in a browser but the
 *  host may report Windows paths. */
import { revealChain } from '../src/client/explorer/reveal-path.ts'
import { candidatesFor, pathReferenceAt } from '../src/client/editor/path-resolve.ts'
let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

check('windows: backslash path splits correctly',
  eq(revealChain('C:/work', 'C:/work/src/a.ts'), ['C:/work/src', 'C:/work/src/a.ts']),
  JSON.stringify(revealChain('C:/work', 'C:/work/src/a.ts')))

check('windows: mixed separators normalise',
  eq(revealChain('C:/work', 'C:/work/src\\a.ts'), ['C:/work/src', 'C:/work/src/a.ts']),
  JSON.stringify(revealChain('C:/work', 'C:/work/src\\a.ts')))

check('windows: outside root rejected', revealChain('C:/work', 'D:/other/a.ts') === null)

check('relative import from a windows file still resolves',
  (() => {
    // Column must fall INSIDE the quoted specifier: 'import x from ' is 15 chars,
    // so the opening quote is col 16 and './util' spans 17..23.
    const line = "import x from './util'"
    const ref = pathReferenceAt(line, line.indexOf('.') + 2, 'typescript')
    if (ref === null) return false
    const c = candidatesFor(ref, 'C:/w/src/app.ts', 'C:/w')
    return c.some((x) => x.path === 'C:/w/src/util.ts')
  })())

check('traversal above the root is not produced',
  (() => {
    const line = "import x from '../../../escape'"
    const ref = pathReferenceAt(line, line.indexOf('..') + 2, 'typescript')
    if (ref === null) return false
    const c = candidatesFor(ref, '/w/src/app.ts', '/w')
    return c.every((x) => !x.path.includes('/../'))
  })())


check('candidatesFor tolerates a null reference',
  JSON.stringify(candidatesFor(null, '/w/a.ts', '/w')) === '[]')

console.log(failed === 0 ? '\nall path-edge checks passed' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)