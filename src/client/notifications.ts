/**
 * Lightweight notification center (VS Code Bell parity): a window-parked
 * store of notifications with severity, an unseen counter (the status-bar
 * bell badge), and toast presentation state. Components subscribe with
 * useSyncExternalStore-compatible subscribe/getSnapshot.
 */
export type NotifySeverity = 'info' | 'warning' | 'error'

export interface IdeNotification {
  id: number
  severity: NotifySeverity
  message: string
  /** Epoch ms when raised. */
  at: number
  /** Toast still on screen (auto-dismisses after the timeout). */
  toast: boolean
}

const MAX_HISTORY = 50
const TOAST_MS = 5000

type Listener = () => void

class NotificationCenter {
  private listeners = new Set<Listener>()
  private items: IdeNotification[] = []
  private unseen = 0
  private nextId = 1
  /** Cached snapshot object: getSnapshot must return a stable reference
   *  between changes or useSyncExternalStore loops forever. */
  private snapshot: { items: readonly IdeNotification[]; unseen: number } = { items: [], unseen: 0 }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  getSnapshot = (): { items: readonly IdeNotification[]; unseen: number } => {
    return this.snapshot
  }

  notify(severity: NotifySeverity, message: string): void {
    const item: IdeNotification = { id: this.nextId++, severity, message, at: Date.now(), toast: true }
    this.items = [item, ...this.items].slice(0, MAX_HISTORY)
    this.unseen += 1
    this.emit()
    // Auto-dismiss the toast (history keeps the entry).
    setTimeout(() => { this.dismissToast(item.id) }, TOAST_MS)
  }

  info(message: string): void { this.notify('info', message) }
  warning(message: string): void { this.notify('warning', message) }
  error(message: string): void { this.notify('error', message) }

  dismissToast(id: number): void {
    let changed = false
    this.items = this.items.map((it) => {
      if (it.id === id && it.toast) { changed = true; return { ...it, toast: false } }
      return it
    })
    if (changed) this.emit()
  }

  /** Bell opened: clear the unseen counter. */
  clearUnseen(): void {
    if (this.unseen === 0) return
    this.unseen = 0
    this.emit()
  }

  clearHistory(): void {
    this.items = []
    this.unseen = 0
    this.emit()
  }

  private emit(): void {
    this.snapshot = { items: this.items, unseen: this.unseen }
    for (const fn of this.listeners) fn()
  }
}

interface NcWindow { __dshIdeNotifications?: NotificationCenter }
const win = window as unknown as NcWindow
export const notifications: NotificationCenter = win.__dshIdeNotifications ??= new NotificationCenter()
