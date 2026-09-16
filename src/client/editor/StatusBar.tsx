import { languageLabel } from '../language.js'
import type { OpenTab } from './TabBar.js'

interface StatusBarProps {
  activeTab: OpenTab | undefined
  cursor: { line: number; column: number }
  t: (key: string, params?: Record<string, string | number>) => string
  /** Save state of the active tab. */
  saveState: 'idle' | 'saving' | 'conflict'
  /** Save the active tab (status-bar affordance). */
  onSave: () => void
  /** Current AI model identifier, shown in the status bar (right side). */
  model?: string
}

export function StatusBar({ activeTab, cursor, t, saveState, onSave, model }: StatusBarProps) {
  return (
    <div className="ide-statusbar">
      <div className="ide-statusbar-left">
        {saveState === 'saving' ? (
          <span className="ide-statusbar-item">{t('status.saving')}</span>
        ) : saveState === 'conflict' ? (
          <span className="ide-statusbar-item ide-statusbar-conflict">{t('status.conflict')}</span>
        ) : activeTab?.dirty ? (
          <button type="button" className="ide-statusbar-item ide-statusbar-dirty" title={t('save.dirtyHint')} onClick={onSave}>
            {t('status.dirty')}
          </button>
        ) : (
          <span className="ide-statusbar-item">{t('status.saved')}</span>
        )}
      </div>
      <div className="ide-statusbar-right">
        {model && (
          <span className="ide-statusbar-item ide-statusbar-model">{t('status.model', { model })}</span>
        )}
        {activeTab && activeTab.status === 'ready' && (
          <>
            <span className="ide-statusbar-item">{t('status.lineColumn', { line: cursor.line, column: cursor.column })}</span>
            <span className="ide-statusbar-item">{t('status.lines', { lines: activeTab.lines })}</span>
            <span className="ide-statusbar-item">{t('status.language', { language: languageLabel(activeTab.language) })}</span>
          </>
        )}
        <span className="ide-statusbar-item">{t('status.utf8')}</span>
      </div>
    </div>
  )
}
