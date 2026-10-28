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
  /** Open one path's diff in the editor area. diffKind='staged' opens the
   *  index-vs-HEAD diff (a Staged Changes group entry). */
  onOpenDiff: (path: string, kind: GitStatusEntry['kind'], diffKind?: 'staged') => void
  /** Open the working-tree file itself in the editor (context menu → Open
   *  File, VS Code parity). The path is workspace-relative. */
  onOpenFile?: (path: string) => void
  /** Open one file of one commit as a diff in the editor area (graph view). */
  onOpenCommitDiff: (sha: string, path: string, oldPath: string | undefined) => void
  /** Bumped by the owner whenever external activity may have changed git
   *  state (file watcher hits, diff saves): retriggers a status fetch. */
  refreshKey?: number
  /** Mirrors each successful status fetch to the owner so the activity-bar
   *  badge shows exactly what the panel sees (no lag, no duplicate fetch).
   *  Carries the FULL result (branch/ahead/behind too): while the SCM panel
   *  is mounted it is the single poller — the owner pauses its own interval
   *  and feeds every consumer (badge, file tree, status bar) from this
   *  callback, so gitStatus is requested exactly once per cycle. */
  onStatusChanged?: (result: GitStatusResult | undefined) => void
  /** Paths whose changes were discarded (the view closes a matching diff and
   *  reloads an open editor buffer so it cannot be saved back over HEAD). */
  onChangesDiscarded?: (paths: readonly string[]) => void
  /** Lifted commit-message state. When provided, the owner (IdeView) holds the
   *  text across sidebar view switches so switching to the explorer and back
   *  does not wipe a typed/AI-generated commit message. */
  commitMessage?: string
  onCommitMessageChange?: (value: string) => void
  /** Views the owner wants opened (e.g. the status-bar branch button opens the
   *  Branches view). Applied once per new array identity — the owner passes a
   *  fresh object each request, so repeated clicks re-open the view. */
  openViewsRequest?: Partial<ScmOpenViews>
  /** Which views are currently expanded (mirrored to the owner so the status
   *  bar can toggle the Branches view and show its active state). */
  onOpenViewsChanged?: (views: ScmOpenViews) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

type Status = 'loading' | 'ready' | 'error' | 'notrepo'

/** The SCM sidebar's sub-views, now rendered as a stack of independently
 *  collapsible sub-panels (源代码管理 / 图表 / 分支) instead of a header
 *  dropdown. Each entry is its own open/close state — multi-expand, not
 *  single-active (modelled on the reference project's csCard accordion). */
export type ScmOpenViews = { changes: boolean; graph: boolean; branches: boolean }

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

/** Whether two status results render identically (entries + branch header).
 *  Used to skip state writes when a background poll found nothing new — no
 *  write means no re-render and no flicker. */
function sameStatus(a: GitStatusResult | null, b: GitStatusResult): boolean {
  if (a === null) return false
  if (a.entries.length !== b.entries.length) return false
  for (let i = 0; i < a.entries.length; i++) {
    const x = a.entries[i]
    const y = b.entries[i]
    if (x.path !== y.path || x.kind !== y.kind || x.statusCode !== y.statusCode || x.oldPath !== y.oldPath) return false
  }
  return a.branch === b.branch && a.upstream === b.upstream && a.ahead === b.ahead && a.behind === b.behind && a.detached === b.detached
}

export function SourceControlPanel({ sessionId, cwd, ideTools, onOpenDiff, onOpenFile, onOpenCommitDiff, onChangesDiscarded, refreshKey, onStatusChanged, commitMessage: commitMessageProp, onCommitMessageChange, openViewsRequest, onOpenViewsChanged, t }: SourceControlPanelProps) {
  const [openViews, setOpenViews] = useState<ScmOpenViews>({ changes: true, graph: false, branches: false })
  // External "open this view" requests (status-bar branch button). Keyed on
  // object identity so the SAME view can be re-opened after the user
  // collapsed it.
  useEffect(() => {
    if (openViewsRequest === undefined) return
    setOpenViews((current) => ({ ...current, ...openViewsRequest }))
  }, [openViewsRequest])
  // Mirror the expanded set to the owner (status-bar branch button state).
  useEffect(() => { onOpenViewsChanged?.(openViews) }, [openViews, onOpenViewsChanged])
  const [status, setStatus] = useState<Status>('loading')
  // Commit message: controlled by the owner when lift props are supplied (so
  // it survives sidebar view switches); otherwise a local state fallback.
  const [commitMessageLocal, setCommitMessageLocal] = useState('')
  const commitMessage = commitMessageProp ?? commitMessageLocal
  const setCommitMessage = (value: string) => {
    if (onCommitMessageChange) onCommitMessageChange(value)
    else setCommitMessageLocal(value)
  }
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
  /** Discard-ALL awaiting its (separate) confirmation dialog. */
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false)
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
  /** The changes panel's "..." (more actions) button — menu anchor. */
  const moreRef = useRef<HTMLButtonElement>(null)
  /** Latest onStatusChanged — read through a ref so `refresh` stays stable
   *  even when the owner passes an inline callback. */
  const statusChangedRef = useRef(onStatusChanged)
  useEffect(() => { statusChangedRef.current = onStatusChanged })

  const refresh = useCallback(async () => {
    if (!cwd) return
    const mySeq = ++seq.current
    // Silent background refresh (VS Code style): keep the current list visible
    // while re-fetching — only the FIRST load (or a session switch) shows the
    // loading state, otherwise every poll would blank the panel and flicker.
    setStatus((current) => (current === 'ready' || current === 'error' ? current : 'loading'))
    setError(null)
    const ctrl = new AbortController()
    try {
      const res = await ideTools.gitStatus(sessionId, ctrl.signal)
      if (mySeq !== seq.current) return
      if (res.ok) {
        if (res.value.notARepo) {
          setStatus((current) => (current === 'notrepo' ? current : 'notrepo'))
          setResult((current) => (current === null ? current : null))
          // Contract: `undefined` means "no repo / no data". Passing the
          // notARepo object here made callers rely on a field check instead.
          statusChangedRef.current?.(undefined)
        } else {
          setStatus((current) => (current === 'ready' ? current : 'ready'))
          // Write the result only when something actually changed: identical
          // entries leave the component untouched (zero re-render, zero flicker).
          setResult((current) => (sameStatus(current, res.value) ? current : res.value))
          statusChangedRef.current?.(res.value)
        }
      } else {
        // Only a load with NO list to show surfaces the error state — a
        // background poll failure keeps the current list visible (VS Code
        // style; one transient error must not blank the panel).
        setStatus((current) => (current === 'ready' || current === 'notrepo' ? current : 'error'))
        setError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      if (mySeq !== seq.current) return
      setStatus((current) => (current === 'ready' || current === 'notrepo' ? current : 'error'))
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [sessionId, cwd, ideTools])

  // Load on mount and when the session/cwd changes.
  useEffect(() => { void refresh() }, [refresh])

  // Auto-refresh every 15s while the panel is mounted (cheap status poll).
  // Freshness mostly comes from event bumps (writes, diff saves) via refreshKey
  // — polling stays slow so the panel never churns (VS Code uses watchers, not
  // fast polling; the silent refresh above keeps even a hit flicker-free).
  useEffect(() => {
    const id = setInterval(() => { void refresh() }, 15000)
    return () => clearInterval(id)
  }, [refresh])

  // External-activity bumps (file-watcher hits, diff saves) refetch at once.
  const firstRefreshKey = useRef(refreshKey)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey !== firstRefreshKey.current) void refresh()
    firstRefreshKey.current = refreshKey
  }, [refreshKey, refresh])

  /** VS Code SCM grouping: a staged entry (X letter set, or an unmerged
   *  conflict) lives in the "Staged Changes" / "Merge Changes" group.
   *  Porcelain v2 marks an unchanged index slot with '.' (v1 used a
   *  space), so BOTH count as not-staged alongside untracked '?'. */
  const isStagedEntry = useCallback((entry: GitStatusEntry): boolean => {
    if (entry.kind === 'conflicted') return true
    const x = entry.statusCode[0] ?? ' '
    return x !== ' ' && x !== '.' && x !== '?'
  }, [])

  const handleClick = useCallback((entry: GitStatusEntry, staged: boolean) => {
    setSelectedPath(entry.path)
    onOpenDiff(entry.path, entry.kind, staged ? 'staged' : undefined)
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
    // VS Code smart-commit: when the index already holds staged entries the
    // commit takes EXACTLY those (autoStage:false); a fully unstaged tree
    // still stages everything (autoStage default), matching git's own UX.
    const hasStaged = result?.entries.some((entry) => isStagedEntry(entry)) ?? false
    const options = {
      amend: mode === 'amend',
      signoff: mode === 'signoff',
      push: mode === 'push',
      sync: mode === 'sync',
      ...(hasStaged ? { autoStage: false as const } : {}),
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
  }, [sessionId, commitMessage, committing, ideTools, refresh, result, isStagedEntry])

  /** Unstage one path (hover button / context menu). */
  const handleUnstage = useCallback(async (entry: GitStatusEntry) => {
    setStageError(null)
    try {
      const res = await ideTools.gitUnstage(sessionId, entry.path)
      if (res.ok) await refresh()
      else setStageError(t('git.unstageFailed', { message: res.error.message ?? res.error.code }))
    } catch (err) {
      setStageError(t('git.unstageFailed', { message: err instanceof Error ? err.message : String(err) }))
    }
  }, [sessionId, ideTools, refresh, t])

  /** Unstage everything (the staged group's "−" header action). */
  const handleUnstageAll = useCallback(async () => {
    setStageError(null)
    try {
      const res = await ideTools.gitUnstageAll(sessionId)
      if (res.ok) await refresh()
      else setStageError(t('git.unstageFailed', { message: res.error.message ?? res.error.code }))
    } catch (err) {
      setStageError(t('git.unstageFailed', { message: err instanceof Error ? err.message : String(err) }))
    }
  }, [sessionId, ideTools, refresh, t])

  /** Stage everything (the changes group's "＋" header action). */
  const handleStageAll = useCallback(async () => {
    setStageError(null)
    try {
      const res = await ideTools.gitStageAll(sessionId)
      if (res.ok) await refresh()
      else setStageError(t('git.stageFailed', { message: res.error.message ?? res.error.code }))
    } catch (err) {
      setStageError(t('git.stageFailed', { message: err instanceof Error ? err.message : String(err) }))
    }
  }, [sessionId, ideTools, refresh, t])

  /** VS Code SCM action button: synchronize (pull+push) or publish
   *  (push -u origin <branch>) on a clean tree. */
  const handleSync = useCallback(async (action: 'sync' | 'publish' | 'pull' | 'push') => {
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

  /** Discard ALL changes (the changes group's "↩" header action, confirmed
   *  through the same dialog as a single discard). */
  const handleDiscardAll = useCallback(async () => {
    if (discarding) return
    setDiscarding(true)
    setDiscardError(null)
    try {
      const res = await ideTools.gitDiscardAll(sessionId)
      if (res.ok) {
        setConfirmDiscardAll(false)
        await refresh()
        onChangesDiscarded?.(result?.entries.map((entry) => entry.path) ?? [])
      } else {
        setDiscardError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      setDiscardError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiscarding(false)
    }
  }, [discarding, sessionId, ideTools, refresh, onChangesDiscarded, result])

  /** Fetch from the upstream remote (best effort; failures surface inline). */
  const handleFetch = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    setCommitError(null)
    try {
      const res = await ideTools.gitFetch(sessionId)
      if (res.ok) await refresh()
      else setCommitError(res.error.message ?? res.error.code)
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }, [sessionId, syncing, ideTools, refresh])

  /** The changes panel's "..." menu (VS Code SCM view menu): pull, push,
   *  fetch, plus the group-level stage-all / discard-all quick actions. */
  const openMoreMenu = useCallback(() => {
    const el = moreRef.current
    const rect = el?.getBoundingClientRect()
    const x = rect ? rect.left : 120
    const y = rect ? rect.bottom + 2 : 120
    const busy = syncing || committing
    showContextMenu(x, y, [
      { id: 'pull', label: t('git.pull'), icon: Icons.arrowDown, disabled: busy, onClick: () => { void handleSync('pull') } },
      { id: 'push', label: t('git.push'), icon: Icons.arrowUp, disabled: busy, onClick: () => { void handleSync('push') } },
      { id: 'fetch', label: t('git.fetch'), icon: Icons.cloudDownload, disabled: busy, onClick: () => { void handleFetch() } },
      { id: 'sep1', label: '', separator: true },
      { id: 'stage-all', label: t('git.stageAll'), icon: Icons.plus, disabled: busy || noChanges, onClick: () => { void handleStageAll() } },
      { id: 'discard-all', label: t('git.discardAll'), icon: Icons.discard, disabled: busy || noChanges, onClick: () => { setDiscardError(null); setConfirmDiscardAll(true) } },
    ])
  }, [t, syncing, committing, noChanges, handleSync, handleStageAll])

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

  /** Toggle one sub-panel open/closed (multi-expand: each is independent). */
  const toggleView = useCallback((key: keyof ScmOpenViews) => {
    setOpenViews((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  /** Any history-mutating action from the graph/branches views resyncs the
   *  status-driven parts (branch row, changes list, activity bar badge). */
  const handleMutated = useCallback(() => { void refresh() }, [refresh])

  /** Render one changes group (VS Code SCM resource groups): a header with
   *  the group label, count, and group-level actions (＋ stage all / −
   *  unstage all / ↩ discard all), followed by its entries with per-row
   *  hover actions (open-file / discard / stage-or-unstage). */
  const renderGroup = (group: 'merge' | 'staged' | 'changes', label: string, entries: readonly GitStatusEntry[]) => (
    <div className="ide-git-group" data-group={group} data-testid={'ide-git-group-' + group}>
      <div className="ide-git-group-header">
        <span className="ide-git-group-label">{label}</span>
        <span className="ide-git-group-count">{entries.length}</span>
        <span className="ide-git-group-actions">
          {group === 'changes' && (
            <>
              <button
                type="button"
                className="ide-git-group-action"
                title={t('git.discardAll')}
                onClick={() => { setDiscardError(null); setConfirmDiscardAll(true) }}
              >{Icons.discard}</button>
              <button
                type="button"
                className="ide-git-group-action"
                title={t('git.stageAll')}
                onClick={() => { void handleStageAll() }}
              >{Icons.plus}</button>
            </>
          )}
          {group === 'staged' && (
            <button
              type="button"
              className="ide-git-group-action"
              title={t('git.unstageAll')}
              onClick={() => { void handleUnstageAll() }}
            >{Icons.dash}</button>
          )}
        </span>
      </div>
      {entries.map((entry) => {
        const segs = entry.path.split('/')
        const name = segs[segs.length - 1] || entry.path
        const dir = segs.length > 1 ? segs.slice(0, -1).join('/') : ''
        const isSelected = entry.path === selectedPath
        const staged = group !== 'changes'
        return (
          <div
            key={entry.path}
            className="ide-git-entry"
            data-selected={isSelected || undefined}
            data-kind={entry.kind}
            data-testid={'ide-git-entry-' + entry.path}
            title={entry.oldPath ? entry.oldPath + ' → ' + entry.path : entry.path}
            onClick={() => handleClick(entry, staged)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              showContextMenu(e.clientX, e.clientY, [
                { id: 'open-change', label: t('git.openDiff'), icon: Icons.diff, onClick: () => handleClick(entry, staged) },
                { id: 'open-file', label: t('git.openFile'), icon: Icons.goToFile, disabled: !onOpenFile, onClick: () => { onOpenFile?.(entry.path) } },
                { id: 'sep1', label: '', separator: true },
                // Conflicted entries stage instead of unstaging: git add on an
                // unmerged path marks the conflict resolved (VS Code parity),
                // while git reset HEAD on it just errors.
                ...(staged && entry.kind !== 'conflicted'
                  ? [{ id: 'unstage', label: t('git.unstage'), icon: Icons.dash, onClick: () => { void handleUnstage(entry) } }]
                  : [{ id: 'stage', label: t('git.stage'), icon: Icons.plus, onClick: () => { void handleStage(entry) } }]),
                { id: 'discard', label: t('git.discard'), icon: Icons.discard, onClick: () => { setDiscardError(null); setConfirmDiscard(entry) } },
                { id: 'sep2', label: '', separator: true },
                { id: 'copy-path', label: t('context.copyPath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(entry.path) } },
                { id: 'copy-rel-path', label: t('context.copyRelativePath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(cwd ? entry.path.replace(cwd.replace(/[\/\\]+$/, '') + '/', '') : entry.path) } },
              ])
            }}
          >
            <span className="ide-git-entry-icon" data-kind={entry.kind}>{fileIcon(name, false)}</span>
            <span className="ide-git-entry-name" data-kind={entry.kind}>{name}</span>
            {dir && <span className="ide-git-entry-dir">{dir}</span>}
            <span className="ide-git-entry-hover-actions">
              <button
                type="button"
                className="ide-git-group-action"
                title={t('git.openFile')}
                onClick={(e) => { e.stopPropagation(); onOpenFile?.(entry.path) }}
              >{Icons.goToFile}</button>
              <button
                type="button"
                className="ide-git-group-action"
                title={t('git.discard')}
                onClick={(e) => { e.stopPropagation(); setDiscardError(null); setConfirmDiscard(entry) }}
              >{Icons.discard}</button>
              {staged && entry.kind !== 'conflicted' ? (
                <button
                  type="button"
                  className="ide-git-group-action"
                  title={t('git.unstage')}
                  onClick={(e) => { e.stopPropagation(); void handleUnstage(entry) }}
                >{Icons.dash}</button>
              ) : (
                <button
                  type="button"
                  className="ide-git-group-action"
                  title={t('git.stage')}
                  onClick={(e) => { e.stopPropagation(); void handleStage(entry) }}
                >{Icons.plus}</button>
              )}
            </span>
            <span className="ide-git-entry-status" data-kind={entry.kind}>
              {statusLetter(entry.kind)}
            </span>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="ide-git-panel">
      <div className="ide-git-body ide-git-panels">
        {/* 变更 panel 占据上部可滚动区域;图表/分支固定在面板底部。 */}
        <div className="ide-git-subpanel-top">
        {/* ── 源代码管理(变更)子 panel —— AI生成/刷新 按钮在本 panel header 里 ── */}
        <div className="ide-git-subpanel" data-open={openViews.changes || undefined}>
          <div className="ide-git-section-header ide-git-subpanel-header">
            <button
              type="button"
              className="ide-git-subpanel-toggle"
              aria-expanded={openViews.changes}
              title={openViews.changes ? t('git.collapse') : t('git.expand')}
              onClick={() => toggleView('changes')}
            >
              <span className="ide-git-section-chevron">{openViews.changes ? Icons.chevronDown : Icons.chevronRight}</span>
              <span className="ide-git-section-title">{t('git.title')}</span>
              {result && result.entries.length > 0 && (
                <span className="ide-git-section-count">{result.entries.length}</span>
              )}
            </button>
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
            <button
              ref={moreRef}
              className="ide-git-action"
              title={t('git.more')}
              onClick={openMoreMenu}
              disabled={status !== 'ready'}
            >{Icons.ellipsis}</button>
          </div>

          {openViews.changes && (<>
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

            <div className="ide-git-entries-wrap">
              {result.entries.length === 0 ? (
                <div className="ide-git-empty">{t('git.noChanges')}</div>
              ) : (
                <div className="ide-git-entries" data-testid="ide-git-entries">
                  {/* —— 合并更改 (Merge Changes) 分组：未合并冲突条目 —— */}
                  {(() => {
                    const mergeEntries = result.entries.filter((e) => e.kind === 'conflicted')
                    if (mergeEntries.length === 0) return null
                    return renderGroup('merge', t('git.mergeChanges'), mergeEntries)
                  })()}
                  {/* —— 已暂存的更改 (Staged Changes) 分组 —— */}
                  {(() => {
                    const staged = result.entries.filter((e) => e.kind !== 'conflicted' && isStagedEntry(e))
                    if (staged.length === 0) return null
                    return renderGroup('staged', t('git.stagedChanges'), staged)
                  })()}
                  {/* —— 更改 (Changes) 分组：工作树未暂存条目 —— */}
                  {(() => {
                    const changes = result.entries.filter((e) => e.kind !== 'conflicted' && !isStagedEntry(e))
                    if (changes.length === 0) return null
                    return renderGroup('changes', t('git.changesGroup'), changes)
                  })()}
                </div>
              )}
            </div>
          </>
        )}
          </>)}
        </div>
        </div>

        {/* ── 图表/分支 panel 固定在面板底部 ── */}
        <div className="ide-git-subpanel-bottom">
        {/* ── 图表子 panel ── */}
        <div className="ide-git-subpanel" data-open={openViews.graph || undefined}>
          <div className="ide-git-section-header ide-git-subpanel-header">
            <button
              type="button"
              className="ide-git-subpanel-toggle"
              aria-expanded={openViews.graph}
              title={openViews.graph ? t('git.collapse') : t('git.expand')}
              onClick={() => toggleView('graph')}
            >
              <span className="ide-git-section-chevron">{openViews.graph ? Icons.chevronDown : Icons.chevronRight}</span>
              <span className="ide-git-section-title">{t('git.graphTitle')}</span>
            </button>
          </div>
          {openViews.graph && (
            <GraphView
              sessionId={sessionId}
              cwd={cwd}
              ideTools={ideTools}
              onOpenCommitDiff={onOpenCommitDiff}
              onMutated={handleMutated}
              t={t}
            />
          )}
        </div>

        {/* ── 分支子 panel ── */}
        <div className="ide-git-subpanel" data-open={openViews.branches || undefined}>
          <div className="ide-git-section-header ide-git-subpanel-header">
            <button
              type="button"
              className="ide-git-subpanel-toggle"
              aria-expanded={openViews.branches}
              title={openViews.branches ? t('git.collapse') : t('git.expand')}
              onClick={() => toggleView('branches')}
            >
              <span className="ide-git-section-chevron">{openViews.branches ? Icons.chevronDown : Icons.chevronRight}</span>
              <span className="ide-git-section-title">{t('git.branchesTitle')}</span>
            </button>
          </div>
          {openViews.branches && (
            <BranchesView
              sessionId={sessionId}
              cwd={cwd}
              ideTools={ideTools}
              onMutated={handleMutated}
              t={t}
            />
          )}
        </div>
        </div>
      </div>
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

      {confirmDiscardAll && (
        <div
          className="ide-dialog-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !discarding) setConfirmDiscardAll(false) }}
        >
          <div className="ide-dialog">
            <div className="ide-dialog-title">{t('git.discardAllConfirmTitle')}</div>
            <div className="ide-dialog-body">
              {t('git.discardAllConfirmBody', { count: result?.entries.length ?? 0 })}
              <br />
              {t('git.discardConfirmWarning')}
            </div>
            {discardError !== null && <div className="ide-git-input-error">{t('git.discardFailed', { message: discardError })}</div>}
            <div className="ide-dialog-actions">
              <button
                className="ide-dialog-button ide-dialog-button-quiet"
                type="button"
                onClick={() => setConfirmDiscardAll(false)}
                disabled={discarding}
              >{t('git.cancel')}</button>
              <button
                className="ide-dialog-button"
                type="button"
                onClick={() => { void handleDiscardAll() }}
                disabled={discarding}
              >{discarding ? Icons.loading : Icons.discard}<span>{t('git.discardAll')}</span></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
