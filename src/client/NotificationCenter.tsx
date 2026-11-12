/**
 * Notification bell + toasts (VS Code notification center parity): the bell
 * renders in the status bar; clicking it opens the history dropdown and
 * clears the unseen count. Toasts stack at the bottom-right above the status
 * bar and auto-dismiss.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from './icons.js'
import { notifications, type IdeNotification, type NotifySeverity } from './notifications.js'
import { showContextMenu } from './ContextMenu.js'

type T = (key: string, params?: Record<string, string | number>) => string

export function NotificationBell({ t }: { t: T }) {
  const state = useSyncExternalStore(notifications.subscribe, notifications.getSnapshot)
  const [open, setOpen] = useState(false)
  /** Severity filter driven by the funnel button (undefined = show all). */
  const [severityFilter, setSeverityFilter] = useState<NotifySeverity | undefined>(undefined)
  const dnd = notifications.doNotDisturb
  /** Where the panel sits, in viewport coordinates. The panel is portalled to
   *  <body>: keeping it inside the status bar made the bar re-flow when it
   *  opened (a 420px absolutely-positioned child still participates in the
   *  row's shrink calculation in some engines), which nudged the bell left. */
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      // The panel is portalled to <body>, so rootRef alone cannot cover it.
      // Also check the panel element itself: a click inside it is NOT outside.
      const target = e.target as Node
      const insideRoot = rootRef.current?.contains(target) === true
      const panel = document.querySelector('[data-testid=ide-notify-panel]')
      const insidePanel = panel !== null && panel.contains(target)
      if (!insideRoot && !insidePanel) setOpen(false)
    }
    // Esc closes the notification dropdown — same key the IDE's other popups
    // (command palette, context menus, dialogs) already honor.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // Measure the bell whenever the panel opens so the portal can sit above it.
  useLayoutEffect(() => {
    if (!open) { setAnchor(null); return }
    const el = rootRef.current?.querySelector('.ide-notify-bell')
    if (el === null || el === undefined) return
    const r = el.getBoundingClientRect()
    setAnchor({ right: Math.max(8, window.innerWidth - r.right), bottom: Math.max(8, window.innerHeight - r.top + 6) })
  }, [open])

  const toasts = state.items.filter((it) => it.toast)
  const hasUnseen = state.unseen > 0

  return (
    <>
      <div className="ide-notify-root" ref={rootRef} data-testid="ide-notify-bell">
        <button
          className="ide-statusbar-item ide-notify-bell"
          title={t('notify.title')}
          data-active={open || undefined}
          data-has-unseen={hasUnseen || undefined}
          onClick={() => {
            const next = !open
            setOpen(next)
            if (next) notifications.clearUnseen()
          }}
        >
          {hasUnseen ? Icons.bellDot : Icons.bell}
        </button>
        {open && anchor !== null && createPortal(
          <div className="ide-notify-panel" data-testid="ide-notify-panel"
            style={{ right: anchor.right, bottom: anchor.bottom }}>
            <div className="ide-notify-header">
              <span>{t('notify.title')}</span>
              <div className="ide-notify-actions" data-testid="ide-notify-actions">
                <button
                  className="ide-notify-action"
                  title={t('notify.markAllRead')}
                  data-testid="ide-notify-mark-read"
                  onClick={() => notifications.clearUnseen()}
                >{Icons.check}</button>
                <button
                  className={'ide-notify-action' + (dnd ? ' is-on' : '')}
                  title={dnd ? t('notify.dndOn') : t('notify.dndOff')}
                  data-testid="ide-notify-dnd"
                  data-active={dnd || undefined}
                  onClick={() => notifications.setDoNotDisturb(!dnd)}
                >{Icons.bell}</button>
                <button
                  className="ide-notify-action"
                  title={t('notify.filter')}
                  data-testid="ide-notify-filter"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    const levels: Array<[string, NotifySeverity | undefined]> = [
                      [t('notify.filterAll'), undefined],
                      [t('notify.filterErrors'), 'error'],
                      [t('notify.filterWarnings'), 'warning'],
                      [t('notify.filterInfo'), 'info'],
                    ]
                    showContextMenu(r.right - 160, r.bottom + 4, levels.map(([label, sev]) => ({
                      id: 'sev-' + String(sev),
                      label: (severityFilter === sev ? '\u2713 ' : '   ') + label,
                      onClick: () => setSeverityFilter(sev),
                    })))
                  }}
                >{Icons.filter}</button>
                <button
                  className="ide-notify-action"
                  title={t('notify.clear')}
                  data-testid="ide-notify-clear"
                  onClick={() => notifications.clearHistory()}
                >{Icons.trash}</button>
              </div>
            </div>
            <div className="ide-notify-list">
              {state.items.length === 0 && <div className="ide-notify-empty">{t('notify.empty')}</div>}
              {state.items.filter((it) => severityFilter === undefined || it.severity === severityFilter).map((it) => (
                <div key={it.id} className={'ide-notify-item ide-notify-' + it.severity}>
                  <span className="ide-notify-sev">{severityIcon(it.severity)}</span>
                  <div className="ide-notify-main">
                    <span className="ide-notify-msg">{it.message}</span>
                    <span className="ide-notify-source">{t('notify.source')} · {formatTime(it.at)}</span>
                  </div>
                  <button
                    className="ide-notify-dismiss"
                    title={t('notify.dismiss')}
                    onClick={(e) => { e.stopPropagation(); notifications.remove(it.id) }}
                  >{Icons.close}</button>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
      </div>
      {toasts.length > 0 && (
        <div className="ide-toasts" data-testid="ide-toasts">
          {toasts.map((it) => (
            <Toast key={it.id} item={it} />
          ))}
        </div>
      )}
    </>
  )
}

/** VS Code's notification severity glyphs: error/warning/error circle, info. */
function severityIcon(severity: IdeNotification['severity']): ReactNode {
  if (severity === 'error') return Icons.error
  if (severity === 'warning') return Icons.warning
  return Icons.eye
}

function Toast({ item }: { item: IdeNotification }) {
  return (
    <div className={'ide-toast ide-toast-' + item.severity} data-testid="ide-toast" onClick={() => notifications.dismissToast(item.id)}>
      <span className="ide-toast-sev">{item.severity === 'error' ? Icons.close : item.severity === 'warning' ? Icons.discard : Icons.eye}</span>
      <span className="ide-toast-msg">{item.message}</span>
      <span className="ide-toast-close">{Icons.close}</span>
    </div>
  )
}

function formatTime(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}
