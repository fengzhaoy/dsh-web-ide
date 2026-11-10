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
  /** Optional codicon node rendered AFTER the label, pinned right. Use for
   *  the affordance of a row that acts on click (e.g. a copy icon) so the row
   *  reads as an action while the label keeps its full width. */
  actionIcon?: ReactNode
  /** Disabled items render greyed and do not fire. */
  disabled?: boolean
  /** Separator before this item. */
  separator?: boolean
  /** Muted trailing hint (e.g. "点击复制"): shows the action an otherwise
   *  informational row offers, so rows that copy a value read as clickable
   *  instead of looking like dead labels. */
  hint?: string
  /** Click handler. */
  onClick?: () => void
  /** Checkmark state (VS Code menuitemcheckbox): when defined the row shows a
   *  check glyph in the icon slot — Icons.check when true, blank otherwise —
   *  and clicking still fires onClick so the caller can re-render the menu
   *  with the flipped value (menus are rebuilt per open, so this is enough
   *  for live toggle semantics without a menu-manager state machine). */
  checked?: boolean
  /** Nested submenu (VS Code menuitem + menu): hovering/focusing the row
   *  opens the child menu anchored to the row's right edge (flips to the
   *  LEFT edge when it would overflow the viewport). A row with children
   *  never fires onClick — it only opens the submenu, like VS Code. */
  children?: ContextMenuItem[]
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
      {state.items.map((item) => renderMenuRow(item, () => setState(null)))}
    </div>
  )
}

/** Check glyph used by checkbox rows (kept here so the module has no icon
 *  dependency; the path is @vscode/codicons 'check', same as Icons.check). */
const CHECK_ICON = (
  <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M13.6572 3.13573C13.8583 2.9465 14.175 2.95614 14.3643 3.15722C14.5535 3.35831 14.5438 3.675 14.3428 3.86425L5.84277 11.8642C5.64597 12.0494 5.33756 12.0446 5.14648 11.8535L1.64648 8.35351C1.45121 8.15824 1.45121 7.84174 1.64648 7.64647C1.84174 7.45121 2.15825 7.45121 2.35351 7.64647L5.50976 10.8027L13.6572 3.13573Z" />
  </svg>
)

/** Chevron used by submenu rows (@vscode/codicons 'chevron-right'). */
const SUBMENU_ICON = (
  <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z" />
  </svg>
)

/** One menu row, plus its submenu when open. Recursive: a child row may
 *  itself carry children (VS Code nests Appearance → Activity Bar Position). */
function renderMenuRow(item: ContextMenuItem, closeAll: () => void, depth = 0): ReactNode {
  if (item.separator) return <div key={item.id} className="ide-context-menu-separator" />
  return (
    <MenuRow key={item.id} item={item} closeAll={closeAll} depth={depth} />
  )
}

/** A single row; owns its open-submenu state and the child MenuPanel. */
function MenuRow({ item, closeAll, depth }: { item: ContextMenuItem; closeAll: () => void; depth: number }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [submenuOpen, setSubmenuOpen] = useState(false)
  // Hover timers, same rhythm as VS Code's SubmenuMenuActionViewItem: opening
  // is DEFERRED 250ms (showScheduler) so a sweep across rows does not flash
  // every submenu, and closing is deferred 750ms (hideScheduler) so a diagonal
  // move into the child menu is not punished.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mouseOver = useRef(false)
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    if (showTimer.current !== null) clearTimeout(showTimer.current)
  }, [])

  const hasChildren = item.children !== undefined && item.children.length > 0

  const cancelTimers = (): void => {
    if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null }
    if (showTimer.current !== null) { clearTimeout(showTimer.current); showTimer.current = null }
  }

  const openSub = (): void => {
    if (!hasChildren || item.disabled) return
    mouseOver.current = true
    cancelTimers()
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      if (mouseOver.current) setSubmenuOpen(true)
    }, 250)
  }
  const openSubNow = (): void => {
    // Click path: open immediately, no 250ms wait (VS Code's onClick → createSubmenu).
    if (!hasChildren || item.disabled) return
    mouseOver.current = true
    cancelTimers()
    setSubmenuOpen(true)
  }
  const scheduleClose = (): void => {
    if (!hasChildren) return
    mouseOver.current = false
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setSubmenuOpen(false), 750)
  }

  // Checkbox rows keep the menu OPEN after the click so the caller can flip
  // the state and the same menu re-renders with the new checked glyph — the
  // VS Code behaviour for toggles like Auto Save or Word Wrap.
  const isCheckbox = item.checked !== undefined
  const handleClick = (): void => {
    if (item.disabled) return
    if (hasChildren) { openSubNow(); return }
    if (!isCheckbox) closeAll()
    item.onClick?.()
  }

  return (
    <div
      ref={rowRef}
      className="ide-context-menu-item"
      data-disabled={item.disabled || undefined}
      data-submenu={hasChildren || undefined}
      data-has-popup={hasChildren || undefined}
      role={isCheckbox ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={isCheckbox ? (item.checked === true ? 'true' : 'false') : undefined}
      aria-haspopup={hasChildren ? 'true' : undefined}
      onMouseEnter={openSub}
      onMouseLeave={scheduleClose}
      onClick={handleClick}
    >
      <span className="ide-context-menu-item-icon" data-checkslot={isCheckbox ? (item.checked === true ? 'on' : 'off') : undefined}>
        {isCheckbox ? (item.checked === true ? CHECK_ICON : null) : item.icon}
      </span>
      <span className="ide-context-menu-item-label" title={item.label}>{item.label}</span>
      {item.hint !== undefined && <span className="ide-context-menu-item-hint">{item.hint}</span>}
      {item.actionIcon !== undefined && <span className="ide-context-menu-item-action">{item.actionIcon}</span>}
      {hasChildren && <span className="ide-context-menu-item-submenu">{SUBMENU_ICON}</span>}
      {hasChildren && submenuOpen && rowRef.current !== null && (
        <MenuPanel
          items={item.children!}
          anchorEl={rowRef.current}
          depth={depth}
          onKeepOpen={() => { mouseOver.current = true; cancelTimers() }}
          onClose={() => setSubmenuOpen(false)}
        />
      )}
    </div>
  )
}

/** A floating child menu panel anchored to a row. Positions itself after the
 *  first paint from the anchor's real rect: to the row's RIGHT, flipping LEFT
 *  when that would overflow the viewport, and clamped vertically. */
function MenuPanel({ items, anchorEl, depth, onKeepOpen, onClose }: {
  items: ContextMenuItem[]
  anchorEl: HTMLElement
  depth: number
  onKeepOpen: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const rect = anchorEl.getBoundingClientRect()
    const width = ref.current?.offsetWidth ?? ESTIMATED_MENU_WIDTH
    const height = ref.current?.offsetHeight ?? estimateMenuHeight(items)
    // Horizontal, mirroring VS Code's calculateSubmenuMenuLayout with
    // expandDirection Right: lay out AFTER the row's right edge; flip to the
    // LEFT edge when the right side lacks room.
    const rightFits = rect.right + width + VIEWPORT_MARGIN <= window.innerWidth
    const left = rightFits
      ? rect.right
      : Math.max(VIEWPORT_MARGIN, rect.left - width)
    // Vertical, same two-step as VS Code:
    // 1) lay out BELOW the row's top (clamped so the menu fits the viewport);
    let top = Math.max(VIEWPORT_MARGIN, Math.min(rect.top, window.innerHeight - height - VIEWPORT_MARGIN))
    // 2) VS Code's shift: when the menu bottom lands exactly at the row top
    //    (i.e. step 1 clamped it up) but the whole row height + menu fits, push
    //    it down by the row height so the submenu's first row aligns with the
    //    NEXT row instead of covering the hovered row.
    if (top === rect.top && rect.top + rect.height + height <= window.innerHeight - VIEWPORT_MARGIN) {
      top += rect.height
    }
    setPos({ left, top })
  }, [anchorEl, items])

  return (
    <div
      ref={ref}
      className="ide-context-menu ide-context-submenu"
      data-depth={depth}
      style={pos === null ? { visibility: 'hidden', left: 0, top: 0 } : pos}
      onMouseEnter={onKeepOpen}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      {items.map((item) => renderMenuRow(item, onClose, depth + 1))}
    </div>
  )
}
