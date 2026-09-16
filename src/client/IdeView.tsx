import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icons } from './icons.js'
import { IDE_CSS_VARS, IDE_STYLES, defineDarkModernTheme } from './theme.js'
import { FileTree } from './explorer/FileTree.js'
import type { ExplorerHandle } from './explorer/FileTree.js'
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
import { installMonacoWorker } from './monacoWorkerBootstrap.js'

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
 * Configure Monaco's worker environment with the REAL editor worker: a
 * Blob-URL instantiation of the worker bundle embedded in this client chunk
 * (see monacoWorkerBootstrap.ts / scripts/build-monaco-worker.mjs). Monaco
 * computes diff-editor changes inside the EditorWorkerService worker; with the
 * previous no-op worker the diff never completed and the git diff view showed
 * no add/remove region highlighting. Monarch tokenization keeps running on the
 * main thread either way.
 */
function configureMonacoWorkers(): void {
  installMonacoWorker()
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
 * Workspace-scoped editor persistence: tabs, the active tab, and the open git
 * diff are keyed by the workspace root (cwd), not the session, so switching
 * sessions that share a workspace keeps the editor's open state, and returning
 * to a workspace restores it after the view ring remounts the component. The
 * Monaco models and saved baselines are already path-keyed at module level, so
 * only this view state needs parking here.
 */
const workspaceTabs = new Map<string, {
  tabs: OpenTab[]
  activePath: string | undefined
  /** Open git-diff path, so the diff overlay survives a remount like the tabs. */
  diffPath: string | undefined
}>()

/**
 * Session-scoped terminal-dock persistence: the dock's open flag, the live
 * host-side terminal IDs, and the selected tab. Switching to the conversation
 * (and back) remounts the view, but the shells keep running on the host and
 * terminalOutput replays their buffered output — so parking just the IDs is
 * enough to restore the dock exactly as the user left it. Keyed by session
 * (terminal IDs are session-scoped on the host), unlike the workspace-keyed
 * editor tabs.
 */
const sessionTerminals = new Map<string, { open: boolean; ids: string[]; activeIdx: number }>()

/** The activity bar's selectable sidebar panels. */
type SidebarView = 'explorer' | 'search' | 'git'

/**
 * Last activity-bar selection, module-level so the view ring's remounts (and a
 * session switch) reopen the IDE on the panel the user picked last instead of
 * snapping back to Explorer. Same lifetime as workspaceTabs: it survives
 * remounts within the page and resets with a full page reload.
 */
let lastSidebarView: SidebarView = 'explorer'

// ── Sidebar width (drag the right-edge grip to resize) ──────────────────
/** Bounds mirror the CSS min/max-width on .ide-sidebar. */
const SIDEBAR_WIDTH_MIN = 170
const SIDEBAR_WIDTH_MAX = 560
const SIDEBAR_WIDTH_DEFAULT = 240
const SIDEBAR_WIDTH_KEY = 'dsh-ide.sidebar-width'

function clampSidebarWidth(px: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)))
}

/** Last sidebar width. Module-level so view-ring remounts keep it; seeded from
 * localStorage so it survives page reloads (wrapped — storage may be denied). */
let sidebarWidth: number = (() => {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (raw === null) return SIDEBAR_WIDTH_DEFAULT
    const n = Number(raw)
    return Number.isFinite(n) ? clampSidebarWidth(n) : SIDEBAR_WIDTH_DEFAULT
  } catch {
    return SIDEBAR_WIDTH_DEFAULT
  }
})()

function persistSidebarWidth(px: number): void {
  try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(px)) } catch { /* ignore */ }
}

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

/** Image MIME type for a path whose extension is browser-renderable, else null. */
function imageMimeOf(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  switch (path.slice(dot + 1).toLowerCase()) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'ico': return 'image/x-icon'
    case 'avif': return 'image/avif'
    case 'svg': return 'image/svg+xml'
    default: return null
  }
}

interface OpenFileResult {
  text: string
  version: string
  truncated: boolean
  lines: number
  error: string | null
  /** Data URI when the path is an image (text/truncated fields stay empty). */
  imageSrc?: string
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
  // Images render as <img>, not Monaco text. readAll returns raw bytes as
  // base64 with no text/binary rejection, so it doubles as the image reader.
  const mime = imageMimeOf(path)
  if (mime) {
    const imgRes: RemoteResult<WorkspaceFileBytes> = await wf.readAll(sessionId, path, signal)
    if (!imgRes.ok) return { text: '', version: stat.version, truncated: false, lines: 0, error: resultError(imgRes) }
    return {
      text: '', version: imgRes.value.version, truncated: false, lines: 0, error: null,
      imageSrc: `data:${mime};base64,${imgRes.value.data}`,
    }
  }
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
  const { sessionId, cwd, workspaceFiles, workspaceFilesWrite, model } = props
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
  /** Which sidebar panel the activity bar selected; seeded from the last mount. */
  const [sidebarView, setSidebarViewState] = useState<SidebarView>(lastSidebarView)
  /** Select a panel and remember it, so the next IDE mount reopens it. */
  const setSidebarView = useCallback((view: SidebarView) => {
    lastSidebarView = view
    setSidebarViewState(view)
  }, [])
  /** The sidebar's right-edge resize grip. */
  const sidebarResizerRef = useRef<HTMLDivElement | null>(null)
  /** Write a new width into the module state + the root CSS variable and
   *  persist it. The variable (not React state) drives layout so a drag never
   *  re-renders the whole view per mousemove. */
  const applySidebarWidth = useCallback((px: number) => {
    sidebarWidth = clampSidebarWidth(px)
    const root = sidebarResizerRef.current?.closest('.ide-root') as HTMLElement | null
    root?.style.setProperty('--ide-sidebar-width', String(sidebarWidth) + 'px')
    persistSidebarWidth(sidebarWidth)
  }, [])
  /** mousedown on the grip: track the pointer, resize live, restore on release. */
  const startSidebarResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    const startX = e.clientX
    const startWidth = sidebarWidth
    handle.dataset.dragging = 'true'
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent): void => {
      applySidebarWidth(startWidth + (ev.clientX - startX))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      delete handle.dataset.dragging
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [applySidebarWidth])
  /** Double-click the grip: reset to the default width. */
  const resetSidebarWidth = useCallback(() => {
    applySidebarWidth(SIDEBAR_WIDTH_DEFAULT)
  }, [applySidebarWidth])
  /** Path whose git diff is shown in the editor area (overrides normal tabs).
   *  Seeded from the parked workspace state so a remount keeps it open. */
  const [diffPath, setDiffPath] = useState<string | undefined>(() => {
    const key = storeKeyOf(cwd)
    return key === null ? undefined : workspaceTabs.get(key)?.diffPath
  })
  /** Git status entries for coloring file tree names. Fetched when explorer view is active. */
  const [gitEntries, setGitEntries] = useState<readonly import('./types.js').GitStatusEntry[] | undefined>(undefined)
  /** Bottom terminal dock: open flag + terminal identities. Seeded from the
   *  session-parked state so a remount (chat ↔ IDE tab switch) reopens the
   *  dock with the same still-running host-side terminals. */
  const [terminalOpen, setTerminalOpen] = useState(() =>
    sessionId !== undefined && sessionTerminals.get(sessionId)?.open === true)
  const [terminalIds, setTerminalIds] = useState<string[]>(() =>
    sessionId === undefined ? [] : (sessionTerminals.get(sessionId)?.ids ?? []))
  const [activeTerminalIdx, setActiveTerminalIdx] = useState(() =>
    sessionId === undefined ? 0 : (sessionTerminals.get(sessionId)?.activeIdx ?? 0))
  /** Fast per-path dirty mirror so the Monaco content listener can bail before touching React state. */
  const dirtyRef = useRef<Set<string>>(new Set())
  /** Imperative handle into the explorer tree (header action buttons). */
  const explorerRef = useRef<ExplorerHandle | null>(null)
  /** Bumped by the explorer's refresh button to force an immediate git status refetch. */
  const [gitRefreshKey, setGitRefreshKey] = useState(0)

  // Inject the stylesheet + CSS vars once.
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = IDE_STYLES
    document.head.appendChild(style)
    const root = containerRef.current?.closest('.ide-root') as HTMLElement | null
    if (root) {
      for (const [k, v] of Object.entries(IDE_CSS_VARS)) root.style.setProperty(k, v)
      // Restore the user's last sidebar width (drag the right-edge grip).
      root.style.setProperty('--ide-sidebar-width', String(sidebarWidth) + 'px')
    }
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
  /** Data URI backing the active image tab, when it is an image. */
  const activeImageSrc = activeTab?.kind === 'image' ? activeTab.imageSrc : undefined

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
    setDiffPath(parked?.diffPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  // Park the current editor state whenever it changes, so remounts and
  // workspace switches always read back the freshest state.
  useEffect(() => {
    const key = storeKeyOf(cwd)
    if (key === null) return
    workspaceTabs.set(key, { tabs, activePath, diffPath })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, tabs, activePath, diffPath])

  // Terminal dock restore: re-apply this session's parked dock state on mount
  // and after a session switch. Declared BEFORE the park effect so a session
  // switch reads the target session's state before anything clobbers it (same
  // ordering guarantee as the workspace tab restore above).
  useEffect(() => {
    if (sessionId === undefined) return
    const parked = sessionTerminals.get(sessionId)
    setTerminalOpen(parked?.open ?? false)
    setTerminalIds(parked?.ids ?? [])
    setActiveTerminalIdx(parked?.activeIdx ?? 0)
  }, [sessionId])

  // Terminal dock park: keep the freshest dock state parked so remounts
  // (switching to the conversation and back) restore it verbatim. The shells
  // themselves keep running on the host; re-attaching replays their output.
  useEffect(() => {
    if (sessionId === undefined) return
    sessionTerminals.set(sessionId, { open: terminalOpen, ids: terminalIds, activeIdx: activeTerminalIdx })
  }, [sessionId, terminalOpen, terminalIds, activeTerminalIdx])

  const openFile = useCallback(async (path: string, line?: number) => {
    if (!sessionId) return
    const isImage = imageMimeOf(path) !== null
    // Already open?
    const existing = tabs.find((t) => t.path === path)
    if (existing && existing.status === 'ready') {
      setActivePath(path)
      // Image tabs render from their data URI; there is no Monaco model to attach.
      if (existing.kind === 'image') return
      const model = ideEditor.models.get(path)
      if (model && editorRef.current) {
        editorRef.current.setModel(model)
        revealLine(editorRef.current, line)
      }
      return
    }
    const name = path.split('/').pop() ?? path
    const language = isImage ? 'image' : detectLanguage(path)
    const loadingTab: OpenTab = { path, name, language, version: '', truncated: false, lines: 0, status: 'loading', error: null, dirty: false, kind: isImage ? 'image' : 'text' }
    setTabs((prev) => {
      const next = prev.some((t) => t.path === path) ? prev.map((t) => t.path === path ? loadingTab : t) : [...prev, loadingTab]
      return next
    })
    setActivePath(path)
    const ctrl = new AbortController()
    const result = await loadFileContent(workspaceFiles, sessionId, path, ctrl.signal)
    if (ctrl.signal.aborted) return
    if (result.error) {
      const errTab: OpenTab = { path, name, language, version: result.version, truncated: false, lines: 0, status: 'error', error: result.error, dirty: false, kind: isImage ? 'image' : 'text' }
      setTabs((prev) => prev.map((t) => t.path === path ? errTab : t))
      return
    }
    // Image tab: keep the data URI on the tab and let the <img> overlay render it.
    if (result.imageSrc) {
      const imageTab: OpenTab = { path, name, language: 'image', version: result.version, truncated: false, lines: 0, status: 'ready', error: null, dirty: false, kind: 'image', imageSrc: result.imageSrc }
      setTabs((prev) => prev.map((t) => t.path === path ? imageTab : t))
      return
    }
    const m = await loadMonaco()
    const model = createOrReuseModel(m, path, result.text, language)
    ideEditor.models.set(path, model)
    ideEditor.saved.set(path, result.text)
    dirtyRef.current.delete(path)
    const readyTab: OpenTab = { path, name, language, version: result.version, truncated: result.truncated, lines: result.lines, status: 'ready', error: null, dirty: false, kind: 'text' }
    setTabs((prev) => prev.map((t) => t.path === path ? readyTab : t))
    // openFile always activates the opened tab, so attach the model right away.
    // (Do NOT test activePath here: the closure captured it before the click's
    // setActivePath re-render, so it would be stale and skip the setModel.)
    editorRef.current?.setModel(model)
    revealLine(editorRef.current, line)
  }, [sessionId, tabs, workspaceFiles, activePath])

  /**
   * A source-control discard reverted one or more paths on disk. Close the diff
   * overlay when it shows a discarded path (the diff is now empty) and reload
   * any open editor buffer for a discarded path: the model still holds the
   * pre-discard text and its saved baseline is stale, so leaving it as-is would
   * let a stray Ctrl+S write the discarded edits right back over HEAD.
   */
  const handleChangesDiscarded = useCallback((paths: readonly string[]) => {
    setDiffPath((current) => (current !== undefined && paths.includes(current) ? undefined : current))
    void (async () => {
      for (const path of paths) {
        const model = ideEditor.models.get(path)
        if (!model) continue
        const ctrl = new AbortController()
        const result = await loadFileContent(workspaceFiles, sessionId, path, ctrl.signal)
        if (ctrl.signal.aborted || result.error || result.imageSrc !== undefined) continue
        // Refresh the saved baseline BEFORE setValue: the model-content listener
        // recomputes the dirty flag synchronously on setValue and must see the
        // reverted text as the new baseline.
        ideEditor.saved.set(path, result.text)
        model.setValue(result.text)
        dirtyRef.current.delete(path)
        setTabs((prev) => prev.map((tb) => tb.path === path ? { ...tb, dirty: false, truncated: result.truncated, lines: result.lines } : tb))
      }
    })()
  }, [sessionId, workspaceFiles])

  // Apply model switch when activePath changes. Truncated views stay read-only:
  // saving a truncated page would write the truncated text and lose the tail.
  useEffect(() => {
    if (!editorRef.current || !monacoReady) return
    const tab = tabs.find((t) => t.path === activePath)
    // Image tabs (and the no-tab state) have no Monaco model: detach so a stale
    // text model never shows through the image / empty overlay.
    if (activePath === undefined || tab?.kind === 'image') { editorRef.current.setModel(null); return }
    const model = ideEditor.models.get(activePath)
    if (model) editorRef.current.setModel(model)
    editorRef.current.updateOptions({ readOnly: tab?.truncated === true })
  }, [activePath, monacoReady, tabs])

  const closeTabNow = useCallback((path: string) => {
    // Detach the editor before disposing the model: Monaco keeps rendering the
    // attached model, and disposing it in place can throw on the next frame and
    // leave the editor unable to attach a fresh model (reopen appeared broken).
    const closing = ideEditor.models.get(path)
    if (closing && editorRef.current?.getModel() === closing) editorRef.current.setModel(null)
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

  // Explorer renamed a file/folder: close affected tabs and reopen them under
  // the new path (content is re-read from disk; saved baselines follow).
  const handleFileRenamed = useCallback((oldAbs: string, newAbs: string) => {
    setDiffPath((current) => (current !== undefined && (current === oldAbs || current.startsWith(oldAbs + '/')) ? undefined : current))
    const affected = tabs.filter((tb) => tb.path === oldAbs || tb.path.startsWith(oldAbs + '/'))
    void (async () => {
      for (const tb of affected) {
        closeTabNow(tb.path)
        await openFile(newAbs + tb.path.slice(oldAbs.length))
      }
    })()
  }, [tabs, setDiffPath, closeTabNow, openFile])

  // Explorer deleted a file/folder: drop its diff and close its tab(s) without
  // prompting (the user explicitly removed the file).
  const handleFileDeleted = useCallback((abs: string) => {
    setDiffPath((current) => (current !== undefined && (current === abs || current.startsWith(abs + '/')) ? undefined : current))
    for (const tb of tabs) {
      if (tb.path === abs || tb.path.startsWith(abs + '/')) closeTabNow(tb.path)
    }
  }, [tabs, setDiffPath, closeTabNow])

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
  }, [sessionId, cwd, ideTools, gitRefreshKey])

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
    const ctrl = new AbortController()
    const result = await loadFileContent(workspaceFiles, sessionId, path, ctrl.signal)
    if (ctrl.signal.aborted || result.error) return
    // Changed image: swap the data URI on the existing tab, no model involved.
    if (result.imageSrc) {
      setTabs((prev) => prev.map((t) => t.path === path ? { ...t, kind: 'image' as const, imageSrc: result.imageSrc, version: result.version, truncated: false, lines: 0, status: 'ready' as const, error: null, dirty: false } : t))
      return
    }
    const m = await loadMonaco()
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

  // Terminal-panel callbacks kept stable: an inline closure changed identity on
  // every IdeView render, which made the panel's auto-open effect re-run while
  // its open round-trip was still in flight (one click → several shells).
  const handleTerminalOpened = useCallback((id: string) => {
    setTerminalIds((prev) => prev.includes(id) ? prev : [...prev, id])
  }, [])
  const handleTerminalClosed = useCallback((idx: number) => {
    const next = terminalIds.filter((_, i) => i !== idx)
    setTerminalIds(next)
    if (next.length === 0) setTerminalOpen(false)
    setActiveTerminalIdx((active) => Math.min(active, Math.max(0, next.length - 1)))
  }, [terminalIds])
  const handleTerminalClose = useCallback(() => { setTerminalOpen(false) }, [])

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
                  // The diff overlays the editor area, so the underlying Monaco
                  // host stays attached and closing the diff returns to the
                  // previously active file untouched.
                  setDiffPath(path)
                }}
                onChangesDiscarded={handleChangesDiscarded}
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
              <div className="ide-sidebar-header">
                <span>{t('explorer.title')}</span>
                {/* VS Code-style title actions, revealed while the pointer is over the sidebar. */}
                <div className="ide-header-actions">
                  <button
                    className="ide-header-action"
                    title={t('explorer.newFile')}
                    aria-label={t('explorer.newFile')}
                    data-testid="ide-explorer-new-file"
                    onClick={() => explorerRef.current?.startCreate('file')}
                  >{Icons.newFile}</button>
                  <button
                    className="ide-header-action"
                    title={t('explorer.newFolder')}
                    aria-label={t('explorer.newFolder')}
                    data-testid="ide-explorer-new-folder"
                    onClick={() => explorerRef.current?.startCreate('directory')}
                  >{Icons.newFolder}</button>
                  <button
                    className="ide-header-action"
                    title={t('explorer.refresh')}
                    aria-label={t('explorer.refresh')}
                    data-testid="ide-explorer-refresh"
                    onClick={() => { explorerRef.current?.refresh(); setGitRefreshKey((k) => k + 1) }}
                  >{Icons.refresh}</button>
                  <button
                    className="ide-header-action"
                    title={t('explorer.collapseAll')}
                    aria-label={t('explorer.collapseAll')}
                    data-testid="ide-explorer-collapse-all"
                    onClick={() => explorerRef.current?.collapseAll()}
                  >{Icons.chevronDown}</button>
                </div>
              </div>
              {sessionId && cwd ? (
                <FileTree
                  ref={explorerRef}
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
                  ideToolsFull={ideTools}
                  onFileRenamed={handleFileRenamed}
                  onFileDeleted={handleFileDeleted}
                />
              ) : (
                <div className="ide-tree-loading">{sessionId ? t('tree.loading') : t('empty.noSession')}</div>
              )}
            </>
          )}
          {/* Right-edge resize grip (hover shows a handle icon; drag resizes). */}
          <div
            ref={sidebarResizerRef}
            className="ide-sidebar-resizer"
            title={t('sidebar.resize')}
            onMouseDown={startSidebarResize}
            onDoubleClick={resetSidebarWidth}
            data-testid="ide-sidebar-resizer"
          >
            <span className="ide-sidebar-resizer-icon">{Icons.splitEditor}</span>
          </div>
        </div>
        <div className="ide-editor-area">
          <TabBar tabs={tabs} active={activePath} onSelect={setActivePath} onClose={closeTab} t={t} />
          {/* The stack spans exactly the editor region (tab bar → panel dock →
              status bar). Everything below is absolutely positioned INSIDE it,
              so the git diff can never paint over the terminal dock — the dock
              is a flow sibling of the stack (VS Code layout: the panel always
              sits at the bottom, the editor area shrinks above it). */}
          <div className="ide-editor-stack">
          {/* Monaco owns this container exclusively; React never renders children
              into it so reconciliation can never remove the editor DOM. It stays
              mounted at all times — the diff and image views are overlays — so
              the singleton editor host is never detached from a dead node (which
              is what made files stop opening after a diff was shown). */}
          <div className="ide-editor-container" ref={containerRef} />
          {activeImageSrc && (
            <div className="ide-editor-image">
              <img src={activeImageSrc} alt={activeTab?.name ?? ''} />
            </div>
          )}
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
          {diffPath && (
            <DiffEditor
              sessionId={sessionId}
              cwd={cwd}
              ideTools={ideTools}
              workspaceFiles={workspaceFiles}
              path={diffPath}
              name={diffPath.split('/').pop() ?? diffPath}
              onClose={() => setDiffPath(undefined)}
              t={t}
            />
          )}
          </div>
          {terminalOpen && sessionId && (
            <TerminalPanel
              sessionId={sessionId}
              ideTools={ideTools}
              terminalIds={terminalIds}
              activeIdx={activeTerminalIdx}
              onTerminalOpened={handleTerminalOpened}
              onActiveChange={setActiveTerminalIdx}
              onTerminalClosed={handleTerminalClosed}
              onClose={handleTerminalClose}
              t={t}
            />
          )}
          <StatusBar activeTab={activeTab} cursor={cursor} t={t} saveState={saveState} onSave={() => { if (activePath !== undefined) void saveFile(activePath) }} model={model} />
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
