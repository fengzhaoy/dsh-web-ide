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
import { GraphView } from './GraphView.js'
import { BranchesView } from './BranchesView.js'

export interface SourceControlPanelProps {
  sessionId: SessionId
  cwd: string | undefined
  ideTools: IdeToolsRemote
  /** Open one path's diff in the editor area. */
  onOpenDiff: (path: string, kind: GitStatusEntry['kind']) => void
  /** Open one file of one commit as a diff in the editor area (graph view). */
  onOpenCommitDiff: (sha: string, path: string, oldPath: string | undefined) => void
  /** Paths whose changes were discarded (the view closes a matching diff and
   *  reloads an open editor buffer so it cannot be saved back over HEAD). */
  onChangesDiscarded?: (paths: readonly string[]) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

type Status = 'loading' | 'ready' | 'error' | 'notrepo'

/** The SCM sidebar's sub-views, mirroring VS Code's view switcher
 *  (Source Control / Source Control Graph) plus a branches list. */
type ScmView = 'changes' | 'graph' | 'branches'

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

export function SourceControlPanel({ sessionId, cwd, ideTools, onOpenDiff, onOpenCommitDiff, onChangesDiscarded, t }: SourceControlPanelProps) {
  const [view, setView] = useState<ScmView>('changes')
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
  /** Abort controller for the in-flight AI commit message generation. */
  const genAbort = useRef<AbortController | null>(null)
  const seq = useRef(0)
  /** The commit message textarea — focused after a successful generation. */
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** The caret half of the commit split button — dropdown anchor. */
  const caretRef = useRef<HTMLButtonElement>(null)
  /** The header view-switcher — dropdown anchor. */
  const switcherRef = useRef<HTMLButtonElement>(null)

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

  /** True when the working tree has no visible changes — the AI generate
   *  button is then disabled with an explanatory tooltip. */
  const noChanges = (result?.entries.length ?? 0) === 0

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
        // The host reports committed=false when the tree was clean (nothing
        // created) — surface that instead of silently eating the message.
        if (res.value.committed === false) {
          setCommitError(t('git.commitNothing'))
        } else {
          setCommitMessage('')
        }
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

  /** AI-generate a commit message from the current changes (cancellable,
   *  VS Code Copilot style: the result lands in the input, focused). */
  const handleGenerate = useCallback(async () => {
    if (generating) return
    const ctrl = new AbortController()
    genAbort.current = ctrl
    setGenerating(true)
    setGenError(null)
    try {
      const res = await ideTools.gitGenerateCommitMessage(sessionId, ctrl.signal)
      if (ctrl.signal.aborted) return
      if (res.ok) {
        setCommitMessage(res.value.message)
        // VS Code parity: focus the SCM input with the caret at the end so
        // the message can be reviewed and committed immediately.
        const el = inputRef.current
        if (el) {
          el.focus()
          const end = res.value.message.length
          el.setSelectionRange(end, end)
        }
      } else if (res.error.code !== 'ide-tools/aborted') {
        setGenError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      if (ctrl.signal.aborted) return
      setGenError(err instanceof Error ? err.message : String(err))
    } finally {
      if (genAbort.current === ctrl) genAbort.current = null
      setGenerating(false)
    }
  }, [sessionId, generating, ideTools])

  /** Stop the in-flight generation (stop button / Escape). */
  const cancelGenerate = useCallback(() => {
    genAbort.current?.abort()
  }, [])

  /** The header view switcher (VS Code's SCM view picker): lists the
   *  Source Control / Graph / Branches views, checking the active one. */
  const openViewMenu = useCallback(() => {
    const el = switcherRef.current
    const rect = el?.getBoundingClientRect()
    const x = rect ? rect.left : 16
    const y = rect ? rect.bottom + 2 : 40
    const entries: readonly { view: ScmView; label: string; icon: typeof Icons.git }[] = [
      { view: 'changes', label: t('git.title'), icon: Icons.git },
      { view: 'graph', label: t('git.graphTitle'), icon: Icons.gitGraph },
      { view: 'branches', label: t('git.branchesTitle'), icon: Icons.branch },
    ]
    showContextMenu(x, y, entries.map((entry) => ({
      id: entry.view,
      label: entry.label,
      icon: view === entry.view ? Icons.check : entry.icon,
      onClick: () => setView(entry.view),
    })))
  }, [view, t])

  /** Any history-mutating action from the graph/branches views resyncs the
   *  status-driven parts (branch row, changes list, activity bar badge). */
  const handleMutated = useCallback(() => { void refresh() }, [refresh])

  /** The active view's title for the switcher button. */
  const viewTitle = view === 'graph' ? t('git.graphTitle')
    : view === 'branches' ? t('git.branchesTitle')
    : t('git.title')

  return (
    <div className="ide-git-panel">
      <div className="ide-git-header" data-view={view}>
        <button
          ref={switcherRef}
          className="ide-git-header-switch"
          title={t('git.graphSwitchView')}
          onClick={openViewMenu}
        >
          <span className="ide-git-header-title">{viewTitle}</span>
          <span className="ide-git-header-caret">{Icons.chevronDown}</span>
        </button>
        {view === 'changes' && (
          <>
            <button
              className={generating ? 'ide-git-action ide-git-action-busy' : 'ide-git-action'}
              title={
                generating ? t('git.aiStop')
                  : status !== 'ready' || noChanges ? t('git.aiGenerateNoChanges')
                    : commitMessage.trim().length > 0 ? t('git.aiGenerateAgain')
                      : t('git.aiGenerate')
              }
              onClick={() => { if (generating) cancelGenerate(); else void handleGenerate() }}
              disabled={(status !== 'ready' || noChanges) && !generating}
            >{generating ? Icons.close : Icons.sparkle}</button>
            <button
              className="ide-git-action"
              title={t('git.refresh')}
              onClick={() => { void refresh() }}
              disabled={status === 'loading'}
            >{status === 'loading' ? Icons.loading : Icons.refresh}</button>
          </>
        )}
      </div>

      <div className="ide-git-body">
        {view === 'graph' ? (
          <GraphView
            sessionId={sessionId}
            cwd={cwd}
            ideTools={ideTools}
            onOpenCommitDiff={onOpenCommitDiff}
            onMutated={handleMutated}
            t={t}
          />
        ) : view === 'branches' ? (
          <BranchesView
            sessionId={sessionId}
            cwd={cwd}
            ideTools={ideTools}
            onMutated={handleMutated}
            t={t}
          />
        ) : (<>
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
            <div className="ide-git-input" data-generating={generating ? 'true' : undefined}>
              <textarea
                ref={inputRef}
                className="ide-git-input-field"
                placeholder={generating && commitMessage.length === 0 ? t('git.aiGeneratingPlaceholder') : t('git.commitPlaceholder')}
                value={commitMessage}
                onChange={(e) => { setCommitMessage(e.target.value); setCommitError(null) }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    void runCommit('commit')
                  } else if (e.key === 'Escape' && generating) {
                    e.preventDefault()
                    cancelGenerate()
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
              <div className="ide-git-input-error">
                <span>{t('git.aiGenerateError', { message: genError })}</span>
                <button className="ide-git-retry" title={t('git.aiRetry')} onClick={() => { void handleGenerate() }}>{t('git.aiRetry')}</button>
              </div>
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
          </>)}
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
