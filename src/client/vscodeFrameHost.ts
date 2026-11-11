/**
 * Persistent host for the code-server iframe.
 *
 * WHY: the VS Code tab body is conditional React markup, so switching to the
 * chat tab REMOVED the <iframe> from the document — and a frame leaving the
 * document is destroyed by the browser, reloading the whole workbench on every
 * switch back (the user's blank pane).
 *
 * Two behaviours verified in a real browser:
 *  1. REPARENTING an iframe (appendChild elsewhere) RELOADS its document.
 *  2. display:none <-> visible does NOT reload it.
 *
 * So the frame is created once inside a body-level container that never leaves
 * the document, and laid out as a position:fixed OVERLAY whose rect is copied
 * from an anchor element rendered by React. Unmounting the tab hides the
 * overlay (parked) instead of destroying the frame.
 *
 * The rAF loop ALWAYS runs while a frame exists: on the first frames after a
 * remount the anchor is still 0x0 (React has mounted but layout has not
 * settled), so showing can only be decided inside the loop. Stopping the loop
 * on a zero-sized anchor was the bug that left the overlay hidden forever.
 */

export interface VscodeFrameRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

interface FrameState {
  container: HTMLDivElement
  frame: HTMLIFrameElement | null
  url: string | undefined
  /** Anchor currently driving the overlay (null = no IDE view mounted). */
  anchor: HTMLElement | null
  raf: number
}

declare global {
  interface Window {
    __dshIdeVscodeFrame?: FrameState
  }
}

const CONTAINER_CLASS = 'ide-vscode-overlay'
const FRAME_CLASS = 'ide-vscode-frame'

function state(): FrameState {
  const w = window as Window
  if (w.__dshIdeVscodeFrame === undefined) {
    const container = document.createElement('div')
    container.className = CONTAINER_CLASS
    container.setAttribute('data-hidden', 'true')
    // Must outlive every React subtree: it hangs off <body>.
    document.body.appendChild(container)
    w.__dshIdeVscodeFrame = { container, frame: null, url: undefined, anchor: null, raf: 0 }
  }
  return w.__dshIdeVscodeFrame
}

function ensureFrame(url: string): HTMLIFrameElement {
  const s = state()
  if (s.frame !== null && s.url === url) return s.frame
  // A different code-server instance (restarted on another port) invalidates
  // the old document; the only case that legitimately rebuilds the frame.
  if (s.frame !== null) s.frame.remove()
  const frame = document.createElement('iframe')
  frame.className = FRAME_CLASS
  frame.title = 'VS Code'
  frame.setAttribute('data-testid', 'ide-vscode-frame')
  frame.setAttribute('allow', 'clipboard-read; clipboard-write')
  frame.src = url
  s.container.appendChild(frame)
  s.frame = frame
  s.url = url
  return frame
}

function applyRect(rect: VscodeFrameRect): void {
  const c = state().container
  c.style.top = rect.top + 'px'
  c.style.left = rect.left + 'px'
  c.style.width = rect.width + 'px'
  c.style.height = rect.height + 'px'
}

/**
 * Start following `anchor`: the overlay is positioned over it and shown as soon
 * as it has a non-zero box. Idempotent — calling it again just re-points the
 * anchor (the loop is already running).
 */
export function showVscodeFrame(url: string, anchor: HTMLElement): void {
  const s = state()
  ensureFrame(url)
  s.anchor = anchor
  if (s.raf !== 0) return // loop already running; the new anchor is picked up
  let last = ''
  const tick = (): void => {
    const st = (window as Window).__dshIdeVscodeFrame
    if (st === undefined) return
    // Re-resolve the anchor from the document on every frame. React keeps the
    // component instance across a tab switch while the host REPLACES its DOM,
    // so a reference captured once goes stale (connected === false) and the
    // overlay stays parked forever. A querySelector is a few microseconds.
    const liveAnchor = document.querySelector('[data-testid="ide-vscode-anchor"]') as HTMLElement | null
    if (liveAnchor !== null && liveAnchor !== st.anchor) st.anchor = liveAnchor
    const a = st.anchor
    if (a === null) {
      // No anchor right now (the VS Code tab body is not mounted). Keep the
      // loop alive on a slow tick so a later mount is picked up without any
      // React lifecycle hook having to remember to call us.
      setTimeout(() => { st.raf = requestAnimationFrame(tick) }, 250)
      return
    }
    // DSH hides the inactive view tab with display:none and does NOT unmount it,
    // so no React cleanup fires on a tab switch. Detect the hidden state HERE and
    // park the overlay, otherwise it keeps its last rect and stays painted while
    // the user is on another tab.
    if (!isAnchorVisible(a)) {
      if (st.container.getAttribute('data-hidden') !== 'true') {
        st.container.setAttribute('data-hidden', 'true')
        st.container.style.width = '0px'
        st.container.style.height = '0px'
      }
      last = ''
      st.raf = requestAnimationFrame(tick)
      return
    }
    const r = a.getBoundingClientRect()
    // Never write an off-screen rect: a fixed box positioned below the fold
    // still counts toward the document scroll height.
    const vh = window.innerHeight || document.documentElement.clientHeight
    const onScreen = r.top < vh && r.bottom > 0 && r.width > 0 && r.height > 0
    if (onScreen) {
      const key = Math.round(r.top) + ',' + Math.round(r.left) + ',' + Math.round(r.width) + ',' + Math.round(r.height)
      if (key !== last) {
        last = key
        applyRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      }
      if (st.container.getAttribute('data-hidden') !== 'false') {
        st.container.setAttribute('data-hidden', 'false')
        st.container.style.display = 'block'
      }
    }
    st.raf = requestAnimationFrame(tick)
  }
  s.raf = requestAnimationFrame(tick)
}

/**
 * True when the anchor can actually be painted: connected, not inside a
 * display:none subtree, and with a real on-screen box. offsetParent alone is
 * not enough — a visibility:hidden or off-screen subtree still reports one,
 * which is how the overlay kept a stale top offset and stretched the page.
 */
function isAnchorVisible(a: HTMLElement): boolean {
  if (!a.isConnected || a.offsetParent === null) return false
  const r = a.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false
  const vh = window.innerHeight || document.documentElement.clientHeight
  const vw = window.innerWidth || document.documentElement.clientWidth
  // Reject boxes that sit entirely outside the viewport: that is exactly the
 // situation that produced the stray panel at the bottom of the page.
  if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false
  return true
}

/**
 * Hide the overlay WITHOUT detaching the frame (tab inactive or view unmounted).
 * display:none keeps the loaded document alive — verified in a browser.
 */
/**
 * Re-show a parked overlay with its existing anchor. Called when the VS Code
 * tab becomes active again: the frame document is still loaded, so this only
 * repositions and un-hides it.
 */
export function reshowVscodeFrame(): void {
  const s = (window as Window).__dshIdeVscodeFrame
  if (s === undefined || s.anchor === null || s.url === undefined) return
  showVscodeFrame(s.url, s.anchor)
}

export function parkVscodeFrame(): void {
  const s = (window as Window).__dshIdeVscodeFrame
  if (s === undefined) return
  // Hide ONLY. The anchor and the rAF loop stay alive: DSH hides the inactive
  // view with display:none instead of unmounting it, so the loop is the only
  // thing that can notice the pane coming back. Killing it here is what left
  // the workbench blank until a manual reload.
  s.container.setAttribute('data-hidden', 'true')
  s.container.style.display = 'none'
  s.container.style.width = '0px'
  s.container.style.height = '0px'
  if (s.anchor !== null && s.raf === 0) {
    // Loop had stopped earlier (destroy): restart it so the pane can come back.
    showVscodeFrame(s.url ?? '', s.anchor)
  }
}


/** Tear the frame down for real (Stop Server). */
export function destroyVscodeFrame(): void {
  const s = (window as Window).__dshIdeVscodeFrame
  if (s === undefined) return
  s.frame?.remove()
  s.frame = null
  s.url = undefined
  // A real teardown: stop watching, so a stopped server does not get revived
  // by the visibility loop.
  s.anchor = null
  if (s.raf !== 0) { cancelAnimationFrame(s.raf); s.raf = 0 }
  s.container.setAttribute('data-hidden', 'true')
  s.container.style.width = '0px'
  s.container.style.height = '0px'
}

/** True when a live frame already holds this URL (skip the loading pill). */
export function hasVscodeFrame(url: string): boolean {
  const s = (window as Window).__dshIdeVscodeFrame
  return s !== undefined && s.frame !== null && s.url === url
}
