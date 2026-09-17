/**
 * Branches view — the SCM sidebar's branch list (GitLens-style tree with VS
 * Code's checkout/delete/copy actions): the current branch row with its
 * upstream tracking info, collapsible 本地分支 / 远程分支 sections, and the
 * toolbar's New Branch / Fetch / Refresh actions. Remote branches check out
 * through a created local tracking branch (git checkout -b), never deleted
 * from here.
 */
import { useCallback, useEffect, useState } from 'react'
import type { GitBranch, IdeToolsRemote, SessionId } from '../types.js'
import { Icons } from '../icons.js'
import { showContextMenu } from '../ContextMenu.js'

export interface BranchesViewProps {
  sessionId: SessionId
  cwd: string | undefined
  ideTools: IdeToolsRemote
  /** Called after any history-mutating action (checkout/branch/fetch) so
   *  the parent can refresh the status-driven parts of the panel. */
  onMutated: () => void
  t: (key: string, params?: Record<string, string | number>) => string
}

type LoadState = 'loading' | 'ready' | 'error'

export function BranchesView({ sessionId, cwd, ideTools, onMutated, t }: BranchesViewProps) {
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [branches, setBranches] = useState<readonly GitBranch[]>([])
  const [remoteBranches, setRemoteBranches] = useState<readonly { name: string; lastCommit?: string; lastCommitDate?: string }[]>([])
  const [remotes, setRemotes] = useState<readonly string[]>([])
  const [current, setCurrent] = useState<string | undefined>(undefined)
  const [openSections, setOpenSections] = useState<{ local: boolean; remote: boolean }>({ local: true, remote: true })
  /** Inline action error (checkout/delete/fetch/branch failures). */
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState(false)
  /** Confirm dialog state for a branch deletion. */
  const [confirmDelete, setConfirmDelete] = useState<{ name: string; force: boolean } | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  /** Create-branch dialog. */
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCheckout, setNewCheckout] = useState(true)

  const load = useCallback(async () => {
    if (!cwd) return
    setState('loading')
    setError(null)
    try {
      const res = await ideTools.gitBranches(sessionId)
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
      setBranches(value.branches)
      setRemoteBranches(value.remoteBranches ?? [])
      setRemotes(value.remotes ?? [])
      setCurrent(value.current)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }, [sessionId, cwd, ideTools, t])

  useEffect(() => {
    void load()
  }, [load])

  /** Wrap a mutating action with the busy/error bookkeeping. */
  const runAction = useCallback(async (label: string, action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      await action()
      await load()
      onMutated()
    } catch (err) {
      setActionError(label + ': ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }, [busy, load, onMutated])

  const handleCheckout = useCallback((spec: { ref: string; localName?: string }, label: string) => {
    void runAction(label, async () => {
      const res = await ideTools.gitCheckout(sessionId, spec)
      if (!res.ok) throw new Error(res.error.message ?? res.error.code)
    })
  }, [runAction, ideTools, sessionId])

  const handleFetch = useCallback(async () => {
    if (fetching) return
    setFetching(true)
    setActionError(null)
    try {
      const res = await ideTools.gitFetch(sessionId)
      if (res.ok) {
        await load()
        onMutated()
      } else {
        setActionError(res.error.message ?? res.error.code)
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setFetching(false)
    }
  }, [fetching, sessionId, ideTools, load, onMutated])

  const handleCreate = useCallback(() => {
    const name = newName.trim()
    if (name.length === 0 || creating) return
    void runAction(name, async () => {
      const res = await ideTools.gitCreateBranch(sessionId, name, undefined, newCheckout)
      if (!res.ok) throw new Error(res.error.message ?? res.error.code)
      setCreating(false)
      setNewName('')
    })
  }, [newName, newCheckout, creating, runAction, ideTools, sessionId])

  const handleDelete = useCallback((name: string, force: boolean) => {
    void runAction(name, async () => {
      const res = await ideTools.gitDeleteBranch(sessionId, name, force)
      if (!res.ok) throw new Error(res.error.message ?? res.error.code)
      setConfirmDelete(undefined)
    })
  }, [runAction, ideTools, sessionId])

  const openBranchMenu = useCallback((branch: GitBranch, x: number, y: number) => {
    const isCurrent = branch.current
    showContextMenu(x, y, [
      {
        id: 'checkout',
        label: t('git.branchCheckout'),
        icon: Icons.branch,
        disabled: isCurrent,
        onClick: () => handleCheckout({ ref: branch.name }, branch.name),
      },
      { id: 'sep1', label: '', separator: true },
      {
        id: 'delete',
        label: t('git.branchDelete'),
        icon: Icons.trash,
        disabled: isCurrent,
        onClick: () => setConfirmDelete({ name: branch.name, force: false }),
      },
      {
        id: 'delete-force',
        label: t('git.branchDeleteForce'),
        icon: Icons.trash,
        disabled: isCurrent,
        onClick: () => setConfirmDelete({ name: branch.name, force: true }),
      },
      { id: 'sep2', label: '', separator: true },
      {
        id: 'copy-name',
        label: t('git.branchCopyName'),
        icon: Icons.copy,
        onClick: () => { void navigator.clipboard.writeText(branch.name) },
      },
    ])
  }, [t, handleCheckout])

  const openRemoteMenu = useCallback((name: string, x: number, y: number) => {
    // origin/feature → local 'feature' (git checkout -b feature origin/feature)
    const localName = name.replace(/^[^/]+\//, '')
    showContextMenu(x, y, [
      {
        id: 'checkout-local',
        label: t('git.branchCheckoutLocal'),
        icon: Icons.branch,
        disabled: localName.length === 0 || current === localName,
        onClick: () => handleCheckout({ ref: name, localName }, name),
      },
      { id: 'sep', label: '', separator: true },
      {
        id: 'copy-name',
        label: t('git.branchCopyName'),
        icon: Icons.copy,
        onClick: () => { void navigator.clipboard.writeText(name) },
      },
    ])
  }, [t, current, handleCheckout])

  /** ahead/behind summary for a branch row. */
  const ab = (branch: GitBranch): string | undefined => {
    if (branch.ahead === undefined && branch.behind === undefined) return undefined
    if ((branch.ahead ?? 0) === 0 && (branch.behind ?? 0) === 0) return undefined
    return '↑' + (branch.ahead ?? 0) + ' ↓' + (branch.behind ?? 0)
  }

  const branchRow = (branch: GitBranch) => {
    const abText = ab(branch)
    return (
      <div
        key={branch.name}
        className="ide-git-branch-row"
        data-current={branch.current || undefined}
        onClick={() => { if (!branch.current) handleCheckout({ ref: branch.name }, branch.name) }}
        onContextMenu={(e) => { e.preventDefault(); openBranchMenu(branch, e.clientX, e.clientY) }}
      >
        <span className="ide-git-branch-row-icon">{branch.current ? Icons.check : Icons.branch}</span>
        <span className="ide-git-branch-row-name">{branch.name}</span>
        {abText && <span className="ide-git-branch-row-ab">{abText}</span>}
        {branch.current && <span className="ide-git-branch-row-current">{t('git.currentBranch')}</span>}
      </div>
    )
  }

  const remoteRow = (name: string, lastCommit?: string) => {
    const segs = name.split('/')
    const remote = segs[0]
    const short = segs.slice(1).join('/') || name
    return (
      <div
        key={name}
        className="ide-git-branch-row"
        data-remote={true}
        data-current={current === name || undefined}
        onClick={() => handleCheckout({ ref: name, localName: short }, name)}
        onContextMenu={(e) => { e.preventDefault(); openRemoteMenu(name, e.clientX, e.clientY) }}
      >
        <span className="ide-git-branch-row-icon">{Icons.cloudDownload}</span>
        <span className="ide-git-branch-row-remote">{remote}</span>
        <span className="ide-git-branch-row-name">{short}</span>
        {lastCommit && <span className="ide-git-branch-row-sha">{lastCommit.slice(0, 7)}</span>}
      </div>
    )
  }

  return (
    <div className="ide-git-branches">
      <div className="ide-git-branches-toolbar">
        <button
          className="ide-git-branches-new"
          onClick={() => { setCreating(true); setNewName('') }}
          disabled={state !== 'ready'}
        >{Icons.plus}<span>{t('git.branchNew')}</span></button>
        <button
          className="ide-git-action"
          title={t('git.fetch')}
          onClick={() => { void handleFetch() }}
          disabled={fetching || state !== 'ready'}
        >{fetching ? Icons.loading : Icons.cloudDownload}</button>
        <button
          className="ide-git-action"
          title={t('git.refresh')}
          onClick={() => { void load() }}
          disabled={state === 'loading'}
        >{state === 'loading' ? Icons.loading : Icons.refresh}</button>
      </div>

      {actionError && <div className="ide-git-input-error">{actionError}</div>}

      {state === 'loading' && (
        <div className="ide-git-state">{Icons.loading}<span>{t('git.loading')}</span></div>
      )}
      {state === 'error' && (
        <div className="ide-git-state ide-git-error">{Icons.git}<span>{error}</span></div>
      )}

      {state === 'ready' && (
        <>
          {/* Current branch summary (VS Code's SCM branch row). */}
          <div className="ide-git-branch-current">
            <span className="ide-git-branch-current-icon">{Icons.branch}</span>
            <span className="ide-git-branch-current-name">{current ?? t('git.detached')}</span>
          </div>

          <div className="ide-git-section">
            <div
              className="ide-git-section-header"
              onClick={() => setOpenSections((s) => ({ ...s, local: !s.local }))}
            >
              <span className="ide-git-section-chevron">{openSections.local ? Icons.chevronDown : Icons.chevronRight}</span>
              <span className="ide-git-section-title">{t('git.branchesLocal')}</span>
              <span className="ide-git-section-count">{branches.length}</span>
            </div>
            {openSections.local && branches.map(branchRow)}
            {openSections.local && branches.length === 0 && (
              <div className="ide-git-empty">{t('git.branchesEmpty')}</div>
            )}
          </div>

          <div className="ide-git-section">
            <div
              className="ide-git-section-header"
              onClick={() => setOpenSections((s) => ({ ...s, remote: !s.remote }))}
            >
              <span className="ide-git-section-chevron">{openSections.remote ? Icons.chevronDown : Icons.chevronRight}</span>
              <span className="ide-git-section-title">{t('git.branchesRemote')}</span>
              <span className="ide-git-section-count">{remoteBranches.length}</span>
            </div>
            {openSections.remote && remoteBranches.map((b) => remoteRow(b.name, b.lastCommit))}
            {openSections.remote && remoteBranches.length === 0 && (
              <div className="ide-git-empty">{t('git.branchesRemoteEmpty', { count: remotes.length })}</div>
            )}
          </div>
        </>
      )}

      {/* Create branch dialog. */}
      {creating && (
        <div className="ide-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setCreating(false) }}>
          <div className="ide-dialog">
            <div className="ide-dialog-title">{t('git.branchNew')}</div>
            <div className="ide-dialog-body">
              <input
                className="ide-git-branch-input"
                autoFocus
                placeholder={t('git.graphBranchName')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleCreate() }
                  if (e.key === 'Escape') { e.preventDefault(); setCreating(false) }
                }}
                disabled={busy}
              />
              <label className="ide-git-branch-check">
                <input type="checkbox" checked={newCheckout} onChange={(e) => setNewCheckout(e.target.checked)} disabled={busy} />
                <span>{t('git.graphBranchCheckout')}</span>
              </label>
            </div>
            <div className="ide-dialog-actions">
              <button className="ide-dialog-button ide-dialog-button-quiet" type="button" onClick={() => setCreating(false)} disabled={busy}>{t('git.cancel')}</button>
              <button className="ide-dialog-button" type="button" onClick={handleCreate} disabled={busy || newName.trim().length === 0}>
                {busy ? Icons.loading : Icons.branch}<span>{t('git.branchCreate')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation (VS Code asks before deleting a branch). */}
      {confirmDelete !== undefined && (
        <div className="ide-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !deleting) setConfirmDelete(undefined) }}>
          <div className="ide-dialog">
            <div className="ide-dialog-title">{t('git.branchDeleteConfirmTitle')}</div>
            <div className="ide-dialog-body">
              {confirmDelete.force
                ? t('git.branchDeleteForceBody', { name: confirmDelete.name })
                : t('git.branchDeleteBody', { name: confirmDelete.name })}
              <br />
              {t('git.discardConfirmWarning')}
            </div>
            {deleting && <div className="ide-git-graph-details-loading">{Icons.loading}</div>}
            <div className="ide-dialog-actions">
              <button className="ide-dialog-button ide-dialog-button-quiet" type="button" onClick={() => setConfirmDelete(undefined)} disabled={deleting}>{t('git.cancel')}</button>
              <button className="ide-dialog-button" type="button" onClick={() => handleDelete(confirmDelete.name, confirmDelete.force)} disabled={deleting}>
                {deleting ? Icons.loading : Icons.trash}<span>{t('git.branchDelete')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
