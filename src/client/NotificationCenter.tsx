/**
 * Notification bell + toasts (VS Code notification center parity): the bell
 * renders in the status bar; clicking it opens the history dropdown and
 * clears the unseen count. Toasts stack at the bottom-right above the status
 * bar and auto-dismiss.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Icons } from './icons.js'
import { notifications, type IdeNotification } from './notifications.js'

type T = (key: string, params?: Record<string, string | number>) => string

export function NotificationBell({ t }: { t: T }) {
  const state = useSyncExternalStore(notifications.subscribe, notifications.getSnapshot)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => { document.removeEventListener('mousedown', onDown, true) }
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
          {Icons.bell}
        </button>
        {open && (
          <div className="ide-notify-panel" data-testid="ide-notify-panel">
            <div className="ide-notify-header">
              <span>{t('notify.title')}</span>
              <button className="ide-notify-clear" title={t('notify.clear')} onClick={() => notifications.clearHistory()}>{t('notify.clear')}</button>
            </div>
            <div className="ide-notify-list">
              {state.items.length === 0 && <div className="ide-notify-empty">{t('notify.empty')}</div>}
              {state.items.map((it) => (
                <div key={it.id} className={'ide-notify-item ide-notify-' + it.severity}>
                  <span className="ide-notify-sev">{it.severity === 'error' ? Icons.close : it.severity === 'warning' ? Icons.discard : Icons.eye}</span>
                  <span className="ide-notify-msg">{it.message}</span>
                  <span className="ide-notify-time">{formatTime(it.at)}</span>
                </div>
              ))}
            </div>
          </div>
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
