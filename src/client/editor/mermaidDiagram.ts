/**
 * Interactive mermaid diagram chrome: pan/zoom, hover toolbar, resize handle.
 *
 * Port of the VS Code built-in mermaid-markdown-features extension's
 * preview-src/shared/diagramManager.ts (Microsoft, MIT) onto this plugin's
 * constraint set: no codicon webfont (the IDE ships inline SVG icons from
 * icons.tsx), no VS Code webview messaging (commands become direct DOM
 * actions), and the toolbar is plain DOM built inside the preview host so it
 * survives dangerouslySetInnerHTML updates driven by the editor.
 *
 * What it does, mirroring VS Code behaviour:
 *   - wraps every rendered mermaid container in .ide-md-mermaid-wrapper with
 *     a .ide-md-mermaid-content transform layer;
 *   - zoom (wheel + ctrl/⌘ wheel at any time, pinch zoom), pan (click-drag,
 *     configurable mode), keyboard +/-/0/arrows on a focused diagram;
 *   - a hover-revealed toolbar pinned to the wrapper's top-right corner:
 *     zoom-out / zoom-in / reset (screen-normal) / copy source / download SVG;
 *   - an optional bottom resize handle that clamps the wrapper height;
 *   - pan/zoom state preserved per content-hash id across preview re-renders
 *     (DiagramManager.savedStates), exactly like the VS Code extension.
 */
import type { IconSet } from './mermaidIcons.js'

export interface PanZoomState {
  readonly scale: number
  readonly translate: { readonly x: number; readonly y: number }
  readonly hasInteracted: boolean
  readonly customHeight?: number
}

/** How the wrapper reacts to drag gestures (VS Code mermaid.clickDrag). */
export type ClickDragMode = 'always' | 'alt' | 'never'
/** When the corner toolbar is visible (VS Code mermaid.showControls). */
export type ShowControlsMode = 'never' | 'onHoverOrFocus' | 'always'

export interface DiagramChromeConfig {
  readonly clickDrag: ClickDragMode
  readonly showControls: ShowControlsMode
  readonly resizable: boolean
  /** CSS max-height for wrappers (VS Code mermaid.maxHeight). */
  readonly maxHeight: string
}

export const DEFAULT_DIAGRAM_CONFIG: DiagramChromeConfig = {
  clickDrag: 'always',
  showControls: 'onHoverOrFocus',
  resizable: true,
  maxHeight: '600px',
}

const minScale = 0.5
const maxScale = 10
const zoomFactor = 0.002

export interface DiagramChrome {
  dispose(): void
}

/** Toolbar button descriptor supplied by the preview (icons + labels + actions). */
export interface ToolbarActions {
  zoomIn(): void
  zoomOut(): void
  reset(): void
  copySource(): void
  downloadSvg(): void
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Parse a CSS length value; '' when invalid (VS Code sanitizeCssLength). */
function sanitizeCssLength(value: string): string {
  if (value === '') return ''
  if (/^-?\d+(\.\d+)?(px|em|rem|vh|vw|%)$/.test(value.trim())) return value.trim()
  return ''
}

/**
 * One diagram: wrapper + transform layer + toolbar + resize handle + gestures.
 * Mirrors the extension's DiagramElement class.
 */
class DiagramElement {
  private scale = 1
  private translate = { x: 0, y: 0 }
  private hasInteracted = false
  private customHeight: number | undefined
  private readonly disposers: Array<() => void> = []
  private readonly toolbar: HTMLElement

  constructor(
    private readonly container: HTMLElement,
    private readonly content: HTMLElement,
    private readonly config: DiagramChromeConfig,
    private readonly icons: IconSet,
    private readonly labels: Record<'zoomIn' | 'zoomOut' | 'reset' | 'copySource' | 'downloadSvg' | 'panHint', string>,
    private readonly source: string,
    private readonly svg: SVGSVGElement | null,
    saved: PanZoomState | undefined,
    private readonly onStateSaved: (state: PanZoomState) => void,
  ) {
    if (saved !== undefined) {
      this.scale = saved.scale
      this.translate = { ...saved.translate }
      this.hasInteracted = saved.hasInteracted
      this.customHeight = saved.customHeight
    }

    // Wrapper chrome: border box, focus target, cursor.
    container.tabIndex = 0
    container.style.maxHeight = sanitizeCssLength(config.maxHeight)

    this.toolbar = this.buildToolbar()
    container.appendChild(this.toolbar)
    this.bindToolbarVisibility()

    this.bindGestures()
    if (config.resizable) this.bindResizeHandle()

    if (this.customHeight !== undefined) this.applyHeight()
    this.applyTransform()
  }

  // ---- toolbar -----------------------------------------------------------

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'ide-md-mermaid-controls'
    if (this.config.showControls === 'onHoverOrFocus') bar.classList.add('ide-md-mermaid-controls-hover')

    const mk = (icon: string, title: string, fn: () => void): HTMLElement => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'ide-md-mermaid-btn'
      btn.title = title
      btn.setAttribute('aria-label', title)
      btn.innerHTML = icon
      btn.addEventListener('click', (e) => { e.stopPropagation(); fn() })
      return btn
    }

    const actions: ToolbarActions = {
      zoomIn: () => this.zoomIn(),
      zoomOut: () => this.zoomOut(),
      reset: () => this.reset(),
      copySource: () => { void navigator.clipboard?.writeText(this.source).catch(() => {}) },
      downloadSvg: () => this.downloadSvg(),
    }

    if (this.config.clickDrag !== 'never') bar.title = this.labels.panHint
    bar.appendChild(mk(this.icons.zoomOut, this.labels.zoomOut, actions.zoomOut))
    bar.appendChild(mk(this.icons.zoomIn, this.labels.zoomIn, actions.zoomIn))
    bar.appendChild(mk(this.icons.reset, this.labels.reset, actions.reset))
    bar.appendChild(mk(this.icons.copy, this.labels.copySource, actions.copySource))
    bar.appendChild(mk(this.icons.download, this.labels.downloadSvg, actions.downloadSvg))
    return bar
  }

  /**
   * Reveal the toolbar on pointer/focus without relying on a CSS :hover
   * descendant chain. The preview host re-renders its HTML on every keystroke,
   * and a purely CSS-driven reveal proved unreliable there (the class alone
   * left opacity at 0 whenever the pointer sat over the SVG rather than the
   * wrapper edge). Driving the inline style directly keeps the extension's
   * showControls: onHoverOrFocus behaviour and is immune to selector churn.
   */
  private bindToolbarVisibility(): void {
    if (this.config.showControls !== 'onHoverOrFocus') return
    const el = this.container
    const show = () => { this.toolbar.style.opacity = '1'; this.toolbar.style.pointerEvents = 'auto' }
    const hide = () => {
      if (el.contains(document.activeElement)) return
      this.toolbar.style.opacity = ''
      this.toolbar.style.pointerEvents = ''
    }
    el.addEventListener('pointerenter', show)
    el.addEventListener('pointerleave', hide)
    el.addEventListener('focusin', show)
    el.addEventListener('focusout', hide)
    this.disposers.push(() => {
      el.removeEventListener('pointerenter', show)
      el.removeEventListener('pointerleave', hide)
      el.removeEventListener('focusin', show)
      el.removeEventListener('focusout', hide)
    })
  }

  private downloadSvg(): void {
    if (this.svg === null) return
    const clone = this.svg.cloneNode(true) as SVGSVGElement
    // Serialise the *untransformed* diagram: strip the preview pan/zoom class
    // influence by baking currentSize into width/height attributes.
    const vb = this.svg.getAttribute('viewBox')
    if (vb !== null) clone.setAttribute('viewBox', vb)
    const xml = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([xml], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'diagram.svg'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // ---- gestures ----------------------------------------------------------

  private bindGestures(): void {
    const el = this.container

    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      this.zoomAtPoint(Math.exp(-e.deltaY * zoomFactor), e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    this.disposers.push(() => el.removeEventListener('wheel', wheel))

    let drag: { x: number; y: number; tx: number; ty: number } | null = null
    const wantsDrag = (e: PointerEvent) =>
      this.config.clickDrag === 'always' || (this.config.clickDrag === 'alt' && e.altKey)
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !wantsDrag(e)) return
      drag = { x: e.clientX, y: e.clientY, tx: this.translate.x, ty: this.translate.y }
      el.classList.add('ide-md-mermaid-dragging')
      try { el.setPointerCapture(e.pointerId) } catch { /* detached */ }
      e.preventDefault()
    }
    const move = (e: PointerEvent) => {
      if (drag === null) return
      this.translate = { x: drag.tx + (e.clientX - drag.x), y: drag.ty + (e.clientY - drag.y) }
      this.hasInteracted = true
      this.applyTransform()
    }
    const up = () => {
      if (drag === null) return
      drag = null
      el.classList.remove('ide-md-mermaid-dragging')
      this.save()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    this.disposers.push(() => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    })

    const keys = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 100 : 50
      if (e.key === '+' || e.key === '=') { this.zoomIn(); e.preventDefault() }
      else if (e.key === '-' || e.key === '_') { this.zoomOut(); e.preventDefault() }
      else if (e.key === '0') { this.reset(); e.preventDefault() }
      else if (e.key === 'ArrowLeft') { this.translate = { ...this.translate, x: this.translate.x + step }; this.hasInteracted = true; this.applyTransform(); e.preventDefault() }
      else if (e.key === 'ArrowRight') { this.translate = { ...this.translate, x: this.translate.x - step }; this.hasInteracted = true; this.applyTransform(); e.preventDefault() }
      else if (e.key === 'ArrowUp') { this.translate = { ...this.translate, y: this.translate.y + step }; this.hasInteracted = true; this.applyTransform(); e.preventDefault() }
      else if (e.key === 'ArrowDown') { this.translate = { ...this.translate, y: this.translate.y - step }; this.hasInteracted = true; this.applyTransform(); e.preventDefault() }
      else if (e.key === 'Escape') { this.reset(); e.preventDefault() }
    }
    el.addEventListener('keydown', keys)
    this.disposers.push(() => el.removeEventListener('keydown', keys))
  }

  private bindResizeHandle(): void {
    const handle = document.createElement('div')
    handle.className = 'ide-md-mermaid-resize-handle'
    handle.title = ''
    this.container.appendChild(handle)
    let startY = 0
    let startH = 0
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      startY = e.clientY
      startH = this.container.getBoundingClientRect().height
      try { handle.setPointerCapture(e.pointerId) } catch { /* detached */ }
      e.preventDefault()
      e.stopPropagation()
    }
    const move = (e: PointerEvent) => {
      if (startH === 0) return
      this.customHeight = clamp(startH + (e.clientY - startY), 80, 4000)
      this.applyHeight()
    }
    const up = () => {
      if (startH === 0) return
      startH = 0
      this.save()
    }
    handle.addEventListener('pointerdown', down)
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
    this.disposers.push(() => {
      handle.removeEventListener('pointerdown', down)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      handle.remove()
    })
  }

  // ---- transform ---------------------------------------------------------

  private applyTransform(): void {
    this.content.style.transform = 'translate(' + this.translate.x + 'px,' + this.translate.y + 'px) scale(' + this.scale + ')'
  }

  private applyHeight(): void {
    if (this.customHeight === undefined) return
    this.container.style.height = this.customHeight + 'px'
  }

  private zoomAtPoint(factor: number, x: number, y: number): void {
    const newScale = clamp(this.scale * factor, minScale, maxScale)
    const sf = newScale / this.scale
    this.translate = {
      x: x - (x - this.translate.x) * sf,
      y: y - (y - this.translate.y) * sf,
    }
    this.scale = newScale
    this.hasInteracted = true
    this.applyTransform()
  }

  zoomIn(): void {
    const rect = this.container.getBoundingClientRect()
    this.zoomAtPoint(1.25, rect.width / 2, rect.height / 2)
    this.save()
  }

  zoomOut(): void {
    const rect = this.container.getBoundingClientRect()
    this.zoomAtPoint(0.8, rect.width / 2, rect.height / 2)
    this.save()
  }

  reset(): void {
    this.scale = 1
    this.translate = { x: 0, y: 0 }
    this.hasInteracted = false
    this.customHeight = undefined
    this.container.style.height = ''
    this.applyTransform()
    this.save()
  }

  private save(): void {
    this.onStateSaved({
      scale: this.scale,
      translate: { ...this.translate },
      hasInteracted: this.hasInteracted,
      customHeight: this.customHeight,
    })
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.disposers.length = 0
    this.toolbar.remove()
    this.container.classList.remove('ide-md-mermaid-dragging')
    this.container.style.maxHeight = ''
    this.container.style.height = ''
    this.container.removeAttribute('tabindex')
  }
}

/**
 * Manages chrome for every diagram in a preview host, preserving pan/zoom
 * state per content id across re-renders (extension DiagramManager).
 */
export class DiagramManager {
  private readonly instances = new Map<string, DiagramElement>()
  private readonly savedStates = new Map<string, PanZoomState>()

  constructor(private config: DiagramChromeConfig = DEFAULT_DIAGRAM_CONFIG) {}

  updateConfig(config: DiagramChromeConfig): void {
    this.config = config
  }

  /**
   * Wrap the rendered container (already .ide-md-mermaid with an SVG child)
   * in interactive chrome. The caller-provided container element must be
   * attached to the DOM; the manager inserts the transform layer around its
   * current children.
   */
  setup(
    id: string,
    container: HTMLElement,
    deps: {
      icons: IconSet
      labels: Record<'zoomIn' | 'zoomOut' | 'reset' | 'copySource' | 'downloadSvg' | 'panHint', string>
      source: string
    },
  ): DiagramChrome {
    this.disposeInstance(id)

    const content = document.createElement('div')
    content.className = 'ide-md-mermaid-content'
    while (container.firstChild !== null) content.appendChild(container.firstChild)
    container.appendChild(content)
    container.classList.add('ide-md-mermaid-active')

    const instance = new DiagramElement(
      container, content, this.config, deps.icons, deps.labels, deps.source,
      container.querySelector('svg'),
      this.savedStates.get(id),
      (state) => { this.savedStates.set(id, state) },
    )
    this.instances.set(id, instance)
    return instance
  }

  /** Drop saved states for diagrams that no longer exist (extension retainStates). */
  retainStates(activeIds: Set<string>): void {
    for (const id of this.savedStates.keys()) {
      if (!activeIds.has(id)) this.savedStates.delete(id)
    }
  }

  private disposeInstance(id: string): void {
    const existing = this.instances.get(id)
    if (existing !== undefined) {
      existing.dispose()
      this.instances.delete(id)
    }
  }

  disposeAll(): void {
    for (const id of [...this.instances.keys()]) this.disposeInstance(id)
  }
}
