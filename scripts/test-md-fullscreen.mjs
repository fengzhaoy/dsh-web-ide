/**
 * Regression: markdown full-screen preview must never cover a non-md tab,
 * while the parked preview layout survives switches to non-md tabs.
 *
 * Bug history:
 *  - after entering md full-screen preview, opening another file (e.g. .json)
 *    rendered a blank editor → fixed by gating every mode consumer on
 *    activeIsMd (pane render, data-md-split, previewFullscreen cover);
 *  - an early fix additionally normalized mdPreviewMode to 'off' on any
 *    non-md active tab, but that also destroyed the parked layout when the
 *    user switched md → non-md → md, dropping them back to source view
 *    instead of restoring full-screen/split (VS Code keeps the layout) →
 *    the normalization was removed; safety comes from the activeIsMd gates
 *    alone, so a non-md tab is never covered while the mode stays parked.
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

// 1. The pane render gate must suppress the pane for VS Code / image tabs
//    (they draw their own overlay over the same editor area).
check(
  'md pane gated by !activeIsVscode && !activeImageSrc',
  src.includes('mdPreviewOpen && !diffPath && activeIsMd && !activeIsVscode && !activeImageSrc && ('),
)

// 2. The pane is mounted only for a ready, loaded markdown tab — a non-md
//    (or still-loading) active tab never shows the preview pane.
check(
  'previewFullscreen requires activeIsMd',
  src.includes('previewFullscreen = mdPreviewOpen && !diffPath && activeIsMd && mdPreviewFull'),
)
check(
  'split narrowing requires activeIsMd',
  src.includes("data-md-split={mdPreviewOpen && !diffPath && activeIsMd && !previewFullscreen ? 'true' : undefined}"),
)

// 3. The Monaco container keeps its covered/hidden semantics only under
//    previewFullscreen (which itself requires activeIsMd), so a non-md tab
//    can never be left invisibly covered.
check(
  'data-md-covered only under previewFullscreen',
  src.includes("data-md-covered={previewFullscreen ? 'true' : undefined}"),
)

// 4. The parked mode must NOT be normalized away on non-md tabs: the
//    md → non-md → md round-trip restores full-screen/split preview. The
//    old normalization effect is gone entirely.
check(
  'no mdPreviewMode normalization effect on non-md tabs',
  !src.includes("setMdPreviewMode((mode) => (mode === 'off' ? mode : 'off'))"),
)

console.log(fail === 0 ? 'all md-fullscreen gating checks passed' : 'FAILURES: ' + fail)
process.exit(fail === 0 ? 0 : 1)
