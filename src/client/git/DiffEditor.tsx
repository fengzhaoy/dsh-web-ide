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
import type { GitDiffResult, IdeToolsRemote, SessionId, WorkspaceFilesRemote } from '../types.js'
import { Icons } from '../icons.js'
import { defineDarkModernTheme } from '../theme.js'
import { installMonacoWorker } from '../monacoWorkerBootstrap.js'

export interface DiffEditorProps {
  sessionId: SessionId
  cwd: string | undefined
  ideTools: IdeToolsRemote
  /** Workspace-files Remote, used to read the working-tree side directly. */
  workspaceFiles: WorkspaceFilesRemote
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

/** Decode a workspace-files base64 payload to a UTF-8 string. */
function decodeBase64Utf8(data: string): string {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
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

export function DiffEditor({ sessionId, cwd, ideTools, workspaceFiles, path, name, commit, onClose, t }: DiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Monaco.editor.IDiffEditor | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [imageSrc, setImageSrc] = useState<string>('')
  /** The host's one-line binary marker (commit mode) shown in the overlay. */
  const [binaryLabel, setBinaryLabel] = useState<string | null>(null)
  /** Line counts of the two sides; shown in the header (also a build marker). */
  const [stats, setStats] = useState<{ old: number; new: number; source: string } | null>(null)

  // Destructure `commit` to primitives for the deps array: IdeView creates a
  // fresh object per render, and an object dep would remount the editor on
  // every parent render (aborting the in-flight load mid-swap).
  const commitSha = commit?.sha
  const commitPath = commit?.path
  const commitOldPath = commit?.oldPath

  // Load the diff and mount the diff editor when the path changes.
  useEffect(() => {
    let cancelled = false
    let editor: Monaco.editor.IDiffEditor | null = null
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
      const fileRes = await workspaceFiles.readAll(sessionId, path, ctrl.signal)
      if (cancelled) return
      if (fileRes.ok) { newText = decodeBase64Utf8(fileRes.value.data); source = 'disk' }
      else if (fileRes.error.code === 'workspace-file/not-found') { newText = ''; source = 'disk' }
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
      editor = Monaco.editor.createDiffEditor(container, {
        theme: 'dsh-dark-modern',
        readOnly: true,
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
    return () => {
      cancelled = true
      ctrl.abort()
      if (editor) { editor.dispose(); editor = null }
      editorRef.current = null
      for (const model of models) model.dispose()
      models = []
    }
  }, [sessionId, cwd, ideTools, workspaceFiles, path, commitSha, commitPath, commitOldPath])

  return (
    <div className="ide-diff-root">
      <div className="ide-diff-header">
        <span className="ide-diff-title">{name}</span>
        <span className="ide-diff-path">{commit !== undefined ? commit.sha.slice(0, 8) + ' · ' + path : path}</span>
        {stats && (
          <span className="ide-diff-stats" title={'right side: ' + stats.source}>
            {stats.old} &rarr; {stats.new} · {stats.source}
          </span>
        )}
        {onClose && (
          <button
            className="ide-diff-close"
            type="button"
            title={t('tab.close')}
            aria-label={t('tab.close')}
            onClick={onClose}
          >{Icons.close}</button>
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
