import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icons } from './icons.js'
import { IDE_CSS_VARS, IDE_STYLES, defineDarkModernTheme } from './theme.js'
import { FileTree } from './explorer/FileTree.js'
import { SearchPanel } from './search/SearchPanel.js'
import { SourceControlPanel } from './git/SourceControlPanel.js'
import { DiffEditor } from './git/DiffEditor.js'
import { TerminalPanel } from './terminal/TerminalPanel.js'
import { TabBar } from './editor/TabBar.js'
import { StatusBar } from './editor/StatusBar.js'
import { ContextMenuHost } from './ContextMenu.js'
import type { OpenTab } from './editor/TabBar.js'
import { detectLanguage } from './language.js'
import type { IdeViewInjected, RemoteResult, WorkspaceFileBytes, WorkspaceFileStat, WorkspaceFileText } from './types.js'
import { publishActiveFile, registerIdeMount, syncSidebarHighlight, takePendingOpenPath, unregisterIdeMount } from './sidebarBridge.js'

/** Threshold above which a file is loaded as a truncated first page. */
const LARGE_FILE_BYTES = 2 * 1024 * 1024
const TRUNCATED_LINES = 5000

/** Lazy Monaco: imported on first IDE tab activation. Static import so the
 * bundler includes the editor in the client bundle (dynamic import of a
 * non-external package would be left as a runtime URL the DSH module table
 * cannot resolve). */
// Import the full monaco-editor entry: it registers the basic-language
// monarch tokenizers (TS/JS/JSON/CSS/HTML/Markdown/...) on the main thread,
// which is exactly what a read-only viewer needs for syntax highlighting
// without language web-workers. The codicon .ttf it pulls is neutralized by
// the tsdown loader config (we ship our own SVG icons).
import * as Monaco from 'monaco-editor'
type MonacoNS = typeof Monaco
type MonacoTextModel = import('monaco-editor').editor.ITextModel
let monacoLoaded = false

/**
 * Configure Monaco's worker environment. Monaco wants language web-workers for
 * rich features (TS diagnostics, JSON validation, etc.). In the DSH module
 * loader we have no stable URL for worker assets, so we install a no-op worker:
 * Monaco still renders syntax tokens via its built-in monarch tokenizer (which
 * runs on the main thread) — sufficient for a read-only viewer.
 */
function configureMonacoWorkers(): void {
  if ((self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment) return
  const noopWorkerURL = URL.createObjectURL(
    new Blob(['self.onmessage = () => {}'], { type: 'application/javascript' }),
  )
  ;(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
    getWorker: () => new Worker(noopWorkerURL, { type: 'classic' }),
  }
}

function loadMonaco(): Promise<MonacoNS> {
  if (!monacoLoaded) {
    configureMonacoWorkers()
    defineDarkModernTheme(Monaco)
    monacoLoaded = true
  }
  return Promise.resolve(Monaco)
}

/**
 * Module-level editor singleton. The conversation view ring remounts the view
 * component repeatedly (props updates rebuild the subtree); a per-mount editor
 * would be disposed mid-flight, and a React-owned container div gets discarded
 * with its subtree (leaving the editor in a detached, collapsed old div).
 * Instead ONE persistent host div — never React-owned — is moved into the
 * current mount's container on every attach, and the editor is created on that
 * host exactly once, then re-laid-out on re-attach.
 */
const ideEditor = {
  editor: null as ReturnType<MonacoNS['editor']['create']> | null,
  /** Persistent mount point for the Monaco editor; survives view remounts. */
  host: null as HTMLDivElement | null,
  models: new Map<string, MonacoTextModel>(),
  /** Saved-content baseline per open path; the dirty flag compares against it. */
  saved: new Map<string, string>(),  /** Create-or-adopt: returns a live editor attached inside the container. */
  async attach(container: HTMLElement): Promise<ReturnType<MonacoNS['editor']['create']>> {
    const m = await loadMonaco()
    const EDITOR_OPTIONS = {
      theme: 'dsh-dark-modern',
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 13,
      lineHeight: 20,
      scrollBeyondLastLine: false,
      fontFamily: 'var(--ds-font-family-code, Menlo, Consolas, monospace)',
      renderWhitespace: 'selection',
      renderLineHighlight: 'all',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      wordWrap: 'off',
    } as const
    if (!this.host) {
      this.host = document.createElement('div')
      this.host.className = 'ide-monaco-host'
    }
    // Move the persistent host into this mount's container. appendChild on an
    // existing node RELOCATES it (no nesting accumulates across remounts), and
    // the host is never part of a React-managed subtree, so React cannot
    // discard it with the old container.
    if (this.host.parentElement !== container) container.appendChild(this.host)
    if (!this.editor) {
      this.editor = m.editor.create(this.host, { ...EDITOR_OPTIONS })
    } else {
      this.editor.layout()
    }
    return this.editor
  },
}

/**
 * Workspace-scoped tab persistence: tabs and the active tab are keyed by the
 * workspace root (cwd), not the session, so switching sessions that share a
 * workspace keeps the editor's open state, and returning to a workspace
 * restores its tabs after the view ring remounts the component. The Monaco
 * models and saved baselines are already path-keyed at module level, so only
 * the tab list needs parking here.
 */
const workspaceTabs = new Map<string, { tabs: OpenTab[]; activePath: string | undefined }>()

function storeKeyOf(cwd: string | undefined): string | null {
  return cwd && cwd.length > 0 ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : null
}

/** Create a Monaco model for the path, reusing (and refilling) any model that
 * survived from an earlier view mount under the same dsh-ide URI. */
function createOrReuseModel(m: MonacoNS, path: string, text: string, language: string): MonacoTextModel {
  const uri = m.Uri.parse(`dsh-ide:${path}`)
  const existing = m.editor.getModel(uri)
  if (existing) {
    existing.setValue(text)
    return existing
  }
  return m.editor.createModel(text, language, uri)
}

/** Decode base64 to a UTF-8 string. */
function decodeBase64(data: string): string {
  const bin = atob(data)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/** Extract an error message from a RemoteResult failure. */
function resultError(r: { ok: false; error: { message?: string; code?: string } }): string {
  return r.error.message ?? r.error.code ?? 'unknown error'
}

interface OpenFileResult {
  text: string
  version: string
  truncated: boolean
  lines: number
  error: string | null
}

/** Read one file, picking readAll for small files and a truncated page for large. */
async function loadFileContent(
  wf: IdeViewInjected['workspaceFiles'],
  sessionId: string,
  path: string,
  signal: AbortSignal,
): Promise<OpenFileResult> {
  const statRes: RemoteResult<WorkspaceFileStat> = await wf.stat(sessionId, path, signal)
  if (!statRes.ok) return { text: '', version: '', truncated: false, lines: 0, error: resultError(statRes) }
  const stat = statRes.value
  if (stat.bytes !== undefined && stat.bytes > LARGE_FILE_BYTES) {
    const readRes: RemoteResult<WorkspaceFileText> = await wf.read(sessionId, path, { offset: 1, limit: TRUNCATED_LINES }, signal)
    if (!readRes.ok) return { text: '', version: stat.version, truncated: false, lines: 0, error: resultError(readRes) }
    const page = readRes.value
    const tail = page.eof ? '' : `\n\n[... ${TRUNCATED_LINES} lines shown, file truncated ...]`
    return { text: page.text + tail, version: stat.version, truncated: true, lines: page.lines, error: null }
  }
  const allRes: RemoteResult<WorkspaceFileBytes> = await wf.readAll(sessionId, path, signal)
  if (!allRes.ok) {
    // not-text or too-large: fall back to a line page if possible.
    if (allRes.error.code === 'workspace-file/not-text') {
      return { text: '', version: stat.version, truncated: false, lines: 0, error: 'not-text' }
    }
    return { text: '', version: stat.version, truncated: false, lines: 0, error: resultError(allRes) }
  }
  const text = decodeBase64(allRes.value.data)
  const lines = text === '' ? 0 : text.split('\n').length
  return { text, version: stat.version, truncated: false, lines, error: null }
}

export function IdeView(props: IdeViewInjected & {
  /** Conversation view-ring owner props (one-shot focus requests). */
  viewRequest?: { view: string; focus: string } | null
  openView?: (view: string, focus: string) => void
  completeViewRequest?: () => void
}) {
  const { sessionId, cwd, workspaceFiles, workspaceFilesWrite } = props
  // Lazy namespace getter resolved at render (after boot settles); see types.
  const ideTools = props.ideTools()
  const viewRequest = props.viewRequest ?? null
  const openView = props.openView
  const completeViewRequest = props.completeViewRequest
  // The slot injector passes the locale-bound t; keep a template fallback so
  // the component also renders standalone (tests, storybook).
  const t = props.t ?? ((key: string, params?: Record<string, string | number>): string => {
    return params ? Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key) : key
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ReturnType<MonacoNS['editor']['create']> | null>(null)
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activePath, setActivePath] = useState<string | undefined>(undefined)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [monacoReady, setMonacoReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Save flow state for the active tab (idle / saving / conflict). */
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'conflict'>('idle')
  /** Path whose save hit a stale-version conflict; drives the conflict dialog. */
  const [conflictPath, setConflictPath] = useState<string | undefined>(undefined)
  /** Pending dirty-tab close awaiting the user's save/discard choice. */
  const [confirmClose, setConfirmClose] = useState<{ path: string; name: string } | null>(null)
  /** Which sidebar panel the activity bar selected. */
  const [sidebarView, setSidebarView] = useState<'explorer' | 'search' | 'git'>('explorer')
  /** Path whose git diff is shown in the editor area (overrides normal tabs). */
  const [diffPath, setDiffPath] = useState<string | undefined>(undefined)
  /** Git status entries for coloring file tree names. Fetched when explorer view is active. */
  const [gitEntries, setGitEntries] = useState<readonly import('./types.js').GitStatusEntry[] | undefined>(undefined)
  /** Bottom terminal dock: open flag + multiple terminal identities (survives remounts). */
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalIds, setTerminalIds] = useState<string[]>([])
  const [activeTerminalIdx, setActiveTerminalIdx] = useState(0)
  /** Fast per-path dirty mirror so the Monaco content listener can bail before touching React state. */
  const dirtyRef = useRef<Set<string>>(new Set())

  // Inject the stylesheet + CSS vars once.
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = IDE_STYLES
    document.head.appendChild(style)
    const root = containerRef.current?.closest('.ide-root') as HTMLElement | null
    if (root) for (const [k, v] of Object.entries(IDE_CSS_VARS)) root.style.setProperty(k, v)
    return () => { document.head.removeChild(style) }
  }, [])

  // Attach the singleton editor to this mount's container. The editor and its
  // models survive view-ring remounts; on unmount we only detach (leave the DOM
  // parented to the singleton) so the next mount re-attaches instantly.
  useEffect(() => {
    let cancelled = false
    let cursorSub: { dispose(): void } | null = null
    let contentSub: { dispose(): void } | null = null
    ideEditor.attach(containerRef.current!).then((editor) => {
      if (cancelled) return
      editorRef.current = editor
      cursorSub = editor.onDidChangeCursorPosition((e) => {
        if (e.position) setCursor({ line: e.position.lineNumber, column: e.position.column })
      })
      contentSub = editor.onDidChangeModelContent(() => {
        const model = editor.getModel()
        if (!model) return
        let path: string | undefined
        for (const [p, m] of ideEditor.models) if (m === model) { path = p; break }
        if (path === undefined) return
        const saved = ideEditor.saved.get(path)
        const dirty = saved !== undefined && model.getValue() !== saved
        if (dirtyRef.current.has(path) === dirty) return
        if (dirty) dirtyRef.current.add(path)
        else dirtyRef.current.delete(path)
        setTabs((prev) => prev.map((t) => t.path === path ? { ...t, dirty } : t))
      })
      // addCommand's return value is not a stable IDisposable across Monaco
      // builds; keybinding commands live with the singleton editor anyway.
      editor.addCommand(Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyS, () => {
        const p = activePathRef.current
        if (p !== undefined) void saveRef.current(p)
      })
      setMonacoReady(true)
    }).catch((e) => {
      setError(`Monaco load failed: ${e instanceof Error ? e.message : String(e)}`)
    })
    return () => {
      cancelled = true
      cursorSub?.dispose()
      contentSub?.dispose()
      editorRef.current = null
    }
  }, [])

  const activeTab = useMemo(() => tabs.find((t) => t.path === activePath), [tabs, activePath])

  // Workspace-scoped switching: when the workspace root (cwd) changes, park
  // the current tabs under the old key and restore the new workspace's tabs.
  // Sessions sharing a workspace (same cwd) keep their tabs; models and saved
  // baselines are absolute-path keyed and survive untouched.
  useEffect(() => {
    const key = storeKeyOf(cwd)
    if (key === null) return
    const parked = workspaceTabs.get(key)
    setTabs(parked?.tabs ?? [])
    setActivePath(parked?.activePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  // Park the current tab state whenever it changes, so remounts and workspace
  // switches always read back the freshest state.
  useEffect(() => {
    const key = storeKeyOf(cwd)
    if (key === null) return
    workspaceTabs.set(key, { tabs, activePath })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, tabs, activePath])

  const openFile = useCallback(async (path: string, line?: number) => {
    if (!sessionId) return
    const m = await loadMonaco()
    // Already open?
    const existing = tabs.find((t) => t.path === path)
    if (existing && existing.status === 'ready') {
      setActivePath(path)
      const model = ideEditor.models.get(path)
      if (model && editorRef.current) {
        editorRef.current.setModel(model)
        revealLine(editorRef.current, line)
      }
      return
    }
    const name = path.split('/').pop() ?? path
    const language = detectLanguage(path)
    const loadingTab: OpenTab = { path, name, language, version: '', truncated: false, lines: 0, status: 'loading', error: null, dirty: false }
    setTabs((prev) => {
      const next = prev.some((t) => t.path === path) ? prev.map((t) => t.path === path ? loadingTab : t) : [...prev, loadingTab]
      return next
    })
    setActivePath(path)
    const ctrl = new AbortController()
    const result = await loadFileContent(workspaceFiles, sessionId, path, ctrl.signal)
    if (ctrl.signal.aborted) return
    if (result.error) {
      const errTab: OpenTab = { path, name, language, version: result.version, truncated: false, lines: 0, status: 'error', error: result.error, dirty: false }
      setTabs((prev) => prev.map((t) => t.path === path ? errTab : t))
      return
    }
    const model = createOrReuseModel(m, path, result.text, language)
    ideEditor.models.set(path, model)
    ideEditor.saved.set(path, result.text)
    dirtyRef.current.delete(path)
    const readyTab: OpenTab = { path, name, language, version: result.version, truncated: result.truncated, lines: result.lines, status: 'ready', error: null, dirty: false }
    setTabs((prev) => prev.map((t) => t.path === path ? readyTab : t))
    // openFile always activates the opened tab, so attach the model right away.
    // (Do NOT test activePath here: the closure captured it before the click's
    // setActivePath re-render, so it would be stale and skip the setModel.)
    editorRef.current?.setModel(model)
    revealLine(editorRef.current, line)
  }, [sessionId, tabs, workspaceFiles, activePath])

  // Apply model switch when activePath changes. Truncated views stay read-only:
  // saving a truncated page would write the truncated text and lose the tail.
  useEffect(() => {
    if (!editorRef.current || !monacoReady) return
    if (activePath === undefined) { editorRef.current.setModel(null); return }
    const model = ideEditor.models.get(activePath)
    if (model) editorRef.current.setModel(model)
    const tab = tabs.find((t) => t.path === activePath)
    editorRef.current.updateOptions({ readOnly: tab?.truncated === true })
  }, [activePath, monacoReady, tabs])

  const closeTabNow = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path)
      const model = ideEditor.models.get(path)
      if (model) { model.dispose(); ideEditor.models.delete(path) }
      ideEditor.saved.delete(path)
      dirtyRef.current.delete(path)
      if (conflictPath === path) { setConflictPath(undefined); setSaveState('idle') }
      if (activePath === path) {
        const newActive = next[next.length - 1]?.path
        setActivePath(newActive)
      }
      return next
    })
  }, [activePath, conflictPath])

  // Closing a dirty tab asks first: save / discard / cancel.
  const closeTab = useCallback((path: string) => {
    const tab = tabs.find((t) => t.path === path)
    if (tab?.dirty) { setConfirmClose({ path, name: tab.name }); return }
    closeTabNow(path)
  }, [tabs, closeTabNow])

  // Subscribe to file changes; refresh open files whose version changed.
  useEffect(() => {
    if (!sessionId) return
    const ctrl = new AbortController()
    let cancelled = false
    ;(async () => {
      try {
        for await (const frame of workspaceFiles.changes(sessionId, ctrl.signal)) {
          if (cancelled || frame.kind !== 'change') continue
          const absPath = frame.change.absolutePath
          // Match by absolute path or relative path against open tabs.
          const hit = tabsRef.current.find((t) => matchesPath(t.path, absPath, cwd))
          const newVersion = 'version' in frame.change ? frame.change.version : undefined
          // Dirty tabs keep their in-editor edits; the user resolves the
          // divergence on save (stale-version conflict dialog).
          if (hit && hit.status === 'ready' && !hit.dirty && newVersion !== undefined && newVersion !== hit.version) {
            // Re-open in the background; do not steal focus.
            void reopenFile(hit.path)
          }
        }
      } catch {
        // The change stream is best-effort; ignore transport errors.
      }
    })()
    return () => { cancelled = true; ctrl.abort() }
  }, [sessionId, workspaceFiles, cwd])

  // Keep a ref to tabs so the change-stream effect (created once per session) sees latest.
  const tabsRef = useRef(tabs)
  useEffect(() => { tabsRef.current = tabs }, [tabs])

  // Auto-fetch git status for activity bar badge and file tree coloring.
  // Runs regardless of which sidebar view is active, so the badge count stays
  // current even when the user is in explorer or search view.
  useEffect(() => {
    if (!sessionId || !cwd || !ideTools) return
    const ctrl = new AbortController()
    let cancelled = false
    const fetch = () => {
      void ideTools.gitStatus(sessionId, ctrl.signal).then((res) => {
        if (cancelled) return
        if (res.ok) {
          if (res.value.notARepo) setGitEntries(undefined)
          else if (res.value.entries) setGitEntries(res.value.entries)
        }
      }).catch(() => {
        // Swallow git status fetch errors (namespace not mounted, not a repo,
        // network blip) so they never crash the React effect.
      })
    }
    fetch()
    // Poll every 15s so the badge count stays fresh while the panel is closed.
    const id = setInterval(fetch, 15000)
    return () => { cancelled = true; ctrl.abort(); clearInterval(id) }
  }, [sessionId, cwd, ideTools])

  // Register this mount with the sidebar bridge so sidebar clicks can route
  // here, and publish the active file so the sidebar tree can highlight it.
  useEffect(() => {
    if (!sessionId || !openView) return
    registerIdeMount({ sessionId, openView, openFile: (path) => { void openFile(path) } })
    // A sidebar click that arrived before the first activation parked its
    // path; open it now.
    const pending = takePendingOpenPath()
    if (pending) void openFile(pending)
    return () => { unregisterIdeMount() }
  }, [sessionId, openView, openFile])

  // Publish the active file to the sidebar bridge (highlight sync).
  useEffect(() => {
    publishActiveFile(sessionId, activePath)
  }, [sessionId, activePath, tabs])

  // One-shot focus requests from the view ring (sidebar clicks): open the
  // focused file, then acknowledge.
  useEffect(() => {
    if (!viewRequest || viewRequest.view !== 'ide') return
    const path = viewRequest.focus
    completeViewRequest?.()
    if (path) void openFile(path)
  }, [viewRequest, completeViewRequest, openFile])

  const reopenFile = useCallback(async (path: string) => {
    if (!sessionId) return
    const m = await loadMonaco()
    const ctrl = new AbortController()
    const result = await loadFileContent(workspaceFiles, sessionId, path, ctrl.signal)
    if (ctrl.signal.aborted || result.error) return
    const old = ideEditor.models.get(path)
    if (old) old.dispose()
    const language = detectLanguage(path)
    const model = createOrReuseModel(m, path, result.text, language)
    ideEditor.models.set(path, model)
    ideEditor.saved.set(path, result.text)
    dirtyRef.current.delete(path)
    if (activePath === path && editorRef.current) editorRef.current.setModel(model)
    setTabs((prev) => prev.map((t) => t.path === path ? { ...t, text: undefined as never, version: result.version, truncated: result.truncated, lines: result.lines, status: 'ready' as const, error: null, dirty: false } : t))
  }, [sessionId, workspaceFiles, activePath])

  // Latest-values refs so the Monaco command and listeners never run stale closures.
  const activePathRef = useRef(activePath)
  useEffect(() => { activePathRef.current = activePath }, [activePath])
  const saveRef = useRef<(path: string) => Promise<boolean>>(async () => false)
  useEffect(() => { saveRef.current = saveFile })

  /** Save one tab through the write Remote with a version-guarded intent. */
  const saveFile = useCallback(async (path: string): Promise<boolean> => {
    if (!sessionId) return false
    const tab = tabsRef.current.find((t) => t.path === path)
    const model = ideEditor.models.get(path)
    if (!tab || !model || tab.status !== 'ready' || tab.truncated) return false
    const content = model.getValue()
    setSaveState('saving')
    const intent = tab.version ? { kind: 'replaceIfVersion' as const, version: tab.version } : { kind: 'createIfAbsent' as const }
    const res = await workspaceFilesWrite.write(sessionId, path, content, intent)
    if (!res.ok) {
      if (res.error.code === 'workspace-file-write/stale-version') {
        setConflictPath(path)
        setSaveState('conflict')
      } else {
        setSaveState('idle')
        setError(t('save.failed', { message: res.error.message ?? res.error.code }))
      }
      return false
    }
    ideEditor.saved.set(path, content)
    dirtyRef.current.delete(path)
    setTabs((prev) => prev.map((t2) => t2.path === path ? { ...t2, version: res.value.version, dirty: false } : t2))
    setSaveState('idle')
    return true
  }, [sessionId, workspaceFilesWrite, t])

  /** Conflict resolution: write unconditionally, losing the external change. */
  const overwriteConflict = useCallback(async () => {
    const path = conflictPath
    if (!path || !sessionId) return
    const model = ideEditor.models.get(path)
    if (!model) { setConflictPath(undefined); setSaveState('idle'); return }
    const content = model.getValue()
    setSaveState('saving')
    const res = await workspaceFilesWrite.write(sessionId, path, content, undefined)
    if (!res.ok) {
      setSaveState('idle')
      setError(t('save.failed', { message: res.error.message ?? res.error.code }))
      return
    }
    ideEditor.saved.set(path, content)
    dirtyRef.current.delete(path)
    setTabs((prev) => prev.map((t2) => t2.path === path ? { ...t2, version: res.value.version, dirty: false } : t2))
    setConflictPath(undefined)
    setSaveState('idle')
  }, [conflictPath, sessionId, workspaceFilesWrite, t])

  /** Conflict resolution: discard in-editor edits and reload from disk. */
  const reloadConflict = useCallback(() => {
    const path = conflictPath
    setConflictPath(undefined)
    setSaveState('idle')
    if (path) void reopenFile(path)
  }, [conflictPath, reopenFile])

  const onConfirmCloseSave = useCallback(async () => {
    const target = confirmClose
    if (!target) return
    setConfirmClose(null)
    // On conflict the tab stays open with the conflict dialog; on other
    // failures the error banner shows and the tab remains.
    const ok = await saveFile(target.path)
    if (ok) closeTabNow(target.path)
  }, [confirmClose, saveFile, closeTabNow])

  const onConfirmCloseDiscard = useCallback(() => {
    const target = confirmClose
    setConfirmClose(null)
    if (target) closeTabNow(target.path)
  }, [confirmClose, closeTabNow])

  return (
    <div className="ide-root" data-ide-view="">
      <ContextMenuHost />
      <div className="ide-body">
        <div className="ide-activitybar">
          <div
            className="ide-activitybar-icon"
            data-active={sidebarView === 'explorer'}
            title={t('explorer.title')}
            onClick={() => setSidebarView('explorer')}
          >{Icons.explorer}</div>
          <div
            className="ide-activitybar-icon"
            data-active={sidebarView === 'search'}
            title={t('search.title')}
            onClick={() => setSidebarView('search')}
          >{Icons.search}</div>
          <div
            className="ide-activitybar-icon"
            data-active={sidebarView === 'git'}
            title={t('git.title')}
            onClick={() => setSidebarView('git')}
          >
            {Icons.git}
            {gitEntries !== undefined && gitEntries.length > 0 && (
              <span className="ide-activitybar-badge">{gitEntries.length}</span>
            )}
          </div>
          <div className="ide-activitybar-icon" title={t('debug.title')} onClick={() => {}}>{Icons.debug}</div>
          <div className="ide-activitybar-icon" title={t('extensions.title')} onClick={() => {}}>{Icons.extensions}</div>
          <div className="ide-activitybar-spacer" />
          <div
            className="ide-activitybar-icon"
            data-active={terminalOpen}
            title={t('terminal.title')}
            onClick={() => setTerminalOpen((v) => !v)}
            data-testid="ide-activitybar-terminal"
          >{Icons.terminal}</div>
        </div>
        <div className="ide-sidebar">
          {sidebarView === 'git' ? (
            sessionId ? (
              <SourceControlPanel
                sessionId={sessionId}
                cwd={cwd}
                ideTools={ideTools}
                onOpenDiff={(path) => {
                  // Opening a diff clears the normal active tab and shows the
                  // diff editor in the editor area instead.
                  setDiffPath(path)
                  if (editorRef.current) editorRef.current.setModel(null)
                }}
                t={t}
              />
            ) : (
              <div className="ide-tree-loading">{t('empty.noSession')}</div>
            )
          ) : sidebarView === 'search' ? (
            sessionId ? (
              <SearchPanel
                sessionId={sessionId}
                cwd={cwd}
                ideTools={ideTools}
                onOpenFile={(path, line) => {
                  // Opening a file from search clears any active diff.
                  setDiffPath(undefined)
                  void openFile(path, line)
                }}
                t={t}
              />
            ) : (
              <div className="ide-tree-loading">{t('empty.noSession')}</div>
            )
          ) : (
            <>
              <div className="ide-sidebar-header">{t('explorer.title')}</div>
              {sessionId && cwd ? (
                <FileTree
                  sessionId={sessionId}
                  rootDir={cwd}
                  workspaceFiles={workspaceFiles}
                  activePath={activePath}
                  onOpenFile={(path) => {
                    // Opening a file from the tree clears any active diff.
                    setDiffPath(undefined)
                    void openFile(path)
                  }}
                  t={t}
                  gitEntries={gitEntries}
                />
              ) : (
                <div className="ide-tree-loading">{sessionId ? t('tree.loading') : t('empty.noSession')}</div>
              )}
            </>
          )}
        </div>
        <div className="ide-editor-area">
          {diffPath ? (
            <DiffEditor
              sessionId={sessionId}
              cwd={cwd}
              ideTools={ideTools}
              path={diffPath}
              name={diffPath.split('/').pop() ?? diffPath}
              t={t}
            />
          ) : (
            <>
              <TabBar tabs={tabs} active={activePath} onSelect={setActivePath} onClose={closeTab} t={t} />
              {/* Monaco owns this container exclusively; React never renders children
                  into it (overlays live in the sibling .ide-editor-overlay below) so
                  reconciliation can never remove the editor DOM. */}
              <div className="ide-editor-container" ref={containerRef} />
              <div className="ide-editor-overlay">
                {!monacoReady && !error && (
                  <div className="ide-editor-empty">{Icons.loading}</div>
                )}
                {error && (
                  <div className="ide-editor-empty">
                    <div>{t('file.openError', { message: error })}</div>
                  </div>
                )}
                {monacoReady && !activePath && !error && (
                  <div className="ide-editor-empty">
                    {Icons.emptyEditor}
                    <div>{t('empty.hint')}</div>
                  </div>
                )}
                {conflictPath && (
                  <div className="ide-dialog-backdrop">
                    <div className="ide-dialog" role="alertdialog">
                      <div className="ide-dialog-title">{t('save.conflictTitle')}</div>
                      <div className="ide-dialog-body">{t('save.conflictBody')}</div>
                      <div className="ide-dialog-actions">
                        <button className="ide-dialog-button" onClick={() => { void overwriteConflict() }}>{t('save.overwrite')}</button>
                        <button className="ide-dialog-button ide-dialog-button-quiet" onClick={reloadConflict}>{t('save.reload')}</button>
                      </div>
                    </div>
                  </div>
                )}
                {confirmClose && (
                  <div className="ide-dialog-backdrop">
                    <div className="ide-dialog" role="dialog">
                      <div className="ide-dialog-title">{t('save.closeDirtyTitle')}</div>
                      <div className="ide-dialog-body">{t('save.closeDirtyBody', { name: confirmClose.name })}</div>
                      <div className="ide-dialog-actions">
                        <button className="ide-dialog-button" onClick={() => { void onConfirmCloseSave() }}>{t('save.closeSave')}</button>
                        <button className="ide-dialog-button ide-dialog-button-quiet" onClick={onConfirmCloseDiscard}>{t('save.closeDiscard')}</button>
                        <button className="ide-dialog-button ide-dialog-button-quiet" onClick={() => setConfirmClose(null)}>{t('save.cancel')}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          {terminalOpen && sessionId && (
            <TerminalPanel
              sessionId={sessionId}
              ideTools={ideTools}
              terminalIds={terminalIds}
              activeIdx={activeTerminalIdx}
              onTerminalOpened={(id) => {
                setTerminalIds((prev) => prev.includes(id) ? prev : [...prev, id])
              }}
              onActiveChange={setActiveTerminalIdx}
              onTerminalClosed={(idx) => {
                setTerminalIds((prev) => {
                  const next = prev.filter((_, i) => i !== idx)
                  if (next.length === 0) setTerminalOpen(false)
                  if (activeTerminalIdx >= next.length) setActiveTerminalIdx(Math.max(0, next.length - 1))
                  return next
                })
              }}
              onClose={() => setTerminalOpen(false)}
              t={t}
            />
          )}
          <StatusBar activeTab={activeTab} cursor={cursor} t={t} saveState={saveState} onSave={() => { if (activePath !== undefined) void saveFile(activePath) }} />
        </div>
      </div>
    </div>
  )
}

/** Does an open tab path (absolute) match an absolute change path? */
function matchesPath(tabPath: string, absolutePath: string, _cwd: string | undefined): boolean {
  if (tabPath === absolutePath) return true
  const normTab = tabPath.replace(/\\/g, '/')
  const normAbs = absolutePath.replace(/\\/g, '/')
  return normTab === normAbs
}

/** Reveal and center one 1-based line, placing the cursor there. */
function revealLine(editor: import('monaco-editor').editor.ICodeEditor | null, line: number | undefined): void {
  if (editor === null || line === undefined || !Number.isFinite(line) || line < 1) return
  const position = { lineNumber: Math.floor(line), column: 1 }
  editor.setPosition(position)
  editor.revealLineInCenter(position.lineNumber)
}
