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
import type { GitDiffResult, IdeToolsRemote, SessionId } from '../types.js'
import { Icons } from '../icons.js'
import { defineDarkModernTheme } from '../theme.js'

export interface DiffEditorProps {
  sessionId: SessionId
  cwd: string | undefined
  ideTools: IdeToolsRemote
  /** Path to diff (workspace-relative). */
  path: string
  /** Display basename for the tab title. */
  name: string
  t: (key: string, params?: Record<string, string | number>) => string
}

type LoadState = 'loading' | 'ready' | 'empty' | 'error' | 'image'

let monacoLoaded = false

function ensureMonaco(m: typeof Monaco): void {
  if (monacoLoaded) return
  defineDarkModernTheme(m)
  // Ensure the no-op worker env is installed (the IdeView may have done it;
  // harmless to re-check).
  const env = (self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment
  if (!env) {
    const noopWorkerURL = URL.createObjectURL(
      new Blob(['self.onmessage = () => {}'], { type: 'application/javascript' }),
    )
    ;(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
      getWorker: () => new Worker(noopWorkerURL, { type: 'classic' }),
    }
  }
  monacoLoaded = true
}

export function DiffEditor({ sessionId, cwd, ideTools, path, name, t }: DiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Monaco.editor.IDiffEditor | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [imageSrc, setImageSrc] = useState<string>('')

  // Load the diff and mount the diff editor when the path changes.
  useEffect(() => {
    let cancelled = false
    let editor: Monaco.editor.IDiffEditor | null = null
    const ctrl = new AbortController()

    async function run(): Promise<void> {
      if (!cwd) { setState('error'); setError('no cwd'); return }
      setState('loading')
      setError(null)
      setImageSrc('')
      const res = await ideTools.gitDiff(sessionId, path, 'unstaged', ctrl.signal)
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
      // Import Monaco (bundled with the client chunk).
      const Monaco = await import('monaco-editor')
      if (cancelled) return
      ensureMonaco(Monaco as unknown as typeof Monaco)
      const container = containerRef.current
      if (!container) return
      // Dispose any prior editor on this host.
      editorRef.current?.dispose()
      editorRef.current = null
      const oldUri = Monaco.Uri.parse('dsh-git-diff-old:' + path)
      const newUri = Monaco.Uri.parse('dsh-git-diff-new:' + path + ':' + Date.now())
      const oldModel = Monaco.editor.createModel(diff.oldContent, diff.language, oldUri)
      const newModel = Monaco.editor.createModel(diff.newContent, diff.language, newUri)
      editor = Monaco.editor.createDiffEditor(container, {
        theme: 'dsh-dark-modern',
        readOnly: true,
        automaticLayout: true,
        fontSize: 13,
        lineHeight: 20,
        scrollBeyondLastLine: false,
        fontFamily: 'var(--ds-font-family-code, Menlo, Consolas, monospace)',
        renderSideBySide: true,
        minimap: { enabled: false },
      } as Monaco.editor.IDiffEditorConstructionOptions)
      editor.setModel({ original: oldModel, modified: newModel })
      editorRef.current = editor
      setState('ready')
    }

    void run()
    return () => {
      cancelled = true
      ctrl.abort()
      if (editor) { editor.dispose(); editorRef.current = null }
    }
  }, [sessionId, cwd, ideTools, path])

  // Dispose the diff editor on unmount.
  useEffect(() => {
    return () => { editorRef.current?.dispose(); editorRef.current = null }
  }, [])

  return (
    <div className="ide-diff-root">
      <div className="ide-diff-header">
        <span className="ide-diff-title">{name}</span>
        <span className="ide-diff-path">{path}</span>
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
