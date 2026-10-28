/**
 * Status bar (VS Code parity): left = remote indicator, branch + sync
 * (ahead/behind), problems, workspace, terminal toggle, save state; right =
 * model, cursor, lines, indentation + EOL pickers, language picker, encoding,
 * layout buttons, notification bell. All pickers reuse the ContextMenu.
 */
import { languageLabel } from '../language.js'
import { Icons } from '../icons.js'
import { showContextMenu } from '../ContextMenu.js'
import { NotificationBell } from '../NotificationCenter.js'
import type { OpenTab } from './TabBar.js'
import { encodingLabel, type TextEncoding } from './encoding.js'

interface StatusBarProps {
  activeTab: OpenTab | undefined
  /** Detected encoding of the active tab (status-bar label). */
  encoding?: TextEncoding
  cursor: { line: number; column: number }
  t: (key: string, params?: Record<string, string | number>) => string
  /** Save state of the active tab. */
  saveState: 'idle' | 'saving' | 'conflict'
  /** Save the active tab (status-bar affordance). */
  onSave: () => void
  /** Current AI model identifier, shown in the status bar (right side). */
  model?: string
  /** Current git branch name (HEAD short name), shown on the left side. */
  branch?: string
  /** Detached HEAD: short SHA shown in place of the branch name (VS Code
   *  parity — otherwise the whole branch + sync block disappears). */
  detachedSha?: string
  /** Commits ahead of upstream (status-bar sync indicator). */
  ahead?: number
  /** Commits behind upstream (status-bar sync indicator). */
  behind?: number
  /** Click the branch sync indicator: pull + push (gitSync 'sync'). */
  onSync?: () => void
  /** Problem counts from Monaco markers (status-bar problems indicator). */
  problems?: { errors: number; warnings: number }
  /** Click the problems indicator: open the Problems bottom-panel tab. */
  onOpenProblems?: () => void
  /** Workspace (session cwd basename) for the remote indicator. */
  workspaceName?: string
  /** Session id shown in the remote info card. */
  sessionId?: string
  /** Session cwd shown in the remote info card. */
  cwd?: string
  /** Toggle the bottom terminal panel open/closed. */
  onToggleTerminal?: () => void
  /** Whether the terminal panel is currently open (drives the button active state). */
  terminalOpen?: boolean
  /** Current model language id of the active editor tab. */
  language?: string
  /** Switch the active model's language (setModelLanguage). */
  onSetLanguage?: (lang: string) => void
  /** Current indentation of the active model. */
  indent?: { tabSize: number; insertSpaces: boolean }
  /** Change the active model's indentation. */
  onSetIndent?: (tabSize: number, insertSpaces: boolean) => void
  /** Current EOL of the active model ('\n' | '\r\n'). */
  eol?: '\n' | '\r\n'
  onSetEol?: (eol: '\n' | '\r\n') => void
  /** Toggle the left sidebar (layout button). */
  onToggleSidebar?: () => void
  /** Toggle the right sidebar (layout button). */
  onToggleRightSidebar?: () => void
  rightSidebarOpen?: boolean
}

const LANGUAGE_OPTIONS = ['typescript', 'javascript', 'json', 'css', 'scss', 'less', 'html', 'markdown', 'xml', 'yaml', 'python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin', 'shell', 'sql', 'ini', 'dockerfile', 'makefile', 'plaintext']

export function StatusBar(props: StatusBarProps) {
  const { activeTab, encoding, cursor, t, saveState, onSave, model, branch, detachedSha, ahead, behind, onSync, problems, onOpenProblems, workspaceName, sessionId, cwd, onToggleTerminal, terminalOpen, language, onSetLanguage, indent, onSetIndent, eol, onSetEol, onToggleSidebar, onToggleRightSidebar, rightSidebarOpen } = props

  const menuAt = (el: HTMLElement | null, items: Parameters<typeof showContextMenu>[2]) => {
    const rect = el?.getBoundingClientRect()
    showContextMenu(rect ? rect.left : 100, rect ? rect.top - 4 : 100, items)
  }

  const openIndentMenu = (e: React.MouseEvent) => {
    const items = [
      { id: 'sp2', label: t('status.spaces', { count: 2 }), onClick: () => onSetIndent?.(2, true) },
      { id: 'sp4', label: t('status.spaces', { count: 4 }), onClick: () => onSetIndent?.(4, true) },
      { id: 'sp8', label: t('status.spaces', { count: 8 }), onClick: () => onSetIndent?.(8, true) },
      { id: 'tab4', label: t('status.tabs', { count: 4 }), onClick: () => onSetIndent?.(4, false) },
      { id: 'tab8', label: t('status.tabs', { count: 8 }), onClick: () => onSetIndent?.(8, false) },
    ]
    showContextMenu(e.clientX, e.clientY - 4, items)
  }

  const openEolMenu = (e: React.MouseEvent) => {
    showContextMenu(e.clientX, e.clientY - 4, [
      { id: 'lf', label: 'LF', onClick: () => onSetEol?.('\n') },
      { id: 'crlf', label: 'CRLF', onClick: () => onSetEol?.('\r\n') },
    ])
  }

  const openLanguageMenu = (e: React.MouseEvent) => {
    showContextMenu(e.clientX, e.clientY - 4, LANGUAGE_OPTIONS.map((lang) => ({
      id: lang,
      label: languageLabel(lang),
      onClick: () => onSetLanguage?.(lang),
    })))
  }

  const openRemoteMenu = (e: React.MouseEvent) => {
    showContextMenu(e.clientX, e.clientY - 4, [
      { id: 'ws', label: workspaceName ?? '—', disabled: true },
      { id: 'cwd', label: cwd ?? '—', disabled: true },
      { id: 'sid', label: (sessionId ?? '').slice(0, 18), disabled: true },
    ])
  }

  const openLayoutMenu = (e: React.MouseEvent) => {
    showContextMenu(e.clientX, e.clientY - 4, [
      { id: 'sidebar', label: t('command.toggleSidebar'), onClick: () => onToggleSidebar?.() },
      { id: 'right', label: t('command.toggleRightSidebar'), onClick: () => onToggleRightSidebar?.() },
      { id: 'panel', label: t('command.toggleTerminal'), onClick: () => onToggleTerminal?.() },
    ])
  }

  return (
    <div className="ide-statusbar" data-testid="ide-statusbar">
      <div className="ide-statusbar-left">
        {/* Remote/workspace indicator (VS Code remote indicator position). */}
        <button
          type="button"
          className="ide-statusbar-item ide-statusbar-remote"
          title={t('status.remoteInfo')}
          data-testid="ide-statusbar-remote"
          onClick={openRemoteMenu}
        >
          <span className="ide-statusbar-remote-icon">{Icons.remote}</span>
          {workspaceName ?? t('status.workspace')}
        </button>
        {(branch !== undefined || detachedSha !== undefined) && (
          <span className="ide-statusbar-item ide-statusbar-branch" data-testid="ide-statusbar-branch" title={detachedSha !== undefined ? t('status.detachedSha', { sha: detachedSha }) : branch}>
            <span className="ide-statusbar-branch-icon">{Icons.branch}</span>
            {branch ?? detachedSha}
            {(ahead !== undefined && ahead > 0) && <span className="ide-statusbar-sync-count" title={t('status.ahead', { count: ahead })}>↑{ahead}</span>}
            {(behind !== undefined && behind > 0) && <span className="ide-statusbar-sync-count" title={t('status.behind', { count: behind })}>↓{behind}</span>}
            {onSync && ((ahead ?? 0) > 0 || (behind ?? 0) > 0) && (
              <button
                type="button"
                className="ide-statusbar-sync"
                title={t('status.sync')}
                data-testid="ide-statusbar-sync"
                onClick={onSync}
              >{Icons.sync}</button>
            )}
          </span>
        )}
        {problems && onOpenProblems && (
          <button
            type="button"
            className="ide-statusbar-item ide-statusbar-problems"
            title={t('status.problemsCounts', { errors: problems.errors, warnings: problems.warnings })}
            data-testid="ide-statusbar-problems"
            onClick={onOpenProblems}
          >
            <span className="ide-statusbar-prob-icon ide-statusbar-prob-error">{Icons.close}</span>{problems.errors}
            <span className="ide-statusbar-prob-icon ide-statusbar-prob-warn">{Icons.warning}</span>{problems.warnings}
          </button>
        )}
        {onToggleTerminal && (
          <button
            type="button"
            className="ide-statusbar-item ide-statusbar-terminal"
            data-active={terminalOpen || undefined}
            title={t('panel.toggleBottom')}
            aria-label={t('panel.toggleBottom')}
            onClick={onToggleTerminal}
          >{Icons.terminal}</button>
        )}
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
            {indent && onSetIndent && (
              <button type="button" className="ide-statusbar-item" title={t('status.selectIndentation')} data-testid="ide-statusbar-indent" onClick={openIndentMenu}>
                {indent.insertSpaces ? t('status.spaces', { count: indent.tabSize }) : t('status.tabs', { count: indent.tabSize })}
              </button>
            )}
            {eol && onSetEol && (
              <button type="button" className="ide-statusbar-item" title={t('status.selectEol')} data-testid="ide-statusbar-eol" onClick={openEolMenu}>
                {eol === '\n' ? 'LF' : 'CRLF'}
              </button>
            )}
            {language && onSetLanguage && (
              <button type="button" className="ide-statusbar-item" title={t('status.selectLanguage')} data-testid="ide-statusbar-language" onClick={openLanguageMenu}>
                {languageLabel(language)}
              </button>
            )}
          </>
        )}
        {/* The real detected encoding. It used to say UTF-8 unconditionally,
            which was actively misleading for GBK / Latin-1 files. */}
        <span
          className="ide-statusbar-item"
          title={encoding !== undefined ? encodingLabel(encoding) : t('status.utf8')}
          data-testid="ide-statusbar-encoding"
        >
          {encoding !== undefined ? encodingLabel(encoding) : t('status.utf8')}
        </span>
        <NotificationBell t={t} />
        {/* Layout buttons (VS Code bottom-right layout controls). */}
        {onToggleSidebar && (
          <button type="button" className="ide-statusbar-item" title={t('command.toggleSidebar')} onClick={onToggleSidebar} data-testid="ide-statusbar-toggle-sidebar">{Icons.layoutSidebar}</button>
        )}
        {onToggleRightSidebar && (
          <button type="button" className="ide-statusbar-item" data-active={rightSidebarOpen || undefined} title={t('command.toggleRightSidebar')} onClick={onToggleRightSidebar} data-testid="ide-statusbar-toggle-right">{Icons.splitEditor}</button>
        )}
        <button type="button" className="ide-statusbar-item" title={t('status.layout')} onClick={openLayoutMenu} data-testid="ide-statusbar-layout">{Icons.layoutPanel}</button>
      </div>
    </div>
  )
}
