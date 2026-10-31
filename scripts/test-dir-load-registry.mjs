/**
 * Tests for DirLoadRegistry — the load-await mechanism behind
 * "Reveal in Explorer". The bug this guards against: a collapsed folder never
 * opening when a tab is revealed.
 * Run: node --experimental-strip-types scripts/test-dir-load-registry.mjs
 */
import { DirLoadRegistry } from '../src/client/explorer/dir-load-registry.ts'

// The registry uses window.setTimeout/clearTimeout; provide a minimal shim.
globalThis.window = globalThis

let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed += 1
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -> ' + detail))
}

// 1. an already-loaded directory resolves immediately
{
  const r = new DirLoadRegistry()
  r.markLoaded('/w/a')
  const t = Date.now()
  const ok = await r.waitFor('/w/a', 5000)
  check('loaded directory resolves at once', ok === true && Date.now() - t < 50)
}

// 2. a pending wait is woken by markLoaded (the cascading-expansion case)
{
  const r = new DirLoadRegistry()
  let done = false
  const p = r.waitFor('/w/a', 5000).then((v) => { done = v; return v })
  await new Promise((res) => setTimeout(res, 20))
  check('waiter is pending before the load', done === false)
  r.markLoaded('/w/a')
  const ok = await p
  check('markLoaded wakes the waiter', ok === true && done === true)
}

// 3. a timeout resolves false instead of hanging forever
{
  const r = new DirLoadRegistry()
  const t = Date.now()
  const ok = await r.waitFor('/w/never', 60)
  const elapsed = Date.now() - t
  check('timeout resolves false (never hangs)', ok === false, String(ok))
  check('timeout honours the budget', elapsed >= 50 && elapsed < 1000, elapsed + 'ms')
}

// 4. collapsing a directory invalidates its mark: reveal must re-await it
//    (this is what made a collapsed folder fail to open).
{
  const r = new DirLoadRegistry()
  r.markLoaded('/w/a')
  r.markLoaded('/w/b')
  r.markUnloaded('/w/b')
  check('untouched dir stays loaded', r.isLoaded('/w/a') === true)
  check('collapsed dir becomes unloaded', r.isLoaded('/w/b') === false)
  // Reopening must NOT resolve from the stale mark: it has to be re-awaited.
  let settled = false
  void r.waitFor('/w/b', 1000).then(() => { settled = true })
  await new Promise((res) => setTimeout(res, 30))
  check('reopened dir no longer resolves from stale mark', settled === false)
}

// 5. clear() must CANCEL waiters, not report them as loaded. Claiming
//    success would make a reveal scroll a tree that was just blanked.
{
  const r = new DirLoadRegistry()
  const p = r.waitFor('/w/x', 5000)
  r.clear()
  const ok = await p
  check('clear cancels the waiter', ok === false, String(ok))
  check('clear forgets the mark', r.isLoaded('/w/x') === false)
}

// 5b. a timed-out waiter must not leak an entry in the waiters map.
{
  const r = new DirLoadRegistry()
  await r.waitFor('/w/leaky', 30)
  await r.waitFor('/w/leaky', 30)
  // No public accessor: use clear() on a dir that later loads — if the map
  // still held a stale waiter, markLoaded would wake a settled promise and
  // the recomputed list would be non-empty. Simpler proxy: waiters size.
  check('timed-out waiters are discarded', r.waiterCount('/w/leaky') === 0, String(r.waiterCount('/w/leaky')))
}

// 5c. two waiters, one times out, the other still gets woken correctly.
{
  const r = new DirLoadRegistry()
  const slow = r.waitFor('/w/y', 30)
  const late = r.waitFor('/w/y', 5000)
  const slowRes = await slow
  check('short waiter times out false', slowRes === false)
  r.markLoaded('/w/y')
  check('long waiter still resolves true', (await late) === true)
}

// 6. the sequential per-level await that revealPath performs
{
  const r = new DirLoadRegistry()
  const levels = ['/w/src', '/w/src/a', '/w/src/a/b']
  const seen = []
  // Simulate the tree: each level loads only after the previous is awaited.
  setTimeout(() => r.markLoaded('/w/src'), 10)
  setTimeout(() => r.markLoaded('/w/src/a'), 30)
  setTimeout(() => r.markLoaded('/w/src/a/b'), 50)
  const run = async () => {
    for (const dir of levels) {
      const ok = await r.waitFor(dir, 5000)
      if (!ok) return false
      seen.push(dir)
    }
    return true
  }
  const ok = await run()
  check('deep collapsed chain awaits every level in order', ok === true)
  check('levels resolved exactly once each', seen.length === 3, JSON.stringify(seen))
}

// 7. one stuck level stops the descent instead of reporting a false success
{
  const r = new DirLoadRegistry()
  setTimeout(() => r.markLoaded('/w/src'), 5)
  let reached = 0
  const run = async () => {
    for (const dir of ['/w/src', '/w/src/never', '/w/src/never/deep']) {
      const ok = await r.waitFor(dir, 40)
      if (!ok) return false
      reached += 1
    }
    return true
  }
  const ok = await run()
  check('stuck level aborts the descent', ok === false && reached === 1, 'reached=' + reached)
}

console.log(failed === 0 ? '\nall dir-load-registry checks passed' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)