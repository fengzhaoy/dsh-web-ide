import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** One context-menu item: icon + label + optional disabled / separator. */
export interface ContextMenuItem {
  /** Stable id for this item. */
  id: string
  /** Display label. */
  label: string
  /** Optional codicon node rendered before the label. */
  icon?: ReactNode
  /** Disabled items render greyed and do not fire. */
  disabled?: boolean
  /** Separator before this item. */
  separator?: boolean
  /** Click handler. */
  onClick?: () => void
}

interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

/** Estimated rendered size of the menu (item height matches the CSS's 26px).
 *  Used for the PRE-mount position guess; the host re-measures the real DOM
 *  height after mount and repositions through the same helper, so an estimate
 *  that is slightly off never leaves the menu clipped. */
const ESTIMATED_ITEM_HEIGHT = 26
const ESTIMATED_MENU_WIDTH = 240
const ESTIMATED_MENU_PADDING = 8
const ESTIMATED_MAX_HEIGHT = 400
const VIEWPORT_MARGIN = 4

/** Pure position fit for a menu of the given size at a click point inside a
 *  viewport. When the menu would overflow the BOTTOM, it FLIPS to open upward
 *  (top = y - height); when it would overflow the RIGHT, it clamps left. The
 *  flipped top is then clamped to >= 0 so a menu taller than the viewport
 *  stays top-aligned rather than escaping off the top. Exported so the flip
 *  logic is testable off-DOM and reused by both the estimate and the measured
 *  pass. */
export function computeMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  // Horizontal: never let the right edge escape the viewport.
  const left = Math.max(VIEWPORT_MARGIN, Math.min(x, viewportWidth - menuWidth - VIEWPORT_MARGIN))
  // Vertical: if the menu fits below the click, open downward; otherwise flip
  // upward (top = y - height) so a bottom-of-screen right-click shows the menu
  // ABOVE the cursor instead of clipping it.
  let top: number
  if (y + menuHeight + VIEWPORT_MARGIN <= viewportHeight) {
    top = y
  } else {
    top = y - menuHeight
  }
  // A menu taller than the viewport flips to a negative top — clamp it to the
  // top edge so the first items stay visible (scroll inside if needed).
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewportHeight - menuHeight - VIEWPORT_MARGIN))
  return { left, top }
}

/** Pre-mount height estimate from the item count (capped; the measured pass
 *  corrects any error). */
function estimateMenuHeight(items: ContextMenuItem[]): number {
  return Math.min(items.length * ESTIMATED_ITEM_HEIGHT + ESTIMATED_MENU_PADDING, ESTIMATED_MAX_HEIGHT)
}

let hideFn: (() => void) | null = null

/** Show a context menu at viewport-relative coordinates.
 *  Call from an onContextMenu handler: `showContextMenu(e.clientX, e.clientY, items)`. */
export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  // Position the menu with a pre-mount estimate; the host re-measures the real
  // height after render and repositions, so a near-bottom click flips upward
  // and never gets clipped off-screen.
  const menuHeight = estimateMenuHeight(items)
  const { left, top } = computeMenuPosition(x, y, ESTIMATED_MENU_WIDTH, menuHeight, window.innerWidth, window.innerHeight)
  pendingState = { x: left, y: top, items }
  if (hideFn) hideFn()
  // Trigger the singleton mount to open with the new state.
  triggerOpen()
}

let pendingState: ContextMenuState | null = null
let triggerOpen: () => void = () => {}

export function setContextMenuTrigger(fn: () => void): void {
  triggerOpen = fn
}

/** Singleton context menu host. Mount once at the IDE root; showContextMenu
 *  drives it imperatively so nested components can open it without prop
 *  plumbing. Click-outside / Escape / scroll dismiss it. */
export function ContextMenuHost() {
  const [state, setState] = useState<ContextMenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setContextMenuTrigger(() => {
      if (pendingState) setState(pendingState)
    })
    hideFn = () => setState(null)
    return () => { hideFn = null; setContextMenuTrigger(() => {}) }
  }, [])

  // Dismiss on outside click, Escape, or scroll.
  useEffect(() => {
    if (!state) return
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setState(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setState(null) }
    const onScroll = () => setState(null)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [state])

  // After the menu paints, measure its REAL height and reposition through the
  // same helper: this corrects the pre-mount estimate and flips the menu
  // upward when a bottom-of-viewport click would otherwise clip it.
  useLayoutEffect(() => {
    if (!state || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    if (rect.height === 0) return
    const { left, top } = computeMenuPosition(state.x, state.y, rect.width, rect.height, window.innerWidth, window.innerHeight)
    // Only patch when the measured position differs (avoid a redundant render).
    if (Math.abs(left - state.x) > 0.5 || Math.abs(top - state.y) > 0.5) {
      setState((current) => (current === null ? current : { ...current, x: left, y: top }))
    }
  }, [state])

  if (!state) return null
  return (
    <div
      className="ide-context-menu"
      style={{ left: state.x, top: state.y }}
      ref={ref}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      {state.items.map((item) => (
        item.separator ? (
          <div key={item.id} className="ide-context-menu-separator" />
        ) : (
          <div
            key={item.id}
            className="ide-context-menu-item"
            data-disabled={item.disabled || undefined}
            onClick={() => {
              if (item.disabled) return
              setState(null)
              item.onClick?.()
            }}
          >
            {item.icon && <span className="ide-context-menu-item-icon">{item.icon}</span>}
            <span className="ide-context-menu-item-label">{item.label}</span>
          </div>
        )
      ))}
    </div>
  )
}
