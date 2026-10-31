/**
 * Explorer copy/paste rules: the "- copy" suffix sequence and the relative
 * path derivation used by 'Copy Relative Path'.
 */
import { nonCollidingName, relPathOf } from '../src/client/explorer/copy-name.ts'
import { readFileSync } from 'node:fs'

let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }
const S = (...a) => new Set(a)

// --- name derivation ---
check('a free name is kept', nonCollidingName('a.ts', S('b.ts')) === 'a.ts')
check('a taken name gets "- copy"', nonCollidingName('a.ts', S('a.ts')) === 'a - copy.ts')
check('the next copy is "- copy 2"', nonCollidingName('a.ts', S('a.ts', 'a - copy.ts')) === 'a - copy 2.ts')
check('the copy after that is "- copy 3"', nonCollidingName('a.ts', S('a.ts', 'a - copy.ts', 'a - copy 2.ts')) === 'a - copy 3.ts')
check('no gap: "- copy 2" is never skipped',
  nonCollidingName('x.md', S('x.md', 'x - copy.md')) !== 'x - copy 3.md')
check('extensionless file', nonCollidingName('README', S('README')) === 'README - copy')
check('dotfile keeps its whole name', nonCollidingName('.gitignore', S('.gitignore')) === '.gitignore - copy')
check('directories get the suffix too', nonCollidingName('src', S('src')) === 'src - copy')
check('multi-dot splits at the LAST dot', nonCollidingName('a.test.ts', S('a.test.ts')) === 'a.test - copy.ts')

// --- relative paths ---
check('normal nested path', relPathOf('/w/proj', '/w/proj/src/a.ts') === 'src/a.ts')
check('trailing separator on the root', relPathOf('/w/proj/', '/w/proj/src/a.ts') === 'src/a.ts')
check('filesystem root', relPathOf('/', '/src/a.ts') === 'src/a.ts')
check('a root string appearing MID-path is not stripped',
  relPathOf('/w/proj', '/x/w/proj/a.ts') === '/x/w/proj/a.ts',
  relPathOf('/w/proj', '/x/w/proj/a.ts'))
check('a sibling sharing the prefix keeps its full path',
  relPathOf('/w/proj', '/w/proj2/a.ts') === '/w/proj2/a.ts')
check('the path equal to the root is empty', relPathOf('/w/proj', '/w/proj') === '')
check('backslashes are normalised', relPathOf('C:\\w\\proj', 'C:\\w\\proj\\src\\a.ts') === 'src/a.ts')


// --- clipboard helper: must never reject into an unhandled promise ---
{
  const { copyText } = await import('../src/client/clipboard.ts')
  const saved = globalThis.navigator
  try {
    delete globalThis.navigator
    check('copyText tolerates a missing navigator', (await copyText('x')) === false)
    globalThis.navigator = { clipboard: { writeText: () => Promise.reject(new Error('denied')) } }
    check('copyText tolerates a refused write', (await copyText('x')) === false)
    let got = null
    globalThis.navigator = { clipboard: { writeText: (v) => { got = v; return Promise.resolve() } } }
    check('copyText reports success', (await copyText('hello')) === true)
    check('copyText writes the exact text', got === 'hello', String(got))
  } finally {
    if (saved !== undefined) globalThis.navigator = saved
    else delete globalThis.navigator
  }
}

// --- no call site may write to the clipboard directly any more ---
{
  const files = [
    'src/client/explorer/FileTree.tsx',
    'src/client/git/SourceControlPanel.tsx',
    'src/client/git/GraphView.tsx',
    'src/client/git/BranchesView.tsx',
    'src/client/editor/StatusBar.tsx',
    'src/client/IdeView.tsx',
  ]
  for (const f of files) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8')
    check(f.split('/').pop() + ' does not call navigator.clipboard directly',
      !src.includes('navigator.clipboard'))
  }
}

// --- the notifier factory must never throw, even with a broken notifier ---
{
  const { copyFailureNotifier } = await import('../src/client/clipboard.ts')
  const saved = globalThis.navigator
  try {
    delete globalThis.navigator
    const notify = copyFailureNotifier((k) => k, 'x')
    check('the failure notifier is callable', typeof notify === 'function')
    // Calling it outside a browser must not throw: the notification centre is
    // imported lazily and its rejection is swallowed.
    let threw = null
    try { notify() } catch (e) { threw = e }
    check('the failure notifier never throws', threw === null, String(threw))
    check('the failure notifier returns undefined', notify() === undefined)
  } finally {
    if (saved !== undefined) globalThis.navigator = saved
    else delete globalThis.navigator
  }
}

// --- copyTextOrNotify reports failure but stays silent on success ---
{
  const { copyTextOrNotify } = await import('../src/client/clipboard.ts')
  let failures = 0
  const notify = () => { failures += 1 }
  globalThis.navigator = { clipboard: { writeText: () => Promise.resolve() } }
  await copyTextOrNotify('ok', notify)
  check('success stays silent', failures === 0, String(failures))
  globalThis.navigator = { clipboard: { writeText: () => Promise.reject(new Error('no')) } }
  await copyTextOrNotify('bad', notify)
  check('failure is reported once', failures === 1, String(failures))
}
console.log(failed === 0 ? '\nall explorer copy checks passed' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)