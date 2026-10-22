/**
 * Monaco diff editor view for one git-tracked path. Mounts a Monaco
 * DiffEditor inside the editor container (the same singleton host the normal
 * editor uses), showing the old (HEAD) content on the left and the new
 * (working tree / index) content on the right.
 *
 * The diff editor is created lazily and disposed when the path changes or the
 * view unmounts. It shares the Monaco namespace + theme already loaded by the
 * IdeView's loadMonaco() path.
 */
import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import type { GitDiffResult, IdeToolsRemote, SessionId, WorkspaceFilesRemote, WorkspaceFilesWriteRemote, WorkspaceFileWriteIntent } from '../types.js'
import { Icons } from '../icons.js'
import { defineDarkModernTheme } from '../theme.js'
import { installMonacoWorker } from '../monacoWorkerBootstrap.js'

export interface DiffEditorProps {
  sessionId: SessionId
  cwd: string | undefined
  ideTools: IdeToolsRemote
  /** Workspace-files Remote, used to read the working-tree side directly. */
  workspaceFiles: WorkspaceFilesRemote
  /** Bounded-write Remote; set to make the working-tree (right) side
   *  editable and savable — VS Code's editable SCM diff pane. */
  workspaceFilesWrite?: WorkspaceFilesWriteRemote
  /** Path to diff (workspace-relative). */
  path: string
  /** Display basename for the tab title. */
  name: string
  /** Commit mode: show one file INSIDE a specific commit (source control
   *  graph → commit details). Both sides come from the git host; the working
   *  tree is never consulted. */
  commit?: { sha: string; path: string; oldPath?: string }
  /** Return to the normal editor (clears the diff overlay). */
  onClose?: () => void
  /** The right side was saved through the write Remote: the owner reopens the
   *  matching normal tab (sync its model + saved baseline) and refreshes git. */
  onSaved?: (path: string) => void
  /** The diffed file changed outside this view and the diff was refreshed
   *  in place — the owner refreshes git state (badge / changes list). */
  onExternalChange?: () => void
  t: (key: string, params?: Record<string, string | number>) => string
}

type LoadState = 'loading' | 'ready' | 'empty' | 'error' | 'image' | 'binary'

let monacoLoaded = false

function ensureMonaco(m: typeof Monaco): void {
  if (monacoLoaded) return
  defineDarkModernTheme(m)
  // Install the REAL editor worker (blob-URL instantiation of the embedded
  // worker bundle). The diff editor computes its changes in the
  // EditorWorkerService worker — with the previous no-op worker the diff never
  // completed, leaving both panes unhighlighted. Idempotent; the IdeView may
  // have installed it already.
  installMonacoWorker()
  monacoLoaded = true
}

/** Decode a workspace-files byte payload (Uint8Array) to a UTF-8 string. */
function decodeBytesUtf8(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data)
}

/**
 * Apply a unified diff (git's `diff` text) to the original text, returning the
 * modified text. Used as a last-resort right side: if the working-tree read did
 * not yield different bytes, rebuilding from git's own HEAD→worktree diff still
 * produces a real, highlighted diff.
 */
function applyUnifiedDiff(original: string, patch: string): string {
  const src = original.length === 0 ? [] : original.split('\n')
  const out: string[] = []
  const lines = patch.split('\n')
  let cursor = 0
  let i = 0
  while (i < lines.length) {
    const head = lines[i]
    if (!head.startsWith('@@')) { i++; continue }
    const m = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(head)
    if (!m) { i++; continue }
    const oldStart = Math.max(0, parseInt(m[1], 10) - 1)
    while (cursor < oldStart && cursor < src.length) out.push(src[cursor++])
    i++
    while (i < lines.length && !lines[i].startsWith('@@')) {
      const body = lines[i]
      if (body.length === 0) break
      const tag = body[0]
      if (tag === '\\') { i++; continue } // " No newline at end of file"
      const text = body.slice(1)
      if (tag === ' ') { out.push(text); cursor++ }
      else if (tag === '-') { cursor++ }
      else if (tag === '+') { out.push(text) }
      else break
      i++
    }
  }
  while (cursor < src.length) out.push(src[cursor++])
  return out.join('\n')
}

export function DiffEditor({ sessionId, cwd, ideTools, workspaceFiles, workspaceFilesWrite, path, name, commit, onClose, onSaved, onExternalChange, t }: DiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Monaco.editor.IDiffEditor | null>(null)
  /** Whether the one-time auto-jump to the first diff hunk has run for the
   *  current mount. The external-change watch reloads models in place and
   *  re-runs the diff; jumping on every update would fight the user's scroll,
   *  so the jump fires once per mount (reset when the editor is rebuilt). */
  const jumpedRef = useRef(false)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [imageSrc, setImageSrc] = useState<string>('')
  /** The host's one-line binary marker (commit mode) shown in the overlay. */
  const [binaryLabel, setBinaryLabel] = useState<string | null>(null)
  /** Line counts of the two sides; shown in the header (also a build marker). */
  const [stats, setStats] = useState<{ old: number; new: number; source: string } | null>(null)
  /** Editable working-tree mode (VS Code's editable SCM diff pane): the right
   *  side carries unsaved edits. Tracked as state (button) AND ref (poll). */
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  /** Saving lifecycle for the header button. */
  const [savePhase, setSavePhase] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  /** The worktree file's version at load time — the save's replaceIfVersion guard. */
  const versionRef = useRef<string | undefined>(undefined)
  /** Whether the right side holds the COMPLETE worktree file (a truncated
   *  page must never be saved back). */
  const completeRef = useRef(false)
  /** The editable modified model, for the save command + change listener. */
  const modifiedRef = useRef<Monaco.editor.ITextModel | null>(null)
  /** Bumped to re-run the load effect (external change reload / post-error reload). */
  const [reloadNonce, setReloadNonce] = useState(0)
  /** True while the polled file is known-absent on disk (deletion diff shown;
   *  polling pauses so a vanished file causes no repeated refresh churn). */
  const absentRef = useRef(false)
  /** Quiet in-place refresh of both sides (re-fetch + setValue). Set inside
   *  the load effect; used by the external-change poll and the manual reload. */
  const reloadRef = useRef<() => Promise<void>>(async () => {})
  /** Suppresses the dirty listener while a quiet refresh writes model content. */
  const applyingRef = useRef(false)

  // Destructure `commit` to primitives for the deps array: IdeView creates a
  // fresh object per render, and an object dep would remount the editor on
  // every parent render (aborting the in-flight load mid-swap).
  const commitSha = commit?.sha
  const commitPath = commit?.path
  const commitOldPath = commit?.oldPath
  const editable = workspaceFilesWrite !== undefined && commitSha === undefined

  /** Write the edited right side back with a version guard (Ctrl/Cmd+S or the
   *  header button). On a stale version the write is refused — the user
   *  reloads the diff to pick up the external change first. */
  const saveEdits = useRef<() => Promise<void>>(async () => {})
  saveEdits.current = async () => {
    if (!editable || !workspaceFilesWrite || commitSha !== undefined) return
    const model = modifiedRef.current
    if (!model || !dirtyRef.current || !completeRef.current) return
    setSavePhase('saving')
    setSaveError(null)
    const content = model.getValue()
    const intent: WorkspaceFileWriteIntent | undefined = versionRef.current !== undefined
      ? { kind: 'replaceIfVersion', version: versionRef.current }
      : undefined
    const res = await workspaceFilesWrite.write(sessionId, path, content, intent)
    if (!res.ok) {
      setSavePhase('error')
      setSaveError(res.error.code === 'workspace-file-write/stale-version'
        ? t('diff.staleError')
        : t('diff.saveError', { message: res.error.message ?? res.error.code }))
      return
    }
    versionRef.current = res.value.version
    dirtyRef.current = false
    setDirty(false)
    setSavePhase('idle')
    // Let the owner sync the matching normal tab (model + saved baseline) and
    // refresh git state — the save just changed the worktree.
    onSaved?.(path)
  }

  // Load the diff and mount the diff editor when the path changes.
  useEffect(() => {
    let cancelled = false
    let editor: Monaco.editor.IStandaloneDiffEditor | null = null
    // Models are global to Monaco and are NOT disposed by editor.dispose(), so
    // this run must own and release exactly the pair it creates below.
    let models: Monaco.editor.ITextModel[] = []
    const ctrl = new AbortController()

    async function run(): Promise<void> {
      if (!cwd) { setState('error'); setError('no cwd'); return }
      setState('loading')
      setError(null)
      setImageSrc('')
      setBinaryLabel(null)
      setStats(null)
      // Reset the per-load editing state.
      dirtyRef.current = false
      setDirty(false)
      setSavePhase('idle')
      setSaveError(null)
      versionRef.current = undefined
      completeRef.current = false
      modifiedRef.current = null
      absentRef.current = false

      // Commit mode (source control graph → commit details → file): BOTH
      // sides come from the commit's blobs via the git host — the working
      // tree is never consulted, so the diff shows the commit's change.
      if (commitSha !== undefined && commitPath !== undefined) {
        const res = await ideTools.gitCommitFileDiff(sessionId, commitSha, commitPath, commitOldPath, ctrl.signal)
        if (cancelled) return
        if (!res.ok) { setState('error'); setError(res.error.message ?? res.error.code); return }
        const diff: GitDiffResult = res.value
        if (diff.empty) { setState('empty'); return }
        // Binary blobs cannot cross the text subprocess seam: the host flags
        // them and puts a one-line marker in newContent — show that instead
        // of mounting a diff editor over garbage bytes.
        if (diff.contentType === 'binary') {
          setBinaryLabel(diff.newContent)
          setStats({ old: 1, new: 1, source: 'binary' })
          setState('binary')
          return
        }
        // A missing blob side or an empty patch pair still yields identical
        // content here — surface it rather than an empty highlighted pane.
        if (diff.oldContent === diff.newContent) { setState('empty'); return }
        await mountDiffEditor(diff.oldContent, diff.newContent, diff.language, 'commit')
        return
      }

      // 'head' makes the host's `diff` text a HEAD→worktree patch, which the
      // fallback below can apply to the left side.
      const res = await ideTools.gitDiff(sessionId, path, 'head', ctrl.signal)
      if (cancelled) return
      if (!res.ok) { setState('error'); setError(res.error.message ?? res.error.code); return }
      const diff: GitDiffResult = res.value
      if (diff.empty) { setState('empty'); return }
      // Image files: render as <img>, not Monaco.
      if (diff.contentType === 'image' && diff.imageBase64) {
        setImageSrc(diff.imageBase64)
        setState('image')
        return
      }
      // Right-hand side: read the WORKING-TREE file directly. An older host
      // build returned the index blob here, which equals HEAD for an unstaged
      // edit and rendered two identical sides with nothing highlighted. A
      // missing file means the change is a deletion, so the right side is empty.
      let newText = diff.newContent
      let source = 'host'
      const fileRes = await workspaceFiles.readBytes(sessionId, path, {}, ctrl.signal)
      if (cancelled) return
      if (fileRes.ok) {
        newText = decodeBytesUtf8(fileRes.value.data)
        source = 'disk'
        // Editability guard: only a COMPLETE right side may be saved back —
        // a truncated page would lose the tail on write.
        completeRef.current = fileRes.value.eof === true
        versionRef.current = fileRes.value.version
      } else if (fileRes.error.code === 'workspace-file/not-found') { newText = ''; source = 'disk' }
      else {
        // Full-file read refused (e.g. over the byte cap): fall back to a text page.
        const pageRes = await workspaceFiles.read(sessionId, path, { limit: 1_000_000 }, ctrl.signal)
        if (cancelled) return
        if (pageRes.ok) { newText = pageRes.value.text; source = 'disk' }
      }
      // Last resort: rebuild the right side from git's own HEAD→worktree patch.
      // Keeps the diff correct even when the file read returned the committed
      // bytes, or the host is an older build that sent the index blob.
      if (diff.oldContent === newText && diff.diff.trim().length > 0) {
        const applied = applyUnifiedDiff(diff.oldContent, diff.diff)
        if (applied !== diff.oldContent) { newText = applied; source = 'patch' }
      }
      // Still identical while git reports changes: two identical panes are
      // misleading, so surface the failure instead of pretending "no diff".
      if (diff.oldContent === newText) {
        setState('error')
        setError('left and right are identical (source: ' + source + ', read: ' + (fileRes.ok ? 'ok' : fileRes.error.code) + ')')
        return
      }
      await mountDiffEditor(diff.oldContent, newText, diff.language, source)
    }

    /** Mount the Monaco diff editor over the two prepared contents (shared by
     *  both the working-tree and the commit diff paths). */
    async function mountDiffEditor(oldText: string, newText: string, language: string, source: string): Promise<void> {
      // Import Monaco (bundled with the client chunk).
      const Monaco = await import('monaco-editor')
      if (cancelled) return
      ensureMonaco(Monaco as unknown as typeof Monaco)
      const container = containerRef.current
      if (!container) return
      // Dispose any prior editor on this host.
      editorRef.current?.dispose()
      editorRef.current = null
      // Both URIs are stable per path (only the path keys the diff identity), and
      // a leaked model with the same URI makes createModel throw. Clear both
      // first so re-opening the same file after a remount still works.
      // In commit mode the URI is keyed by sha too, so two commits' versions of
      // one file never collide.
      const uriKey = commitSha !== undefined ? commitSha + ':' + commitPath : path
      const oldUri = Monaco.Uri.parse('dsh-git-diff-old:' + uriKey)
      const newUri = Monaco.Uri.parse('dsh-git-diff-new:' + uriKey)
      Monaco.editor.getModel(oldUri)?.dispose()
      Monaco.editor.getModel(newUri)?.dispose()
      const oldModel = Monaco.editor.createModel(oldText, language, oldUri)
      const newModel = Monaco.editor.createModel(newText, language, newUri)
      models = [oldModel, newModel]
      // Editable working-tree pane (VS Code parity): the modified side takes
      // typing; the original (HEAD) side stays read-only. Commit diffs and
      // truncated reads remain fully read-only — history and partial pages
      // must never be written back.
      const canEdit = editable && completeRef.current && source === 'disk'
      modifiedRef.current = canEdit ? newModel : null
      const onDirty = () => {
        if (!canEdit || applyingRef.current) return
        if (!dirtyRef.current) { dirtyRef.current = true; setDirty(true) }
      }
      if (canEdit) {
        newModel.onDidChangeContent(onDirty)
      }
      editor = Monaco.editor.createDiffEditor(container, {
        theme: 'dsh-dark-modern',
        readOnly: !canEdit,
        automaticLayout: true,
        fontSize: 13,
        lineHeight: 20,
        scrollBeyondLastLine: false,
        fontFamily: 'var(--ds-font-family-code, Menlo, Consolas, monospace)',
        renderSideBySide: true,
        // Monaco silently switches to the inline (unified) view when the editor
        // is narrower than renderSideBySideInlineBreakpoint (900px), which is
        // almost always the case next to the 240px sidebar. Keep the VS Code
        // left/right split the user expects.
        useInlineViewWhenSpaceIsLimited: false,
        // VS Code's default: the improved diff algorithm (better move/align).
        diffAlgorithm: 'advanced',
        minimap: { enabled: false },
      } as Monaco.editor.IDiffEditorConstructionOptions)
      editor.setModel({ original: oldModel, modified: newModel })
      // VS Code parity: once the diff is computed, auto-scroll the modified
      // (working-tree) side to the FIRST changed region so the user lands on
      // the first edit instead of the top of the file. Fires once per mount —
      // the external-change watch re-runs the diff in place and must not yank
      // the scroll back to the top while the user is reading a later hunk.
      jumpedRef.current = false
      const diffEditor = editor
      diffEditor.onDidUpdateDiff(() => {
        if (jumpedRef.current) return
        const changes = diffEditor.getLineChanges()
        if (!changes || changes.length === 0) return
        const first = changes[0]
        // modifiedStartLineNumber is the first changed line on the working-tree
        // side; fall back to originalStartLineNumber (pure deletion has no
        // modified lines), else line 1.
        const line = first.modifiedStartLineNumber > 0
          ? first.modifiedStartLineNumber
          : (first.originalStartLineNumber > 0 ? first.originalStartLineNumber : 1)
        jumpedRef.current = true
        const modified = diffEditor.getModifiedEditor()
        // Reveal in the next frame so the editor has finished its own diff
        // layout pass; otherwise the reveal can be overwritten by the initial
        // scroll-to-top that follows model assignment.
        requestAnimationFrame(() => { modified.revealLineInCenter(line) })
      })
      // Cmd/Ctrl+S inside the diff pane saves the working-tree side — the same
      // shortcut the normal editor tabs use (explorer parity).
      if (canEdit) {
        editor.addCommand(Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyS, () => { void saveEdits.current() })
      }
      editorRef.current = editor
      setStats({ old: oldModel.getLineCount(), new: newModel.getLineCount(), source })
      setState('ready')
    }

    // Surface a failed import / model collision instead of stranding the
    // spinner on an unhandled rejection.
    void run().catch((e: unknown) => {
      if (cancelled) return
      setState('error')
      setError(e instanceof Error ? e.message : String(e))
    })

    // Quiet reload: re-fetch both sides and write them into the LIVE models
    // (setValue) — the mounted diff editor is never disposed, so there is no
    // spinner, no layout jump, no flicker. Used by the external-change watch
    // and the manual reload after a refused save.
    reloadRef.current = async () => {
      if (cancelled || dirtyRef.current) return
      const liveEditor = editorRef.current
      if (liveEditor === null) { setReloadNonce((n) => n + 1); return }
      const original = liveEditor.getModel()?.original ?? null
      const modified = liveEditor.getModel()?.modified ?? null
      if (original === null || modified === null) return
      try {
        const diffRes = await ideTools.gitDiff(sessionId, path, 'head', ctrl.signal)
        if (cancelled || dirtyRef.current) return
        if (!diffRes.ok) return
        const diff: GitDiffResult = diffRes.value
        let newText = diff.newContent
        let oldText = diff.oldContent
        if (diff.contentType === 'image' || diff.contentType === 'binary') return
        const fileRes = await workspaceFiles.readBytes(sessionId, path, {}, ctrl.signal)
        if (cancelled || dirtyRef.current) return
        if (fileRes.ok) {
          newText = decodeBytesUtf8(fileRes.value.data)
          versionRef.current = fileRes.value.version
          completeRef.current = fileRes.value.eof === true
        } else if (fileRes.error.code === 'workspace-file/not-found') {
          newText = ''
          versionRef.current = undefined
          absentRef.current = true
        }
        if (oldText === '' && diff.diff.trim().length > 0 && newText === diff.oldContent) {
          const applied = applyUnifiedDiff(diff.oldContent, diff.diff)
          if (applied !== diff.oldContent) newText = applied
        }
        // Apply in place with the dirty listener suppressed.
        applyingRef.current = true
        try {
          original.setValue(oldText)
          modified.setValue(newText)
        } finally {
          applyingRef.current = false
        }
        dirtyRef.current = false
        setDirty(false)
        setStats({ old: original.getLineCount(), new: modified.getLineCount(), source: 'disk' })
        if (diff.oldContent === newText && diff.empty) setState('empty')
        else setState('ready')
      } catch {
        // Transport hiccup during a background refresh: keep showing the
        // current diff; the next poll tick retries.
      }
    }

    // External-change watch (working-tree mode): poll every 5s and refresh the
    // diff IN PLACE when the file changed outside this view (another editor, a
    // terminal git command) while the pane carries no unsaved edits. The
    // refresh swaps model content via setValue — the editor is never torn
    // down, so nothing flickers (VS Code updates the diff in place too). With
    // unsaved edits the pane is left alone — saving then hits the version
    // guard and offers a reload, so external work is never silently clobbered.
    let poll: ReturnType<typeof setInterval> | undefined
    let reloading = false
    if (commitSha === undefined) {
      poll = setInterval(() => {
        if (cancelled || dirtyRef.current || reloading) return
        reloading = true
        void workspaceFiles.stat(sessionId, path, ctrl.signal).then((res) => {
          if (cancelled || dirtyRef.current) return
          if (!res.ok) {
            // The file vanished externally: refresh once to show the deletion
            // state, then stop polling (absentRef guards the churn).
            if (res.error.code === 'workspace-file/not-found' && !absentRef.current) {
              absentRef.current = true
              versionRef.current = undefined
              void reloadRef.current()
              onExternalChange?.()
            }
            return
          }
          absentRef.current = false
          if (versionRef.current !== undefined && res.value.version !== versionRef.current) {
            versionRef.current = res.value.version
            void reloadRef.current()
            onExternalChange?.()
          }
        }).catch(() => { /* transient transport errors: next tick retries */ }).finally(() => {
          reloading = false
        })
      }, 5000)
    }
    return () => {
      cancelled = true
      ctrl.abort()
      if (poll !== undefined) clearInterval(poll)
      if (editor) { editor.dispose(); editor = null }
      editorRef.current = null
      for (const model of models) model.dispose()
      models = []
    }
  }, [sessionId, cwd, ideTools, workspaceFiles, path, commitSha, commitPath, commitOldPath, reloadNonce])

  return (
    <div className="ide-diff-root">
      <div className="ide-diff-header">
        <span className="ide-diff-title">{name}</span>
        {onClose && (
          <button
            className="ide-diff-close"
            type="button"
            title={t('tab.close')}
            aria-label={t('tab.close')}
            onClick={onClose}
          >{Icons.close}</button>
        )}
        <span className="ide-diff-path">{commit !== undefined ? commit.sha.slice(0, 8) + ' · ' + path : path}</span>
        {dirty && <span className="ide-diff-dirty" title={t('diff.unsaved')} />}
        {saveError !== null && (
          <span className="ide-diff-save-error" title={saveError}>{saveError}</span>
        )}
        {saveError !== null && (
          <button className="ide-diff-reload" type="button" onClick={() => { setSaveError(null); setSavePhase('idle'); void reloadRef.current() }}>
            {t('diff.reload')}
          </button>
        )}
        {stats && (
          <span className="ide-diff-stats" title={'right side: ' + stats.source}>
            {stats.old} &rarr; {stats.new} · {stats.source}
          </span>
        )}
      </div>
      {state === 'image' ? (
        <div className="ide-diff-image-container">
          <img className="ide-diff-image" src={imageSrc} alt={name} />
        </div>
      ) : (
        <>
          <div className="ide-diff-container" ref={containerRef} />
          <div className="ide-diff-overlay">
            {state === 'loading' && (
              <div className="ide-diff-empty">{Icons.loading}</div>
            )}
            {state === 'empty' && (
              <div className="ide-diff-empty">
                {Icons.diff}
                <span>{t('git.emptyDiff')}</span>
              </div>
            )}
            {state === 'binary' && (
              <div className="ide-diff-empty">
                {Icons.diff}
                <span>{binaryLabel ?? t('git.binaryFile')}</span>
              </div>
            )}
            {state === 'error' && (
              <div className="ide-diff-empty">
                {Icons.diff}
                <span>{t('git.diffError', { message: error ?? '' })}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
