/**
 * Left-panel collapse wiring: double-clicking an activity-bar icon hides the
 * panel; the VS Code icon must stay exempt.
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

// --- every view except vscode ---
for (const view of ['explorer', 'search', 'git', 'run', 'extensions']) {
  check('double-click toggles ' + view, ide.includes("onDoubleClick={() => toggleSidebarFor('" + view + "')}"))
  check('single click expands for ' + view, new RegExp("onClick=\\{\\(\\) => \\{[^}]*setSidebarCollapsed\\(false\\)").test(ide))
}
check('VS Code icon has no double-click handler',
  !/ide-activitybar-vscode[^>]*onDoubleClick/.test(ide))
check('a collapsed panel reopens on single click', ide.includes('setSidebarCollapsed(false)'))

// --- interaction semantics ---
check('double-click on the shown view hides it', /if \(sidebarView === view\) return true/.test(ide))
check('double-click on a hidden panel reveals it', /if \(collapsed\) \{/.test(ide))

console.log(failed === 0 ? '\nall sidebar collapse checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)