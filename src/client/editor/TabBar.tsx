import type { ReactNode } from 'react'
import { Icons } from '../icons.js'
import type { TextEncoding } from './encoding.js'

export interface OpenTab {
  /** Workspace-relative path, also the unique key. */
  path: string
  /** Basename shown on the tab. */
  name: string
  /** Monaco language id, for the status bar. */
  language: string
  /** Opaque freshness token from stat. */
  version: string
  /** Whether the file was truncated on open. */
  truncated: boolean
  /** Line count of the loaded text. */
  lines: number
  /** Whether loading is in progress or failed. */
  status: 'loading' | 'ready' | 'error'
  /** Error message when status is 'error'. */
  error: string | null
  /** Whether the editor holds unsaved edits for this tab. */
  dirty: boolean
  /** Render mode: Monaco text, an <img>/<iframe> preview for binary files, or
   *  a full VS Code Server embedded in an iframe (Scheme C). */
  kind: 'text' | 'image' | 'vscode'
  /** Data URI backing an image/PDF tab (kind === 'image'). */
  imageSrc?: string
  /** Detected text encoding, shown in the status bar. */
  encoding?: TextEncoding
  /** False when this editor cannot reproduce the file's encoding, so writing
   *  it back would corrupt the bytes (e.g. GBK). The tab is read-only. */
  encodingLossless?: boolean
  /** The file vanished from disk while this tab held unsaved edits. The buffer
   *  is kept so the work is not lost; saving it recreates the file. */
  deletedOnDisk?: boolean
}

interface TabBarProps {
  tabs: OpenTab[]
  active: string | undefined
  onSelect: (path: string) => void
  /** Single click a tab: select it AND reveal its file in the explorer, so a
   *  collapsed directory opens on the way to the file. */
  onReveal?: (path: string) => void
  onClose: (path: string) => void
  /** Editor-title actions rendered in the tab bar's right zone (VS Code
   *  parity: the markdown preview toggle lives there for .md tabs). */
  actions?: ReactNode
  t: (key: string, params?: Record<string, string | number>) => string
}

export function TabBar({ tabs, active, onSelect, onClose, onReveal, actions, t }: TabBarProps) {
  if (tabs.length === 0) return null
  return (
    <div className="ide-tabbar" role="tablist">
      <div className="ide-tabbar-tabs">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          className="ide-tab"
          role="tab"
          data-active={tab.path === active || undefined}
          onClick={() => {
            // Select first (instant tab switch), then reveal: revealing expands
            // collapsed ancestors and scrolls the row into view, so one click
            // opens the tree on the way to the file too.
            onSelect(tab.path)
            onReveal?.(tab.path)
          }}
          title={onReveal !== undefined ? t('tab.revealHint', { path: tab.path }) : tab.path}
        >
          <span className="ide-tab-name">{tab.name}</span>
          {tab.dirty && <span className="ide-tab-dirty" title={t('status.dirty')}>&#9679;</span>}
          <span
            className="ide-tab-close"
            role="button"
            tabIndex={0}
            aria-label="close"
            onClick={(e) => { e.stopPropagation(); onClose(tab.path) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClose(tab.path) } }}
          >
            {Icons.close}
          </span>
        </div>
      ))}
      </div>
      {actions !== undefined && <div className="ide-tabbar-actions">{actions}</div>}
    </div>
  )
}
