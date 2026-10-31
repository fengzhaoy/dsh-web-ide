/**
 * End-to-end simulation of Reveal-in-Explorer against a COLLAPSED tree.
 * Reproduces the reported bug: revealing a tab whose ancestors are collapsed
 * left the folders closed. Models the real tree's lazy-load contract:
 *   expand(dir) -> async load -> children mount -> next level can expand.
 */
import { DirLoadRegistry } from '../src/client/explorer/dir-load-registry.ts'
import { revealChain } from '../src/client/explorer/reveal-path.ts'
import { readFileSync } from 'node:fs'
globalThis.window = globalThis

let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }

const ROOT = '/w'
const FILES = { '/w/src': ['a.ts', 'b.ts'], '/w/src/a': ['deep.ts'], '/w/src/a/b': ['target.ts'] }

/** A stand-in for the real FileTree: lazy, one level at a time. */
function makeTree(delayPerLevel) {
  const reg = new DirLoadRegistry()
  const expanded = new Set()
  const mounted = new Set([ROOT])          // rows currently rendered
  reg.markLoaded(ROOT)
  // A directory loads only while expanded; children mount when it lands.
  const load = (dir) => {
    if (reg.isLoaded(dir)) return
    setTimeout(() => {
      if (!expanded.has(dir)) return          // collapsed again -> discarded
      for (const child of FILES[dir] ?? []) mounted.add(dir + '/' + child)
      reg.markLoaded(dir)
    }, delayPerLevel)
  }
  const expand = (dir) => { expanded.add(dir); load(dir) }
  const collapse = (dir) => {
    // Real FileTree: collapsing discards the node's WHOLE subtree (its
    // childState resets and every descendant unmounts).
    for (const d of [...expanded]) if (d === dir || d.startsWith(dir + '/')) { expanded.delete(d); reg.markUnloaded(d) }
    for (const p of [...mounted]) if (p === dir || p.startsWith(dir + '/')) mounted.delete(p)
  }
  return { reg, expanded, mounted, expand, collapse }
}

/** The reveal algorithm under test (mirrors FileTree.revealPath). */
async function reveal(tree, target) {
  const chain = revealChain(ROOT, target)
  if (chain === null || chain.length === 0) return false
  const dirs = chain.slice(0, -1)
  const file = chain[chain.length - 1]
  for (const d of dirs) tree.expand(d)
  for (const d of dirs) {
    const ok = await tree.reg.waitFor(d, 5000)
    if (!ok) return false
  }
  await new Promise((r) => setTimeout(r, 5))
  return tree.mounted.has(file)
}

// 1. EVERYTHING collapsed — the reported bug scenario
{
  const t = makeTree(20)
  const ok = await reveal(t, '/w/src/a/b/target.ts')
  check('all ancestors collapsed: folder opens and row mounts', ok === true)
  check('every level actually expanded', ['/w/src', '/w/src/a', '/w/src/a/b'].every((d) => t.expanded.has(d)), JSON.stringify([...t.expanded]))
}

// 2. slow first level (the poll-based version timed out here)
{
  const t = makeTree(80)
  const ok = await reveal(t, '/w/src/a/b/target.ts')
  check('slow levels still resolve (no DOM-poll timeout)', ok === true)
}

// 3. partially expanded
{
  const t = makeTree(15)
  t.expand('/w/src')
  await t.reg.waitFor('/w/src', 1000)
  const ok = await reveal(t, '/w/src/a/b/target.ts')
  check('partially expanded tree completes the rest', ok === true)
}

// 4. collapse then reveal again — the regression the user hit
{
  const t = makeTree(15)
  await reveal(t, '/w/src/a/b/target.ts')
  t.collapse('/w/src')
  // Collapsing must discard every descendant row, not just the top one.
  check('collapse discards the whole subtree', !t.mounted.has('/w/src/a/b/target.ts'))
  const ok = await reveal(t, '/w/src/a/b/target.ts')
  check('collapsed-after-reveal opens again', ok === true)
}

// 5. file directly in the root (no ancestors to expand)
{
  const t = makeTree(15)
  t.mounted.add('/w/README.md')
  const ok = await reveal(t, '/w/README.md')
  check('root-level file needs no expansion', ok === true)
}

// 6. a level that never loads must not hang, and must not claim success
{
  const t = makeTree(15)
  t.expand('/w/src'); t.expand('/w/src/a')
  await t.reg.waitFor('/w/src', 1000)
  // '/w/src/a' never marked -> simulate by revealing a path beneath a dir
  // whose listing never arrives.
  const reg = new DirLoadRegistry()
  const stuck = await reg.waitFor('/w/never', 50)
  check('unreachable level resolves false (no hang)', stuck === false)
}


// ── Single-click wiring on the tab bar ──
// The reveal must be reachable with a SINGLE click (it used to be a
// double-click), and clicking must still switch the tab.
{
  const src = readFileSync(new URL('../src/client/editor/TabBar.tsx', import.meta.url), 'utf8')
  check('tab bar no longer requires a double-click to reveal', !src.includes('onDoubleClick'))
  check('tab bar reveals the tab on click', /onClick=\{\(\) => \{[\s\S]*?onReveal\?\.\(tab\.path\)/.test(src))
  const clickBody = /onClick=\{\(\) => \{([\s\S]*?)\}\}/.exec(src)?.[1] ?? ''
  check('click still selects the tab (reveal does not replace it)', clickBody.includes('onSelect(tab.path)'), clickBody.trim())
  check('close button stops propagation so it cannot trigger a reveal', src.includes('e.stopPropagation(); onClose(tab.path)'))
}

// Clicking a tab must not steal a non-Explorer sidebar, but must still work
// when the Explorer IS the current view (the tree can be mid-mount).
{
  const src = readFileSync(new URL('../src/client/IdeView.tsx', import.meta.url), 'utf8')
  const from = src.indexOf('const revealInExplorer = useCallback')
  const body = from === -1 ? '' : src.slice(from, src.indexOf('}, [setSidebarView', from))
  check('reveal accepts an activateView option', body.includes('activateView = true'))
  check('an open tree reveals immediately', body.includes('explorerRef.current !== null'))
  check('tab clicks pass activateView=false', src.includes('onReveal={(path) => revealInExplorer(path, false)}'))
  check('tab click does not force the sidebar off another view',
    body.includes("if (!activateView && sidebarView !== 'explorer') return"))
  check('tab click still reveals while the Explorer is current',
    body.includes('setPendingReveal(path)') && body.includes("setSidebarView('explorer')"))
}

// SCM and search expose 'reveal in explorer' context menu entries that switch
// the sidebar to the Explorer themselves.
{
  const scm = readFileSync(new URL('../src/client/git/SourceControlPanel.tsx', import.meta.url), 'utf8')
  check('SCM file menu offers reveal-in-explorer',
    /id: 'reveal', label: t\('context\.revealInExplorer'\)/.test(scm))
  check('SCM reveal item is wired to onRevealFile',
    /id: 'reveal'[^}]*onClick: \(\) => \{ onRevealFile\?\.\(entry\.path\) \}/.test(scm))
  check('SCM reveal item is disabled without a handler',
    /id: 'reveal'[^}]*disabled: !onRevealFile/.test(scm))

  const search = readFileSync(new URL('../src/client/search/SearchPanel.tsx', import.meta.url), 'utf8')
  check('search results offer reveal-in-explorer',
    search.includes("id: 'reveal', label: t('context.revealInExplorer')"))
  check('search hit menu can open the hit', search.includes("id: 'open', label: t('search.openHit')"))
  check('search reveal resolves the hit to an absolute path',
    /id: 'reveal'[^}]*onRevealFile\(absolutize\(/.test(search))
  check('search menu is inert without a reveal handler', search.includes('if (onRevealFile === undefined) return'))

  // Both are fed the FORCING variant, so they switch the sidebar view.
  const ide = readFileSync(new URL('../src/client/IdeView.tsx', import.meta.url), 'utf8')
  check('SCM and search reveal force the Explorer view over',
    (ide.match(/onRevealFile=\{\(path\) => \{ revealInExplorer\(path\) \}\}/g) ?? []).length === 2)
  check('tab click keeps the non-forcing variant', ide.includes('revealInExplorer(path, false)'))
}
console.log(failed === 0 ? '\nall reveal e2e simulation checks passed' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)