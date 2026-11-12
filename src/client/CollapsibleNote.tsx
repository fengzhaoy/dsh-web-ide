/**
 * A collapsible informational card: the title row is always visible (with a
 * chevron), the body only after a click. Used by the side-bar views that need
 * to explain a limitation without spending vertical space on it every time.
 */
import { useState, type ReactNode } from 'react'
import { Icons } from './icons.js'

export function CollapsibleNote({ title, testId, className, children }: {
  title: string
  /** Test hook for the whole card; the toggle itself is `<testId>-toggle`. */
  testId?: string
  /** Extra class for the container (reuses each view's existing styling). */
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={'ide-note' + (className !== undefined ? ' ' + className : '')} data-expanded={open || undefined} data-testid={testId}>
      <button
        type="button"
        className="ide-note-toggle"
        aria-expanded={open}
        data-testid={testId !== undefined ? testId + '-toggle' : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ide-note-chevron" data-open={open || undefined}>{Icons.chevronRight}</span>
        <span className="ide-note-icon" aria-hidden="true">i</span>
        <span className="ide-note-title">{title}</span>
      </button>
      {open && <div className="ide-note-body">{children}</div>}
    </div>
  )
}
