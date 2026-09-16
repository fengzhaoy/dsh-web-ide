import { useEffect, useRef, useState } from 'react'
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

let hideFn: (() => void) | null = null

/** Show a context menu at viewport-relative coordinates.
 *  Call from an onContextMenu handler: `showContextMenu(e.clientX, e.clientY, items)`. */
export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  // Position the menu, clamped to viewport so it never overflows off-screen.
  const menuWidth = 240
  const menuHeight = Math.min(items.length * 26 + 8, 400)
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 4)
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 4)
  pendingState = { x: clampedX, y: clampedY, items }
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

  if (!state) return null
  return (
    <div
      className="ide-context-menu"
      style={{ left: state.x, top: state.y }}
      ref={ref}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      {state.items.map((item) => (
        <div key={item.id}>
          {item.separator && <div className="ide-context-menu-separator" />}
          <div
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
        </div>
      ))}
    </div>
  )
}
