import { Icons } from '../icons.js'

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
  /** Render mode: Monaco text, or an <img> preview for binary images. */
  kind: 'text' | 'image'
  /** Data URI backing an image tab (kind === 'image'). */
  imageSrc?: string
}

interface TabBarProps {
  tabs: OpenTab[]
  active: string | undefined
  onSelect: (path: string) => void
  onClose: (path: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

export function TabBar({ tabs, active, onSelect, onClose, t }: TabBarProps) {
  if (tabs.length === 0) return null
  return (
    <div className="ide-tabbar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          className="ide-tab"
          role="tab"
          data-active={tab.path === active || undefined}
          onClick={() => onSelect(tab.path)}
          title={tab.path}
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
  )
}
