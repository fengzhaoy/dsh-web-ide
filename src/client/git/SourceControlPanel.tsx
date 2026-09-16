/**
 * Source Control sidebar panel — mirrors VS Code's Source Control view.
 *
 * Header: title + refresh action.
 * Branch row: current branch name + ahead/behind counts.
 * Changes section: lists every git status entry (modified/added/deleted/
 * renamed/untracked/conflicted) with a status icon and the file basename.
 * Clicking a file opens its diff in the editor area (onOpenDiff callback).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatusEntry, GitStatusResult, IdeToolsRemote, SessionId } from '../types.js'
import { Icons, fileIcon } from '../icons.js'
import { showContextMenu } from '../ContextMenu.js'

export interface SourceControlPanelProps {
  sessionId: SessionId
  cwd: string | undefined
  ideTools: IdeToolsRemote
  /** Open one path's diff in the editor area. */
  onOpenDiff: (path: string, kind: GitStatusEntry['kind']) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

type Status = 'loading' | 'ready' | 'error' | 'notrepo'

/** One-letter status badge color, matching VS Code's palette. */
function statusColor(kind: GitStatusEntry['kind']): string {
  switch (kind) {
    case 'added': return '#73c991'      // green
    case 'deleted': return '#f48771'     // red
    case 'renamed': return '#61afef'     // blue
    case 'untracked': return '#73c991'   // green (U)
    case 'conflicted': return '#e2c08d'  // amber
    case 'modified':
    default: return '#e2c08d'           // amber (M)
  }
}

/** Status letter badge, matching `git status --short` conventions. */
function statusLetter(kind: GitStatusEntry['kind']): string {
  switch (kind) {
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'untracked': return 'U'
    case 'conflicted': return 'C'
    case 'modified':
    default: return 'M'
  }
}

export function SourceControlPanel({ sessionId, cwd, ideTools, onOpenDiff, t }: SourceControlPanelProps) {
  const [status, setStatus] = useState<Status>('loading')
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [result, setResult] = useState<GitStatusResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    if (!cwd) return
    const mySeq = ++seq.current
    setStatus('loading')
    setError(null)
    const ctrl = new AbortController()
    try {
      const res = await ideTools.gitStatus(sessionId, ctrl.signal)
      if (mySeq !== seq.current) return
      if (res.ok) {
        if (res.value.notARepo) { setStatus('notrepo'); setResult(null) }
        else { setStatus('ready'); setResult(res.value) }
      } else {
        setStatus('error'); setError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      if (mySeq !== seq.current) return
      setStatus('error'); setError(err instanceof Error ? err.message : String(err))
    }
  }, [sessionId, cwd, ideTools])

  // Load on mount and when the session/cwd changes.
  useEffect(() => { void refresh() }, [refresh])

  // Auto-refresh every 15s while the panel is mounted (cheap status poll).
  useEffect(() => {
    const id = setInterval(() => { void refresh() }, 15000)
    return () => clearInterval(id)
  }, [refresh])

  const handleClick = useCallback((entry: GitStatusEntry) => {
    setSelectedPath(entry.path)
    onOpenDiff(entry.path, entry.kind)
  }, [onOpenDiff])

  const branchText = (() => {
    if (!result) return ''
    if (result.detached) return t('git.detached')
    return result.branch ?? ''
  })()

  const abText = (() => {
    if (!result) return ''
    if (result.ahead > 0 && result.behind > 0) return t('git.aheadBehind', { ahead: result.ahead, behind: result.behind })
    if (result.ahead > 0) return t('git.ahead', { count: result.ahead })
    if (result.behind > 0) return t('git.behind', { count: result.behind })
    return ''
  })()

  const handleCommit = useCallback(async () => {
    if (commitMessage.trim().length === 0 || committing) return
    setCommitting(true)
    setCommitError(null)
    try {
      const res = await ideTools.gitCommit(sessionId, commitMessage.trim())
      if (res.ok) {
        setCommitMessage('')
        await refresh()
      } else {
        setCommitError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err))
    } finally {
      setCommitting(false)
    }
  }, [sessionId, commitMessage, committing, ideTools, refresh])

  return (
    <div className="ide-git-panel">
      <div className="ide-git-header">
        <span className="ide-git-header-title">{t('git.title')}</span>
        <button
          className="ide-git-action"
          title={t('git.refresh')}
          onClick={() => { void refresh() }}
          disabled={status === 'loading'}
        >{status === 'loading' ? Icons.loading : Icons.refresh}</button>
      </div>

      <div className="ide-git-body">
        {status === 'loading' && (
          <div className="ide-git-state">{Icons.loading}<span>{t('git.loading')}</span></div>
        )}

        {status === 'notrepo' && (
          <div className="ide-git-state">{Icons.git}<span>{t('git.notARepo')}</span></div>
        )}

        {status === 'error' && (
          <div className="ide-git-state ide-git-error">{Icons.git}<span>{t('git.failed', { message: error ?? '' })}</span></div>
        )}

        {status === 'ready' && result && (
          <>
            {branchText && (
              <div className="ide-git-branch" title={result.upstream ?? branchText}>
                <span className="ide-git-branch-icon">{Icons.branch}</span>
                <span className="ide-git-branch-name">{branchText}</span>
                {abText && <span className="ide-git-branch-ab">{abText}</span>}
              </div>
            )}

            {/* Commit message input + commit button (VSCode-style SCM input) */}
            <div className="ide-git-input">
              <textarea
                className="ide-git-input-field"
                placeholder={t('git.commitPlaceholder')}
                value={commitMessage}
                onChange={(e) => { setCommitMessage(e.target.value); setCommitError(null) }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    void handleCommit()
                  }
                }}
                rows={2}
                disabled={committing}
              />
              <button
                className="ide-git-input-button"
                onClick={() => { void handleCommit() }}
                disabled={committing || commitMessage.trim().length === 0}
                title={t('git.commitButton') + ' (Ctrl/Cmd+Enter)'}
              >
                {committing ? Icons.loading : Icons.check}
                <span>{t('git.commitButton')}</span>
              </button>
            </div>
            {commitError && (
              <div className="ide-git-input-error">{commitError}</div>
            )}

            <div className="ide-git-section">
              <div className="ide-git-section-header">
                <span className="ide-git-section-chevron">{Icons.chevronDown}</span>
                <span className="ide-git-section-title">{t('git.changes')}</span>
                {result.entries.length > 0 && (
                  <span className="ide-git-section-count">{result.entries.length}</span>
                )}
              </div>

              {result.entries.length === 0 ? (
                <div className="ide-git-empty">{t('git.noChanges')}</div>
              ) : (
                <div className="ide-git-entries">
                  {result.entries.map((entry) => {
                    const name = entry.path.split('/').pop() ?? entry.path
                    const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''
                    const isSelected = entry.path === selectedPath
                    return (
                      <div
                        key={entry.path}
                        className="ide-git-entry"
                        data-selected={isSelected || undefined}
                        title={entry.oldPath ? entry.oldPath + ' → ' + entry.path : entry.path}
                        onClick={() => handleClick(entry)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          showContextMenu(e.clientX, e.clientY, [
                            { id: 'open-change', label: t('git.openDiff'), icon: Icons.diff, onClick: () => handleClick(entry) },
                            { id: 'open-file', label: t('git.openFile'), icon: Icons.goToFile },
                            { id: 'sep1', label: '', separator: true },
                            { id: 'stage', label: t('git.stage'), icon: Icons.plus },
                            { id: 'discard', label: t('git.discard'), icon: Icons.discard },
                            { id: 'sep2', label: '', separator: true },
                            { id: 'copy-path', label: t('context.copyPath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(entry.path) } },
                          ])
                        }}
                      >
                        <span className="ide-git-entry-icon">{fileIcon(name, false)}</span>
                        <span className="ide-git-entry-name">{name}</span>
                        {dir && <span className="ide-git-entry-dir">{dir}</span>}
                        <span className="ide-git-entry-status" style={{ color: statusColor(entry.kind) }}>
                          {statusLetter(entry.kind)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
