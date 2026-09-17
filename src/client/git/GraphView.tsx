/**
 * Source Control Graph — the SCM sidebar's commit graph (VS Code's
 * "Source Control Graph" view). Renders the paged history through the
 * swimlane engine (./ScmGraph.tsx), with ref pills, an in-row commit
 * details expansion (message + changed files), the toolbar's Fetch /
 * Refresh / branch-filter actions, a trailing Load More row, and the
 * commit context menu (copy SHA / message, checkout, create branch).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitCommitDetailsResult, GitLogEntry, IdeToolsRemote, SessionId } from '../types.js'
import { Icons, fileIcon } from '../icons.js'
import { showContextMenu } from '../ContextMenu.js'
import { computeGraphModels, graphCellGeometry, graphPlaceholderLanes, SWIMLANE_HEIGHT, SWIMLANE_WIDTH } from './ScmGraph.js'

export interface GraphViewProps {
  sessionId: SessionId
  cwd: string | undefined
  ideTools: IdeToolsRemote
  /** Open one file of one commit as a diff in the editor area. */
  onOpenCommitDiff: (sha: string, path: string, oldPath: string | undefined) => void
  /** Called after any history-mutating action (checkout/branch/fetch) so
   *  the parent can refresh the status-driven parts of the panel. */
  onMutated: () => void
  t: (key: string, params?: Record<string, string | number>) => string
}

type LoadState = 'loading' | 'ready' | 'error'

const PAGE_SIZE = 100

/** "3 hours ago" style age via the platform's relative time formatting. */
function relativeAge(unixSeconds: number): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const seconds = Math.max(0, Date.now() / 1000 - unixSeconds)
  if (seconds < 60) return rtf.format(-Math.round(seconds), 'second')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (days < 7) return rtf.format(-days, 'day')
  const weeks = Math.round(days / 7)
  if (days < 30) return rtf.format(-weeks, 'week')
  const months = Math.round(days / 30)
  if (days < 365) return rtf.format(-months, 'month')
  return rtf.format(-Math.round(days / 365), 'year')
}

export function GraphView({ sessionId, cwd, ideTools, onOpenCommitDiff, onMutated, t }: GraphViewProps) {
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [commits, setCommits] = useState<readonly GitLogEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [head, setHead] = useState<string | undefined>(undefined)
  const [currentBranch, setCurrentBranch] = useState<string | undefined>(undefined)
  const [upstream, setUpstream] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState<'current' | 'all'>('current')
  /** Expanded commit row (one at a time, like a selection). */
  const [expandedSha, setExpandedSha] = useState<string | undefined>(undefined)
  /** Loaded commit details, keyed by full hash. */
  const [details, setDetails] = useState<ReadonlyMap<string, GitCommitDetailsResult>>(new Map())
  const [detailsLoading, setDetailsLoading] = useState(false)
  /** Inline action error (fetch/checkout/branch failures). */
  const [actionError, setActionError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  /** Create-branch dialog: the revision it seeds from. */
  const [createBranch, setCreateBranch] = useState<{ revision: string } | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  /** Loading more (append) — distinct from the initial load spinner. */
  const loadingMoreRef = useRef(false)

  const seq = useRef(0)

  const load = useCallback(async (mode: 'reset' | 'more') => {
    if (!cwd) return
    if (mode === 'more' && loadingMoreRef.current) return
    const mySeq = ++seq.current
    if (mode === 'reset') setState('loading')
    else loadingMoreRef.current = true
    setError(null)
    try {
      const res = await ideTools.gitLog(sessionId, {
        limit: PAGE_SIZE,
        skip: mode === 'more' ? commits.length : 0,
        scope: filter,
      })
      if (mySeq !== seq.current) return
      if (!res.ok) {
        setError(res.error.message ?? res.error.code)
        setState('error')
        return
      }
      const value = res.value
      if (value.notARepo) {
        setError(t('git.notARepo'))
        setState('error')
        return
      }
      setCommits((prev) => (mode === 'more' ? [...prev, ...value.commits] : value.commits))
      setHasMore(value.hasMore)
      setHead(value.head)
      setCurrentBranch(value.currentBranch)
      setUpstream(value.upstream)
      setState('ready')
    } catch (err) {
      if (mySeq !== seq.current) return
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    } finally {
      loadingMoreRef.current = false
    }
  }, [sessionId, cwd, ideTools, filter, commits.length, t])

  // Reload on mount and whenever the branch filter changes.
  useEffect(() => {
    setCommits([])
    setExpandedSha(undefined)
    setDetails(new Map())
    void load('reset')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, cwd, filter])

  /** Refresh action: reload the visible page set. */
  const refresh = useCallback(() => {
    void load('reset')
  }, [load])

  /** Fetch remotes, then refresh the graph (new remote commits appear). */
  const handleFetch = useCallback(async () => {
    if (fetching) return
    setFetching(true)
    setActionError(null)
    try {
      const res = await ideTools.gitFetch(sessionId)
      if (res.ok) {
        refresh()
        onMutated()
      } else {
        setActionError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setFetching(false)
    }
  }, [sessionId, ideTools, fetching, refresh, onMutated])

  /** Expand/collapse one commit; loading its details on first expand. */
  const toggleExpand = useCallback(async (sha: string) => {
    setActionError(null)
    if (expandedSha === sha) { setExpandedSha(undefined); return }
    setExpandedSha(sha)
    if (details.has(sha) || detailsLoading) return
    setDetailsLoading(true)
    try {
      const res = await ideTools.gitCommitDetails(sessionId, sha)
      if (res.ok) {
        setDetails((prev) => new Map(prev).set(sha, res.value))
      } else {
        setActionError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetailsLoading(false)
    }
  }, [expandedSha, details, detailsLoading, sessionId, ideTools])

  /** Checkout a branch / remote branch / detached commit from the menu. */
  const handleCheckout = useCallback(async (spec: { ref: string; localName?: string; detach?: boolean }, label: string) => {
    setActionError(null)
    try {
      const res = await ideTools.gitCheckout(sessionId, spec)
      if (res.ok) {
        refresh()
        onMutated()
      } else {
        setActionError(label + ': ' + (res.error.message ?? res.error.code))
      }
    } catch (err) {
      setActionError(label + ': ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [sessionId, ideTools, refresh, onMutated])

  const handleCreateBranch = useCallback(async (name: string, revision: string, checkout: boolean) => {
    if (creating) return
    setCreating(true)
    setActionError(null)
    try {
      const res = await ideTools.gitCreateBranch(sessionId, name, revision, checkout)
      if (res.ok) {
        setCreateBranch(undefined)
        refresh()
        onMutated()
      } else {
        setActionError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }, [creating, sessionId, ideTools, refresh, onMutated])

  /** The commit row context menu (VS Code SCM graph parity subset). */
  const openCommitMenu = useCallback((commit: GitLogEntry, x: number, y: number) => {
    const isHead = commit.hash === head
    const items: Parameters<typeof showContextMenu>[2] = [
      { id: 'copy-sha', label: t('git.graphCopySha'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(commit.hash) } },
      { id: 'copy-subject', label: t('git.graphCopySubject'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(commit.subject) } },
      { id: 'sep1', label: '', separator: true },
      {
        id: 'branch',
        label: t('git.graphCreateBranch'),
        icon: Icons.branch,
        onClick: () => setCreateBranch({ revision: commit.hash }),
      },
      {
        id: 'checkout-detached',
        label: t('git.graphCheckoutDetached'),
        icon: Icons.commit,
        disabled: isHead,
        onClick: () => { void handleCheckout({ ref: commit.hash, detach: true }, commit.displayId) },
      },
    ]
    // One checkout item per decorated branch (local + remote, skipping the
    // current one), like the ref pills' VS Code context actions.
    for (const ref of commit.refs) {
      if (ref.type === 'tag') continue
      if (ref.current && ref.type === 'head') continue
      const isRemote = ref.type === 'remote'
      const localName = isRemote ? ref.name.replace(/^[^/]+\//, '') : undefined
      items.push({
        id: 'checkout-' + ref.name,
        label: (isRemote ? t('git.graphCheckoutRemote') : t('git.graphCheckoutBranch')) + ' ' + ref.name,
        icon: Icons.branch,
        disabled: isRemote && (localName === undefined || localName.length === 0 || currentBranch === localName),
        onClick: () => { void handleCheckout(isRemote ? { ref: ref.name, localName } : { ref: ref.name }, ref.name) },
      })
    }
    showContextMenu(x, y, items)
  }, [head, t, handleCheckout, currentBranch])

  // Swimlane view models for the loaded page (memoized per commit set).
  const viewModels = useMemo(
    () => computeGraphModels(commits, head, currentBranch, upstream),
    [commits, head, currentBranch, upstream],
  )
  const placeholderLanes = useMemo(
    () => graphPlaceholderLanes(viewModels[viewModels.length - 1]),
    [viewModels],
  )
  const expandedDetails = expandedSha !== undefined ? details.get(expandedSha) : undefined

  return (
    <div className="ide-git-graph">
      <div className="ide-git-graph-toolbar">
        <div className="ide-git-graph-filter" role="tablist">
          <button
            className="ide-git-graph-filter-btn"
            data-active={filter === 'current' || undefined}
            onClick={() => setFilter('current')}
          >{t('git.graphFilterCurrent')}</button>
          <button
            className="ide-git-graph-filter-btn"
            data-active={filter === 'all' || undefined}
            onClick={() => setFilter('all')}
          >{t('git.graphFilterAll')}</button>
        </div>
        <button
          className="ide-git-action"
          title={t('git.fetch')}
          onClick={() => { void handleFetch() }}
          disabled={fetching}
        >{fetching ? Icons.loading : Icons.cloudDownload}</button>
        <button
          className="ide-git-action"
          title={t('git.refresh')}
          onClick={refresh}
          disabled={state === 'loading'}
        >{state === 'loading' ? Icons.loading : Icons.refresh}</button>
      </div>

      {actionError && <div className="ide-git-input-error">{actionError}</div>}

      {state === 'loading' && (
        <div className="ide-git-state">{Icons.loading}<span>{t('git.loading')}</span></div>
      )}

      {state === 'error' && (
        <div className="ide-git-state ide-git-error">{Icons.git}<span>{t('git.graphFailed', { message: error ?? '' })}</span></div>
      )}

      {state === 'ready' && commits.length === 0 && (
        <div className="ide-git-state">{Icons.commit}<span>{t('git.graphNoCommits')}</span></div>
      )}

      {state === 'ready' && commits.length > 0 && (
        <div className="ide-git-graph-list">
          {viewModels.map((vm) => {
            const commit = vm.commit
            const expanded = expandedSha === commit.hash
            const isHead = commit.hash === head
            const lane = graphCellGeometry(vm)
            return (
              <div key={commit.hash} className="ide-git-graph-row" data-expanded={expanded || undefined} data-head={isHead || undefined}>
                <div
                  className="ide-git-graph-item"
                  onClick={() => { void toggleExpand(commit.hash) }}
                  onContextMenu={(e) => { e.preventDefault(); openCommitMenu(commit, e.clientX, e.clientY) }}
                >
                  <svg
                    className="ide-git-graph-cell"
                    width={lane.width}
                    height={SWIMLANE_HEIGHT}
                    viewBox={'0 0 ' + lane.width + ' ' + SWIMLANE_HEIGHT}
                    aria-hidden="true"
                  >
                    {lane.paths.map((p, i) => (
                      <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={p.width ?? 1} strokeLinecap="round" />
                    ))}
                    {lane.circles.map((c, i) => (
                      <circle
                        key={i}
                        cx={c.cx}
                        cy={c.cy}
                        r={c.r}
                        fill={c.fill ?? 'none'}
                        stroke={c.stroke}
                        strokeWidth={c.strokeWidth}
                        strokeDasharray={c.dashed === true ? '4,2' : undefined}
                      />
                    ))}
                  </svg>
                  <div className="ide-git-graph-main">
                    <div className="ide-git-graph-subject-row">
                      <span className="ide-git-graph-subject">{commit.subject}</span>
                      {vm.refPills.map((pill) => (
                        <span
                          key={pill.ref.name}
                          className="ide-git-graph-pill"
                          data-type={pill.ref.type}
                          data-current={pill.ref.current || undefined}
                          style={pill.color !== undefined ? { background: pill.color, borderColor: pill.color } : undefined}
                          title={pill.ref.name}
                        >{pill.ref.type === 'tag' ? Icons.tag : Icons.branch}{pill.ref.name}</span>
                      ))}
                    </div>
                    <div className="ide-git-graph-meta">
                      <span className="ide-git-graph-author">{commit.author}</span>
                      <span className="ide-git-graph-dot">·</span>
                      <span className="ide-git-graph-age" title={new Date(commit.authorDate * 1000).toLocaleString()}>{relativeAge(commit.authorDate)}</span>
                      {isHead && <span className="ide-git-graph-head">{t('git.graphHead')}</span>}
                    </div>
                  </div>
                </div>

                {expanded && (
                  <div className="ide-git-graph-details">
                    {detailsLoading && expandedDetails === undefined ? (
                      <div className="ide-git-graph-details-loading">{Icons.loading}<span>{t('git.loading')}</span></div>
                    ) : expandedDetails !== undefined ? (
                      <>
                        <div className="ide-git-graph-details-msg">{expandedDetails.message}</div>
                        <div className="ide-git-graph-details-meta">
                          {expandedDetails.displayId} · {expandedDetails.author} · {new Date(expandedDetails.authorDate * 1000).toLocaleString()}
                        </div>
                        <div className="ide-git-graph-details-files">
                          {expandedDetails.files.length === 0 ? (
                            <div className="ide-git-empty">{t('git.graphNoFiles')}</div>
                          ) : expandedDetails.files.map((file) => {
                            const segs = file.path.split('/')
                            const name = segs[segs.length - 1] || file.path
                            const dir = segs.length > 1 ? segs.slice(0, -1).join('/') : ''
                            return (
                              <div
                                key={file.path}
                                className="ide-git-graph-file"
                                title={file.oldPath !== undefined ? file.oldPath + ' → ' + file.path : file.path}
                                onClick={() => onOpenCommitDiff(commit.hash, file.path, file.oldPath)}
                              >
                                <span className="ide-git-entry-icon">{fileIcon(name, false)}</span>
                                <span className="ide-git-graph-file-name">{name}</span>
                                {dir && <span className="ide-git-entry-dir">{dir}</span>}
                                {file.additions !== undefined && file.additions > 0 && <span className="ide-git-graph-adds">+{file.additions}</span>}
                                {file.deletions !== undefined && file.deletions > 0 && <span className="ide-git-graph-dels">-{file.deletions}</span>}
                                <span className="ide-git-entry-status" data-kind={file.kind}>{file.kind === 'binary' ? 'B' : file.kind === 'renamed' ? 'R' : file.kind === 'added' ? 'A' : file.kind === 'deleted' ? 'D' : 'M'}</span>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="ide-git-graph-details-loading">{t('git.diffError', { message: '' })}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {hasMore && (
            <button
              className="ide-git-graph-more"
              onClick={() => { void load('more') }}
              title={t('git.graphLoadMore')}
            >
              <svg
                width={SWIMLANE_WIDTH * (placeholderLanes.length + 1)}
                height={SWIMLANE_HEIGHT}
                viewBox={'0 0 ' + SWIMLANE_WIDTH * (placeholderLanes.length + 1) + ' ' + SWIMLANE_HEIGHT}
                aria-hidden="true"
              >
                {placeholderLanes.map((lane, i) => (
                  <path key={i} d={'M ' + lane.x + ' 0 V ' + SWIMLANE_HEIGHT} fill="none" stroke={lane.color} strokeWidth={1} />
                ))}
              </svg>
              <span>{Icons.sync}{t('git.graphLoadMore')}</span>
            </button>
          )}
        </div>
      )}

      {/* Create branch dialog (graph context menu → 基于此提交创建分支). */}
      {createBranch !== undefined && (
        <CreateBranchDialog
          defaultRevision={createBranch.revision}
          busy={creating}
          t={t}
          onCancel={() => setCreateBranch(undefined)}
          onCreate={(name, checkout) => { void handleCreateBranch(name, createBranch.revision, checkout) }}
        />
      )}
    </div>
  )
}

/** VS Code's Create Branch quick input, as a small dialog. */
function CreateBranchDialog({ defaultRevision, busy, t, onCancel, onCreate }: {
  defaultRevision: string
  busy: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  onCancel: () => void
  onCreate: (name: string, checkout: boolean) => void
}) {
  const [name, setName] = useState('')
  const [checkout, setCheckout] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const submit = (): void => {
    const trimmed = name.trim()
    if (trimmed.length === 0 || busy) return
    onCreate(trimmed, checkout)
  }
  return (
    <div className="ide-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}>
      <div className="ide-dialog">
        <div className="ide-dialog-title">{t('git.graphCreateBranch')}</div>
        <div className="ide-dialog-body">
          <input
            ref={inputRef}
            className="ide-git-branch-input"
            placeholder={t('git.graphBranchName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit() }
              if (e.key === 'Escape') { e.preventDefault(); onCancel() }
            }}
            disabled={busy}
          />
          <div className="ide-git-graph-details-meta">{t('git.graphBranchFrom', { sha: defaultRevision.slice(0, 8) })}</div>
          <label className="ide-git-branch-check">
            <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} disabled={busy} />
            <span>{t('git.graphBranchCheckout')}</span>
          </label>
        </div>
        <div className="ide-dialog-actions">
          <button className="ide-dialog-button ide-dialog-button-quiet" type="button" onClick={onCancel} disabled={busy}>{t('git.cancel')}</button>
          <button className="ide-dialog-button" type="button" onClick={submit} disabled={busy || name.trim().length === 0}>
            {busy ? Icons.loading : Icons.branch}<span>{t('git.graphCreateBranch')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
