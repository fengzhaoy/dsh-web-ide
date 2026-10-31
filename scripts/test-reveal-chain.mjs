/**
 * Tests for revealChain — the path splitting behind "Reveal in Explorer".
 * Run: node --experimental-strip-types scripts/test-reveal-chain.mjs
 */
import { revealChain } from '../src/client/explorer/reveal-path.ts'

let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed += 1
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -> ' + detail))
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

check('nested file yields every ancestor then the file',
  eq(revealChain('/w', '/w/src/a/b.ts'), ['/w/src', '/w/src/a', '/w/src/a/b.ts']),
  JSON.stringify(revealChain('/w', '/w/src/a/b.ts')))

check('file directly in root',
  eq(revealChain('/w', '/w/README.md'), ['/w/README.md']),
  JSON.stringify(revealChain('/w', '/w/README.md')))

check('root itself reveals nothing', eq(revealChain('/w', '/w'), []), JSON.stringify(revealChain('/w', '/w')))

check('path outside the root is rejected', revealChain('/w', '/other/file.ts') === null)

check('a sibling with a shared prefix is rejected',
  revealChain('/w', '/w-other/file.ts') === null,
  JSON.stringify(revealChain('/w', '/w-other/file.ts')))

check('trailing slash on the root is tolerated',
  eq(revealChain('/w/', '/w/src/a.ts'), ['/w/src', '/w/src/a.ts']),
  JSON.stringify(revealChain('/w/', '/w/src/a.ts')))

check('deep nesting keeps every level',
  revealChain('/w', '/w/a/b/c/d/e.ts')?.length === 5,
  String(revealChain('/w', '/w/a/b/c/d/e.ts')?.length))

check('backslash paths are normalised',
  eq(revealChain('/w', '/w/src\\a.ts'), ['/w/src', '/w/src/a.ts']),
  JSON.stringify(revealChain('/w', '/w/src\\a.ts')))

check('trailing-slash root path yields nothing', eq(revealChain('/w', '/w/'), []), JSON.stringify(revealChain('/w', '/w/')))

console.log(failed === 0 ? '\nall reveal-chain checks passed' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)