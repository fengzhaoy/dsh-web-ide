/**
 * Regression: markdown preview VS Code-parity behaviors.
 *
 * 1. Fenced code blocks are highlighted with monaco.editor.colorize using a
 *    language alias map (js→javascript, sh→shell, ...); unknown fences are
 *    validated against the monaco registry before colorizing and plain text
 *    fences stay unhighlighted — matching VS Code's preview behavior.
 * 2. Mermaid fences (```mermaid) render as SVG diagrams via the vendored
 *    official mermaid browser IIFE, embedded as a string constant by the
 *    tsdown embedMermaidIife plugin. Module-bundling mermaid was rejected:
 *    rolldown-beta emits __commonJS wrappers that UMD deps (d3-shape,
 *    sanitize-url) boot out of order inside the single-chunk CJS client
 *    bundle; the IIFE sidesteps CJS interop entirely and loads lazily
 *    (evaluated only when a document actually contains a diagram).
 * 3. Scroll sync is bi-directional and proportional:
 *    - editor → preview via onDidScrollChange (pre-existing);
 *    - preview → editor via onScrollRatio reported from the preview's own
 *      live DOM node. The listener MUST live inside <MarkdownPreview>: an
 *      earlier version attached it from IdeView to a captured element and
 *      silently kept a stale node after pane remounts (first-open scroll
 *      never reached the editor).
 *
 * Source-level checks (repo convention: string match over src/client, see
 * scripts/test-md-fullscreen.mjs).
 */
import { readFileSync } from 'node:fs'

const preview = readFileSync(new URL('../src/client/editor/MarkdownPreview.tsx', import.meta.url), 'utf8')
const ide = readFileSync(new URL('../src/client/IdeView.tsx', import.meta.url), 'utf8')
const diagram = readFileSync(new URL('../src/client/editor/mermaidDiagram.ts', import.meta.url), 'utf8')
const icons = readFileSync(new URL('../src/client/editor/mermaidIcons.ts', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../src/client/theme.ts', import.meta.url), 'utf8')

let pass = 0
let fail = 0
const check = (name, ok) => {
  if (ok) { pass++; console.log('PASS ' + name) } else { fail++; console.log('FAIL ' + name) }
}

// 1. Fenced-code highlighting via monaco colorize.
check('preview colorizes fenced code via monaco.editor.colorize', preview.includes('monaco.editor.colorize'))
// 1b. Mermaid diagrams (VS Code markdown-mermaid extension parity).
check('preview targets mermaid fences', preview.includes('pre[data-lang="mermaid"]'))
check('preview evaluates the embedded mermaid IIFE lazily', preview.includes('MERMAID_IIFE'))
check('preview aliases the IIFE global namespace before eval', preview.includes('__esbuild_esm_mermaid_nm = (globalThis.__esbuild_esm_mermaid_nm'))
check('mermaid render failure falls back to error styling', preview.includes('ide-md-mermaid-error'))
check('mermaid theme follows the ide theme (dark prop)', preview.includes("theme: dark ? 'dark' : 'default'"))
// 1c. Mermaid interactive chrome (VS Code mermaid-markdown-features parity):
// corner toolbar (zoom/reset/copy/download), pan/zoom gestures, resize
// handle, per-content state preservation.
check('preview wires the DiagramManager chrome', preview.includes('DiagramManager'))
check('preview attaches chrome after each render', preview.includes('diagramsRef.current.setup(contentId, box'))
check('preview prunes stale diagram state', preview.includes('retainStates'))
check('preview disposes chrome on unmount', preview.includes('disposeAll'))
check('diagram ids are content-hash stable across re-renders', /hash << 5/.test(preview))
check('chrome module implements the corner toolbar', diagram.includes('ide-md-mermaid-controls'))
check('toolbar hides until hover or focus (onHoverOrFocus default)', diagram.includes('ide-md-mermaid-controls-hover'))
// Regression: the corner toolbar never appeared because the reveal relied on a
// CSS :hover descendant chain that the live preview host does not satisfy.
// Visibility is now driven imperatively on pointerenter/focus as well.
check('toolbar reveal is driven imperatively (pointerenter/focusin)', diagram.includes('pointerenter') && diagram.includes('focusin'))
check('content layer fills the wrapper width (SVG no longer collapses)',
  theme.includes('.ide-md-mermaid-content{transform-origin:0 0;flex:1 1 auto;min-width:0;width:100%'))
check('diagram box is a block context, not a shrinking flex row',
  theme.includes('.ide-md-body .ide-md-mermaid{') && !/\.ide-md-body \.ide-md-mermaid\{[^}]*display:flex/.test(theme))
check('toolbar offers zoom out / zoom in', diagram.includes('labels.zoomOut') && diagram.includes('labels.zoomIn'))
check('toolbar offers pan-zoom reset', diagram.includes('labels.reset'))
check('toolbar offers copy source', diagram.includes('navigator.clipboard'))
check('toolbar offers SVG download', diagram.includes('downloadSvg') && diagram.includes('image/svg+xml'))
check('ctrl/cmd wheel zooms at pointer', diagram.includes('zoomAtPoint') && diagram.includes('ctrlKey'))
check('drag pans the diagram (clickDrag always default)', diagram.includes('pointermove') && diagram.includes("clickDrag === 'always'"))
check('keyboard +/-/0/arrows drive zoom and pan', diagram.includes("e.key === '+'") && diagram.includes("e.key === '0'") && diagram.includes('ArrowLeft'))
check('scale is clamped to the extension range 0.5..10', diagram.includes('minScale = 0.5') && diagram.includes('maxScale = 10'))
check('resize handle adjusts the wrapper height', diagram.includes('ide-md-mermaid-resize-handle') && theme.includes('ns-resize'))
check('pan/zoom state saved and restored per diagram id', diagram.includes('savedStates'))
check('icons module inlines official codicon toolbar icons', icons.includes('viewBox="0 0 16 16"') && icons.includes('ZOOM_IN') && icons.includes('SCREEN_NORMAL'))
check('ide view passes the dark flag', ide.includes('dark={settings.theme !== \'light-modern\'}'))
check('preview defines the language alias map', preview.includes('LANG_ALIASES'))
check('alias js → javascript', /js:\s*'javascript'/.test(preview))
check('alias sh → shell', /sh:\s*'shell'/.test(preview))
check('plain text fences opt out (empty language)', /text:\s*''/.test(preview))
check('language validated against monaco registry before colorize', /getLanguages\(\)/.test(preview))
check('targets fenced code blocks only (pre[data-lang] > code)', preview.includes('pre[data-lang] > code'))
check('colorize effect re-runs when html changes', /colorize[\s\S]{0,1200}\}, \[html\]/.test(preview))

// 2. Bi-directional scroll sync.
check('preview exposes onScrollRatio', preview.includes('onScrollRatio'))
check('preview listens to its own scroll (passive)', /addEventListener\('scroll', report, \{ passive: true \}\)/.test(preview))
check('listener binds to the live body element', /const el = bodyRef\.current/.test(preview))
check('ratio computed from the scroll range', /el\.scrollHeight - el\.clientHeight/.test(preview))
check('ide view keeps editor → preview sync', ide.includes('onDidScrollChange'))
check('ide view implements the ratio callback', ide.includes('onPreviewScrollRatio'))
check('ratio callback wired into MarkdownPreview', ide.includes('onScrollRatio={onPreviewScrollRatio}'))
check('ratio maps onto the editor scroll range', /setScrollTop\(ratio \* dstRange\)/.test(ide))
check('editor range uses content height minus layout height', /getContentHeight\(\) - editor\.getLayoutInfo\(\)\.height/.test(ide))

console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
