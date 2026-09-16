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
  /** Paths whose changes were discarded (the view closes a matching diff and
   *  reloads an open editor buffer so it cannot be saved back over HEAD). */
  onChangesDiscarded?: (paths: readonly string[]) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

type Status = 'loading' | 'ready' | 'error' | 'notrepo'

/** The commit split-button modes (VS Code SCM dropdown parity). */
type CommitMode = 'commit' | 'amend' | 'signoff' | 'push' | 'sync'

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

export function SourceControlPanel({ sessionId, cwd, ideTools, onOpenDiff, onChangesDiscarded, t }: SourceControlPanelProps) {
  const [status, setStatus] = useState<Status>('loading')
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  /** Sync/Publish action button in flight (pull+push / push -u). */
  const [syncing, setSyncing] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [result, setResult] = useState<GitStatusResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  /** Entry awaiting the discard confirmation dialog. */
  const [confirmDiscard, setConfirmDiscard] = useState<GitStatusEntry | null>(null)
  const [discarding, setDiscarding] = useState(false)
  /** Error shown inside the discard dialog (and cleared on close/retry). */
  const [discardError, setDiscardError] = useState<string | null>(null)
  /** Error from the one-file stage action, shown inline under the input. */
  const [stageError, setStageError] = useState<string | null>(null)
  const genSeq = useRef(0)
  const seq = useRef(0)
  /** The caret half of the commit split button — dropdown anchor. */
  const caretRef = useRef<HTMLButtonElement>(null)

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

  /** Stage one path (context menu → 暂存更改). */
  const handleStage = useCallback(async (entry: GitStatusEntry) => {
    setStageError(null)
    try {
      const res = await ideTools.gitStage(sessionId, entry.path)
      if (res.ok) {
        await refresh()
      } else {
        setStageError(t('git.stageFailed', { message: res.error.message ?? res.error.code }))
      }
    } catch (err) {
      setStageError(t('git.stageFailed', { message: err instanceof Error ? err.message : String(err) }))
    }
  }, [sessionId, ideTools, refresh, t])

  /** Discard confirmation accepted — run gitDiscard and resync. */
  const handleDiscard = useCallback(async () => {
    const entry = confirmDiscard
    if (!entry || discarding) return
    setDiscarding(true)
    setDiscardError(null)
    try {
      const res = await ideTools.gitDiscard(sessionId, { path: entry.path, oldPath: entry.oldPath, kind: entry.kind })
      if (res.ok) {
        setConfirmDiscard(null)
        setSelectedPath((current) => (current === entry.path ? undefined : current))
        await refresh()
        onChangesDiscarded?.([entry.path])
      } else {
        setDiscardError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      setDiscardError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiscarding(false)
    }
  }, [confirmDiscard, discarding, sessionId, ideTools, refresh, onChangesDiscarded, t])

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

  const runCommit = useCallback(async (mode: CommitMode) => {
    const message = commitMessage.trim()
    // Amend may run with an empty input — it keeps the previous message.
    if (mode !== 'amend' && message.length === 0) return
    if (committing) return
    setCommitting(true)
    setCommitError(null)
    const options = {
      amend: mode === 'amend',
      signoff: mode === 'signoff',
      push: mode === 'push',
      sync: mode === 'sync',
    }
    try {
      const res = await ideTools.gitCommit(sessionId, message, options)
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

  /** VS Code SCM action button: synchronize (pull+push) or publish
   *  (push -u origin <branch>) on a clean tree. */
  const handleSync = useCallback(async (action: 'sync' | 'publish') => {
    if (syncing) return
    setSyncing(true)
    setCommitError(null)
    try {
      const res = await ideTools.gitSync(sessionId, action)
      if (res.ok) {
        await refresh()
      } else {
        setCommitError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }, [sessionId, syncing, ideTools, refresh])

  /** Open the commit dropdown (VS Code's commit split button secondary menu),
   *  anchored under the caret half of the split button. */
  const openCommitMenu = useCallback(() => {
    const el = caretRef.current
    const rect = el?.getBoundingClientRect()
    const x = rect ? rect.left : 120
    const y = rect ? rect.bottom + 2 : 120
    const hasMessage = commitMessage.trim().length > 0
    const busy = committing
    showContextMenu(x, y, [
      { id: 'commit', label: t('git.commitButton'), icon: Icons.check, disabled: busy || !hasMessage, onClick: () => { void runCommit('commit') } },
      { id: 'amend', label: t('git.commitAmend'), icon: Icons.check, disabled: busy, onClick: () => { void runCommit('amend') } },
      { id: 'signoff', label: t('git.commitSignoff'), icon: Icons.check, disabled: busy || !hasMessage, onClick: () => { void runCommit('signoff') } },
      { id: 'sep-post', label: '', separator: true },
      { id: 'push', label: t('git.commitPush'), icon: Icons.arrowUp, disabled: busy || !hasMessage, onClick: () => { void runCommit('push') } },
      { id: 'sync', label: t('git.commitSync'), icon: Icons.sync, disabled: busy || !hasMessage, onClick: () => { void runCommit('sync') } },
    ])
  }, [commitMessage, committing, runCommit, t])

  const handleGenerate = useCallback(async () => {
    if (generating) return
    const myGen = ++genSeq.current
    setGenerating(true)
    setGenError(null)
    try {
      const res = await ideTools.gitGenerateCommitMessage(sessionId)
      if (myGen !== genSeq.current) return
      if (res.ok) {
        setCommitMessage(res.value.message)
      } else {
        setGenError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      if (myGen !== genSeq.current) return
      setGenError(err instanceof Error ? err.message : String(err))
    } finally {
      if (myGen === genSeq.current) setGenerating(false)
    }
  }, [sessionId, generating, ideTools])

  return (
    <div className="ide-git-panel">
      <div className="ide-git-header">
        <span className="ide-git-header-title">{t('git.title')}</span>
        <button
          className="ide-git-action"
          title={generating ? t('git.aiGenerating') : t('git.aiGenerate')}
          onClick={() => { void handleGenerate() }}
          disabled={generating || status !== 'ready' || (result?.entries.length ?? 0) === 0}
        >{generating ? Icons.loading : Icons.sparkle}</button>
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
                    void runCommit('commit')
                  }
                }}
                rows={2}
                disabled={committing}
              />
              {result.clean && !result.detached && result.branch && result.branch !== '(unborn)' && (result.upstream ? (result.ahead > 0 || result.behind > 0) : true) ? (
                /* VS Code action button: clean tree → Synchronize Changes
                   (upstream, ahead/behind) or Publish Branch (no upstream). */
                <button
                  className="ide-git-input-button ide-git-input-action"
                  onClick={() => { void handleSync(result.upstream ? 'sync' : 'publish') }}
                  disabled={syncing}
                  title={result.upstream ? t('git.syncTooltip') : t('git.publishTooltip')}
                >
                  {syncing ? Icons.loading : (result.upstream ? Icons.sync : Icons.cloudUpload)}
                  <span>{result.upstream ? t('git.syncButton') : t('git.publishButton')}</span>
                  {result.behind > 0 && <span className="ide-git-input-ab">{result.behind}↓</span>}
                  {result.ahead > 0 && <span className="ide-git-input-ab">{result.ahead}↑</span>}
                </button>
              ) : (
                <div className="ide-git-input-row">
                  <button
                    className="ide-git-input-button"
                    onClick={() => { void runCommit('commit') }}
                    onContextMenu={(e) => { e.preventDefault(); openCommitMenu() }}
                    disabled={committing || commitMessage.trim().length === 0}
                    title={t('git.commitButton') + ' (Ctrl/Cmd+Enter)'}
                  >
                    {committing ? Icons.loading : Icons.check}
                    <span>{t('git.commitButton')}</span>
                  </button>
                  <button
                    ref={caretRef}
                    className="ide-git-input-button ide-git-input-caret"
                    onClick={openCommitMenu}
                    disabled={committing}
                    title={t('git.commitMenu')}
                  >
                    {Icons.chevronDown}
                  </button>
                </div>
              )}
            </div>
            {commitError && (
              <div className="ide-git-input-error">{commitError}</div>
            )}
            {genError && (
              <div className="ide-git-input-error">{t('git.aiGenerateError', { message: genError })}</div>
            )}
            {stageError && (
              <div className="ide-git-input-error">{stageError}</div>
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
                    const segs = entry.path.split('/')
                    const name = segs[segs.length - 1] || entry.path
                    const dir = segs.length > 1 ? segs.slice(0, -1).join('/') : ''
                    const isSelected = entry.path === selectedPath
                    return (
                      <div
                        key={entry.path}
                        className="ide-git-entry"
                        data-selected={isSelected || undefined}
                        data-kind={entry.kind}
                        title={entry.oldPath ? entry.oldPath + ' \u2192 ' + entry.path : entry.path}
                        onClick={() => handleClick(entry)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          showContextMenu(e.clientX, e.clientY, [
                            { id: 'open-change', label: t('git.openDiff'), icon: Icons.diff, onClick: () => handleClick(entry) },
                            { id: 'open-file', label: t('git.openFile'), icon: Icons.goToFile },
                            { id: 'sep1', label: '', separator: true },
                            { id: 'stage', label: t('git.stage'), icon: Icons.plus, onClick: () => { void handleStage(entry) } },
                            { id: 'discard', label: t('git.discard'), icon: Icons.discard, onClick: () => { setDiscardError(null); setConfirmDiscard(entry) } },
                            { id: 'sep2', label: '', separator: true },
                            { id: 'copy-path', label: t('context.copyPath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(entry.path) } },
                          ])
                        }}
                      >
                        <span className="ide-git-entry-icon" data-kind={entry.kind}>{fileIcon(name, false)}</span>
                        <span className="ide-git-entry-name" data-kind={entry.kind}>{name}</span>
                        {dir && <span className="ide-git-entry-dir">{dir}</span>}
                        <span className="ide-git-entry-status" data-kind={entry.kind}>
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

      {/* Discard confirmation (VS Code-style destructive-action dialog). */}
      {confirmDiscard !== null && (
        <div
          className="ide-dialog-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !discarding) setConfirmDiscard(null) }}
        >
          <div className="ide-dialog">
            <div className="ide-dialog-title">{t('git.discardConfirmTitle')}</div>
            <div className="ide-dialog-body">
              {confirmDiscard.kind === 'untracked'
                ? t('git.discardConfirmDelete', { name: confirmDiscard.path })
                : t('git.discardConfirmBody', { name: confirmDiscard.path })}
              <br />
              {t('git.discardConfirmWarning')}
            </div>
            {discardError !== null && <div className="ide-git-input-error">{t('git.discardFailed', { message: discardError })}</div>}
            <div className="ide-dialog-actions">
              <button
                className="ide-dialog-button ide-dialog-button-quiet"
                type="button"
                onClick={() => setConfirmDiscard(null)}
                disabled={discarding}
              >{t('git.cancel')}</button>
              <button
                className="ide-dialog-button"
                type="button"
                onClick={() => { void handleDiscard() }}
                disabled={discarding}
              >{discarding ? Icons.loading : Icons.discard}<span>{t('git.discard')}</span></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
