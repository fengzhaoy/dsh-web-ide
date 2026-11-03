/**
 * Regression: markdown full-screen preview must never cover a non-md tab.
 *
 * Bug: after entering md full-screen preview, opening another file (e.g.
 * .json) rendered a blank editor. Two defects combined:
 *   1. the pane stayed mounted when the active tab was an image/PDF or the
 *      VS Code tab (each renders its own overlay over the same editor area);
 *   2. the parked per-workspace mdPreviewMode could stay 'split'/'full' on a
 *      non-md active tab, so the next .md file popped straight into full
 *      screen and any stale cover kept the newly opened file invisible.
 *
 * Source-level checks (repo convention: string match over src/client, see
 * scripts/test-sidebar-collapse.mjs).
 */
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/client/IdeView.tsx', import.meta.url), 'utf8')

let pass = 0
let fail = 0
const check = (name, ok) => {
  if (ok) { pass++; console.log('PASS ' + name) } else { fail++; console.log('FAIL ' + name) }
}

// 1. The pane render gate must suppress the pane for VS Code / image tabs.
check(
  'md pane gated by !activeIsVscode && !activeImageSrc',
  src.includes('mdPreviewOpen && !diffPath && activeIsMd && !activeIsVscode && !activeImageSrc && ('),
)

// 2. Mode normalization: a non-md active tab snaps mdPreviewMode back to off…
check(
  'normalization effect resets mdPreviewMode to off',
  src.includes("setMdPreviewMode((mode) => (mode === 'off' ? mode : 'off'))"),
)
// …but NOT while the tab is still loading (an md→md switch passes through a
// transient 'loading' tab that must not kill the parked full/split layout).
check(
  'normalization skips loading tabs',
  src.includes("if (activeTab.status === 'loading') return"),
)
// …and never for a ready markdown tab.
check(
  'normalization keeps ready markdown tabs',
  src.includes("if (activeTab.status === 'ready' && activeTab.kind === 'text' && isMarkdownPath(activeTab.path)) return"),
)

// 3. The Monaco container keeps its covered/hidden semantics only under
//    previewFullscreen (which itself requires activeIsMd), so a non-md tab
//    can never be left invisibly covered.
check(
  'data-md-covered only under previewFullscreen',
  src.includes("data-md-covered={previewFullscreen ? 'true' : undefined}"),
)

console.log(fail === 0 ? 'all md-fullscreen gating checks passed' : 'FAILURES: ' + fail)
process.exit(fail === 0 ? 0 : 1)
