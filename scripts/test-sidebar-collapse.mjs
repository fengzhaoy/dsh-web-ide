/**
 * Left-panel collapse wiring: a single click on an activity-bar icon opens its
 * view or hides the panel when that view is already showing. Double-click is
 * gone on purpose — the second click of a double click is itself a single
 * click, so "hide on double click" would hide then immediately reopen.
 */
import { readFileSync } from 'node:fs'

let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }
const ide = readFileSync(new URL('../src/client/IdeView.tsx', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../src/client/theme.ts', import.meta.url), 'utf8')

// --- state + handler ---
check('collapse state exists', /const \[sidebarCollapsed, setSidebarCollapsed\] = useState/.test(ide))
check('handler is memoised', /const toggleSidebarFor = useCallback/.test(ide))
check('collapsed panel is hidden via data-collapsed', ide.includes("data-collapsed={sidebarCollapsed ? 'true' : undefined}"))
check('CSS actually hides it', theme.includes(".ide-sidebar[data-collapsed='true']{display:none}"))
check('does not rely on the hidden attribute', !/className="ide-sidebar"[^>]*hidden=/.test(ide))

// --- the activity-bar icons: single click toggles, no double-click ---
for (const view of ['explorer', 'git', 'run', 'extensions']) {
  check('single click toggles ' + view, ide.includes("onClick={() => toggleSidebarFor('" + view + "')}"))
  check('no double-click handler for ' + view, !new RegExp("onDoubleClick=\\{\\(\\) => toggleSidebarFor\\('" + view + "\\'\\)\\}").test(ide))
}
// The magnifier moved out of the activity bar into the explorer title bar; it
// now toggles the tree's name filter instead of opening the global search view.
const activitybar = ide.slice(ide.indexOf('className="ide-activitybar"'), ide.indexOf('ide-activitybar-spacer'))
check('search icon is gone from the activity bar', !activitybar.includes("'search'"))
check('filter entry lives in the explorer header', ide.includes('data-testid="ide-explorer-filter"'))
check('header magnifier toggles the name filter instead of the search view',
  ide.includes('onClick={() => explorerRef.current?.toggleFilter()}'))
check('header magnifier no longer switches to the search view',
  !ide.includes("onClick={() => toggleSidebarFor('search')}"))
check('no activity-bar icon keeps a double-click toggle',
  !/ide-activitybar-icon[^>]*onDoubleClick/.test(ide))
check('a collapsed panel reopens on single click', /if \(collapsed\) \{\s*setSidebarView\(view\)\s*return false/.test(ide))
check('filter header action sits before new file', ide.indexOf('ide-explorer-filter') < ide.indexOf('ide-explorer-new-file'))

// --- interaction semantics ---
check('clicking the shown view hides the panel', /if \(sidebarView === view\) return true/.test(ide))
check('clicking another view switches without collapsing', /setSidebarView\(view\)\s*return false/.test(ide))

// --- the other two icons stay untouched ---
check('terminal icon still toggles the bottom panel', /onClick=\{\(\) => setTerminalOpen\(\(v\) => !v\)\}/.test(ide))
check('gear icon still opens the manage menu', /onClick=\{openManageMenu\}/.test(ide))

console.log(failed === 0 ? '\nall sidebar collapse checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
