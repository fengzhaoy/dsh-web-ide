/**
 * Reveal robustness: consecutive reveals and concurrent reveals.
 * Verifies reveal waits resolve for EVERY caller, not just the first — a
 * waiter that is dropped on wake would make the second double-click do
 * nothing, which reads to the user as "it stopped working".
 */
import { DirLoadRegistry } from '../src/client/explorer/dir-load-registry.ts'
import { revealChain } from '../src/client/explorer/reveal-path.ts'
globalThis.window = globalThis

let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }

const ROOT = '/w'
const FILES = { '/w/src': ['a.ts'], '/w/src/a': ['x.ts', 'y.ts'], '/w/src/b': ['z.ts'] }

function makeTree(delay, extra) {
  const reg = new DirLoadRegistry()
  const expanded = new Set()
  const mounted = new Set([ROOT])
  reg.markLoaded(ROOT)
  const tree = {
    reg, expanded, mounted,
    expand(dir) {
      expanded.add(dir)
      if (reg.isLoaded(dir)) return
      setTimeout(() => {
        if (!expanded.has(dir)) return
        for (const c of FILES[dir] ?? []) mounted.add(dir + '/' + c)
        if (extra && extra[dir]) { setTimeout(() => reg.markLoaded(dir), extra[dir]); return }
        reg.markLoaded(dir)
      }, delay) },
  }
  return tree
}

async function reveal(tree, target) {
  const chain = revealChain(ROOT, target)
  if (!chain || chain.length === 0) return false
  const dirs = chain.slice(0, -1)
  const file = chain[chain.length - 1]
  for (const d of dirs) tree.expand(d)
  for (const d of dirs) { if (!(await tree.reg.waitFor(d, 5000))) return false }
  await new Promise((r) => setTimeout(r, 5))
  return tree.mounted.has(file)
}

// 1. Two DIFFERENT waiters on the SAME directory must BOTH be woken.
{
  const reg = new DirLoadRegistry()
  const a = reg.waitFor('/w/src', 1000)
  const b = reg.waitFor('/w/src', 1000)
  setTimeout(() => reg.markLoaded('/w/src'), 10)
  const [ra, rb] = await Promise.all([a, b])
  check('two waiters on one dir both resolve', ra === true && rb === true)
}

// 2. Sequential reveals of different files in the same subtree.
{
  const t = makeTree(10)
  const first = await reveal(t, '/w/src/a/x.ts')
  const second = await reveal(t, '/w/src/a/y.ts')
  check('second reveal in the same folder works', first === true && second === true)
}

// 3. Reveal into a SIBLING folder after collapsing the first.
{
  const t = makeTree(10)
  await reveal(t, '/w/src/a/x.ts')
  for (const d of ['/w/src/a', '/w/src']) { t.expanded.delete(d); t.reg.markUnloaded(d) }
  const ok = await reveal(t, '/w/src/b/z.ts')
  check('reveal into a different branch works', ok === true)
}

// 4. Concurrent reveals (two tabs double-clicked quickly).
{
  const t = makeTree(10)
  const [r1, r2] = await Promise.all([reveal(t, '/w/src/a/x.ts'), reveal(t, '/w/src/b/z.ts')])
  check('concurrent reveals both succeed', r1 === true && r2 === true, JSON.stringify([r1, r2]))
}

// 5. A waiter registered while the dir is mid-load still gets woken.
{
  const t = makeTree(10, { '/w/src': 30 })
  const p = reveal(t, '/w/src/a/x.ts')
  await new Promise((r) => setTimeout(r, 15))   // lets /w/src start loading
  const ok = await p
  check('waiter added mid-load is woken', ok === true)
}

console.log(failed === 0 ? '\nall reveal robustness checks passed' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)