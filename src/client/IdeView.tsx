import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Icons } from './icons.js'
import { IDE_STYLES, defineIdeThemes, cssVarsForTheme, monacoThemeFor } from './theme.js'
import { FileTree } from './explorer/FileTree.js'
import type { ExplorerHandle } from './explorer/FileTree.js'
import { SearchPanel } from './search/SearchPanel.js'
import { SourceControlPanel, type ScmOpenViews } from './git/SourceControlPanel.js'
import { DiffEditor } from './git/DiffEditor.js'
import { TerminalPanel } from './terminal/TerminalPanel.js'
import { TabBar } from './editor/TabBar.js'
import { StatusBar } from './editor/StatusBar.js'
import { MarkdownPreview } from './editor/MarkdownPreview.js'
import { isMarkdownPath } from './editor/markdown.js'
import { decodeFile, encodeText, type TextEncoding } from './editor/encoding.js'
import { ContextMenuHost } from './ContextMenu.js'
import { showContextMenu } from './ContextMenu.js'
import { SettingsDialog, AboutDialog, KeybindingsDialog, SnippetsDialog, displayChord } from './SettingsDialogs.js'
import { CommandPalette } from './CommandPalette.js'
import { ExtensionsView } from './ExtensionsView.js'
import { ProblemsPanel, type ProblemItem } from './editor/ProblemsPanel.js'
import { ideCommands, type IdeCommand } from './commands.js'
import { ideSettings, ideKeybindings, ideSnippets, applyEditorOptions, chordMatches, eventToChord } from './settingsStore.js'
import { notifications } from './notifications.js'
import type { OpenTab } from './editor/TabBar.js'
import { detectLanguage } from './language.js'
import type { IdeViewInjected, RemoteResult, WorkspaceFileBytes, WorkspaceFileStat, WorkspaceFileText } from './types.js'
import { publishActiveFile, registerIdeMount, syncSidebarHighlight, takePendingOpenPath, unregisterIdeMount } from './sidebarBridge.js'
import { installMonacoWorker } from './monacoWorkerBootstrap.js'
import { installCodiconFont } from './codiconFontBootstrap.js'

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
  // Monaco's internal UI icons (find widget, suggest, folding) draw through
  // the codicon webfont the bundle neutralizes — re-inject it inlined.
  installCodiconFont()
}

function loadMonaco(): Promise<MonacoNS> {
  if (!monacoLoaded) {
    configureMonacoWorkers()
    defineIdeThemes(Monaco)
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
 * The git diff shown in the editor area: a working-tree path diff (the
 * Source Control changes list), or one file inside a specific commit
 * (Source Control graph → commit details → file). sha set = commit diff.
 */
interface IdeDiffTarget {
  path: string
  /** Previous path for commit renames/copies. */
  oldPath?: string
  /** Commit hash; undefined = working-tree diff. */
  sha?: string
  /** 'staged' = index vs HEAD diff (the Staged Changes group's click). */
  diffKind?: 'staged'
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
  /** Open git-diff target, so the diff overlay survives a remount like the tabs. */
  diffPath: IdeDiffTarget | undefined
  /** Whether the markdown split preview is open for this workspace. */
  mdPreview: boolean
}>()

/**
 * Session-scoped terminal-dock persistence: the dock's open flag, the live
 * host-side terminal IDs, and the selected tab. Switching to the conversation
 * (and back) remounts the view, but the shells keep running on the host and
 * terminalOutput replays their buffered output — so parking just the IDs is
 * enough to restore the dock exactly as the user left it. Keyed by session
 * (terminal IDs are session-scoped on the host), unlike the workspace-keyed
 * editor tabs.
 *
 * Parked on window (not a module-level const) so the state survives a plugin
 * hot-reload: pnpm run bundle / npm publish's prepublishOnly rebuilds lib/,
 * DSH detects the change and re-evaluates the client module, and a module-level
 * Map would reset to empty, closing the terminal dock mid-command (e.g. while
 * npm publish waits for ENTER). The window slot outlives the module
 * re-evaluation, so the dock reopens with the same still-running terminals.
 */
const __win = window as unknown as { __dshIdeSessionTerminals?: Map<string, { open: boolean; ids: string[]; activeIdx: number }> }
const sessionTerminals: Map<string, { open: boolean; ids: string[]; activeIdx: number }> =
  __win.__dshIdeSessionTerminals ??= new Map()

/** Whether two git status entry lists render identically. Used to skip state
 *  writes when a background refresh found nothing new — no write means no
 *  re-render and no flicker (VS Code updates decorations in place, never
 *  re-rendering the whole workbench). */
function sameGitEntries(a: readonly import('./types.js').GitStatusEntry[] | undefined, b: readonly import('./types.js').GitStatusEntry[]): boolean {
  if (a === undefined || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.path !== y.path || x.kind !== y.kind || x.statusCode !== y.statusCode || x.oldPath !== y.oldPath) return false
  }
  return true
}

/** Plugin version for the About dialog (package.json version, inlined at build). */
const IDE_VERSION = '0.1.3'

/** The activity bar's selectable sidebar panels. */
type SidebarView = 'explorer' | 'search' | 'git' | 'extensions'

/**
 * Last activity-bar selection, module-level so the view ring's remounts (and a
 * session switch) reopen the IDE on the panel the user picked last. First open
 * of the IDE tab defaults to 源代码管理 (git) — the SCM workbench is the
 * primary surface, matching how the user enters the IDE. Same lifetime as
 * workspaceTabs: it survives remounts within the page and resets with a full
 * page reload.
 */
let lastSidebarView: SidebarView = 'git'

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

/** Decode a UTF-8 byte view to a string. readBytes returns native bytes now. */
function decodeText(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data)
}

/** Encode native bytes to a base64 string (for image data URIs). */
function bytesToBase64(data: Uint8Array): string {
  let bin = ''
  const len = data.byteLength
  for (let i = 0; i < len; i++) bin += String.fromCharCode(data[i])
  return btoa(bin)
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
  /** Data URI when the path is an image or PDF (text/truncated fields stay empty). */
  imageSrc?: string
  /** Detected encoding of a text file, for the status bar. */
  encoding?: TextEncoding
  /** False when the editor cannot re-encode this file faithfully. */
  encodingLossless?: boolean
}

/** Binary preview formats: images render in <img>, PDF in an <iframe>. */
function binaryMimeOf(path: string): { mime: string; kind: 'image' | 'pdf' } | null {
  const image = imageMimeOf(path)
  if (image !== null) return { mime: image, kind: 'image' }
  if (path.toLowerCase().endsWith('.pdf')) return { mime: 'application/pdf', kind: 'pdf' }
  return null
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
  // Images render as <img>, PDFs in an <iframe>, never as Monaco text.
  // readBytes returns raw bytes (Uint8Array) with no text/binary rejection, so
  // it doubles as the binary reader.
  const binary = binaryMimeOf(path)
  if (binary !== null) {
    const imgRes: RemoteResult<WorkspaceFileBytes> = await wf.readBytes(sessionId, path, {}, signal)
    if (!imgRes.ok) return { text: '', version: stat.version, truncated: false, lines: 0, error: resultError(imgRes) }
    return {
      text: '', version: imgRes.value.version, truncated: false, lines: 0, error: null,
      imageSrc: `data:${binary.mime};base64,${bytesToBase64(imgRes.value.data)}`,
    }
  }
  if (stat.bytes !== undefined && stat.bytes > LARGE_FILE_BYTES) {
    const readRes: RemoteResult<WorkspaceFileText> = await wf.read(sessionId, path, { offset: 1, limit: TRUNCATED_LINES }, signal)
    if (!readRes.ok) return { text: '', version: stat.version, truncated: false, lines: 0, error: resultError(readRes) }
    const page = readRes.value
    // Do NOT append a marker into the text: it used to be written straight
    // into the Monaco model, so the buffer held a line that does not exist in
    // the file and selecting all + copy carried it along. The tab is marked
    // `truncated` instead, which makes it read-only and shows a banner.
    return {
      text: page.text, version: stat.version, truncated: !page.eof, lines: page.lines, error: null,
      encoding: 'utf-8', encodingLossless: false,
    }
  }
  const allRes: RemoteResult<WorkspaceFileBytes> = await wf.readBytes(sessionId, path, {}, signal)
  if (!allRes.ok) {
    // not-text or too-large: fall back to a line page if possible.
    if (allRes.error.code === 'workspace-file/not-text') {
      return { text: '', version: stat.version, truncated: false, lines: 0, error: 'not-text' }
    }
    return { text: '', version: stat.version, truncated: false, lines: 0, error: resultError(allRes) }
  }
  // Detect the real encoding instead of assuming UTF-8. A GBK/Latin-1 file
  // decoded as UTF-8 turns into mojibake AND, because that decode is lossy,
  // saving wrote the damaged text back and destroyed the original.
  const decoded = decodeFile(allRes.value.data)
  const lines = decoded.text === '' ? 0 : decoded.text.split('\n').length
  return {
    text: decoded.text, version: stat.version, truncated: false, lines, error: null,
    encoding: decoded.encoding, encodingLossless: decoded.lossless,
  }
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
  /** Monaco editor version string (About dialog). */
  const [monacoVersion, setMonacoVersion] = useState('')
  useEffect(() => { void loadMonaco().then(() => setMonacoVersion(String((Monaco as unknown as { version?: string }).version ?? '0.52'))) }, [])
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
   *  Seeded from the parked workspace state so a remount keeps it open. A
   *  legacy parked string (older build) normalizes to a worktree target. */
  const [diffPath, setDiffPath] = useState<IdeDiffTarget | undefined>(() => {
    const key = storeKeyOf(cwd)
    if (key === null) return undefined
    const parked = workspaceTabs.get(key)?.diffPath
    if (parked === undefined) return undefined
    return typeof parked === 'string' ? { path: parked } : parked
  })
  const diffPathRef = useRef<IdeDiffTarget | undefined>(diffPath)
  useEffect(() => { diffPathRef.current = diffPath }, [diffPath])
  /** Live diff-editor instance while the SCM diff overlay is open (reported by
   *  DiffEditor's onEditorReady). Used to drive find-in-file from the toolbar
   *  and the Ctrl/Cmd+F fallback — actions Monaco only binds while the editor
   *  itself has DOM focus. */
  const diffEditorRef = useRef<Monaco.editor.IDiffEditor | null>(null)
  /** Markdown split preview: open flag (parked per workspace), the live
   *  content feed from the Monaco model, and a manual-refresh nonce. */
  const [mdPreviewOpen, setMdPreviewOpen] = useState<boolean>(() => {
    const key = storeKeyOf(cwd)
    return key !== null && workspaceTabs.get(key)?.mdPreview === true
  })
  const [previewContent, setPreviewContent] = useState('')
  const [previewNonce, setPreviewNonce] = useState(0)
  const previewOpenRef = useRef(mdPreviewOpen)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  /** Git status entries for coloring file tree names. Fetched when explorer view is active. */
  const [gitEntries, setGitEntries] = useState<readonly import('./types.js').GitStatusEntry[] | undefined>(undefined)
  const gitEntriesRef = useRef<readonly import('./types.js').GitStatusEntry[] | undefined>(undefined)
  /** Current git branch name (HEAD short name) — shown in the status bar. */
  /** Monotonic token for openFile: a load that resolves after a NEWER open has
   *  started must not attach its model, or the editor would show file A while
   *  activePath is B and the next Ctrl+S would write A's text into B. */
  const openSeqRef = useRef(0)
  /** Paths with a write currently in flight. Ctrl+S is not debounced, so two
   *  quick presses used to fire two writes carrying the SAME stale version:
   *  the second always failed the version guard and popped the conflict dialog
   *  even though nothing had changed on disk. */
  const savingRef = useRef<Set<string>>(new Set())
  const [gitBranch, setGitBranch] = useState<string | undefined>(undefined)
  /** Detached HEAD: the short SHA to show where the branch name would be
   *  (VS Code parity — hiding the whole status-bar block lost the sync
   *  affordance entirely). */
  const [gitDetachedSha, setGitDetachedSha] = useState<string | undefined>(undefined)
  /** Deduped write path for git status: identical lists leave state untouched
   *  so background refreshes never re-render the view. */
  const applyGitEntries = useCallback((entries: readonly import('./types.js').GitStatusEntry[] | undefined) => {
    if (entries === undefined) {
      if (gitEntriesRef.current !== undefined) { gitEntriesRef.current = undefined; setGitEntries(undefined) }
      return
    }
    if (!sameGitEntries(gitEntriesRef.current, entries)) {
      gitEntriesRef.current = entries
      setGitEntries(entries)
    }
  }, [])
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
  /** Pending debounced push of the dirty set to the host cache. */
  const dirtyFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Imperative handle into the explorer tree (header action buttons). */
  const explorerRef = useRef<ExplorerHandle | null>(null)
  /** Bumped by the explorer's refresh button to force an immediate git status refetch. */
  const [gitRefreshKey, setGitRefreshKey] = useState(0)
  // Lifted SCM commit-message state: held by the view (not the panel) so that
  // switching the sidebar to the explorer and back — which unmounts/remounts
  // <SourceControlPanel> — does not wipe a typed or AI-generated message.
  const [scmCommitMessage, setScmCommitMessage] = useState('')
  /** Source Control views to force open (status bar → Branches). A fresh
   *  object per request so clicking twice after collapsing re-opens it. */
  const [scmOpenViewsRequest, setScmOpenViewsRequest] = useState<Partial<ScmOpenViews> | undefined>(undefined)
  /** Mirror of the Source Control panel's expanded views (reported by the
   *  panel) so the status-bar branch button can toggle Branches and show it
   *  as active. */
  const [scmOpenViews, setScmOpenViews] = useState<ScmOpenViews>({ changes: true, graph: false, branches: false })
  /** True while a status-bar / command git sync is running (spinner + guard). */
  const [gitSyncBusy, setGitSyncBusy] = useState(false)
  /** Sidebar position: left (default) or right. Toggled from the top-right
   *  panel-layout buttons (VS Code "Toggle Side Bar Position"). */
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)
  /** Which modal surface is open (settings suite + command palette). */
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [keybindingsOpen, setKeybindingsOpen] = useState(false)
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** Bottom panel tab: 'terminal' | 'problems'. */
  const [bottomTab, setBottomTab] = useState<'terminal' | 'problems'>('terminal')
  /** Mount point at the right end of the bottom tab row; TerminalPanel portals
   *  its action buttons into it so they live at the top-right of the bottom
   *  panel (same row as the 问题/终端 tabs) rather than in the terminal toolbar.
   *  Portal targets must be real DOM nodes and the ref is only populated after
   *  the first commit, so the ref callback mirrors the node into state to
   *  trigger the re-render that creates the portal. */
  const [bottomTabsActions, setBottomTabsActions] = useState<HTMLDivElement | null>(null)
  /** Monaco marker snapshot for the problems indicator + panel. */
  const [problems, setProblems] = useState<ProblemItem[]>([])
  const problemCounts = useMemo(() => {
    let errors = 0, warnings = 0
    for (const p of problems) { if (p.severity === 'error') errors++; else if (p.severity === 'warning') warnings++ }
    return { errors, warnings }
  }, [problems])
  const workspaceName = useMemo(() => cwd?.split('/').pop() || undefined, [cwd])
  /** Live settings snapshot (theme hot-apply etc.). */
  const settings = useSyncExternalStore(ideSettings.subscribe, ideSettings.getSnapshot)
  const keybindings = useSyncExternalStore(ideKeybindings.subscribe, ideKeybindings.getSnapshot)
  /** Active model language / indent / EOL for the status bar pickers. */
  const [modelLanguage, setModelLanguage] = useState<string | undefined>(undefined)
  const [modelIndent, setModelIndent] = useState<{ tabSize: number; insertSpaces: boolean } | undefined>(undefined)
  const [modelEol, setModelEol] = useState<'\n' | '\r\n' | undefined>(undefined)
  /** git ahead/behind for the status bar sync indicator. */
  const [gitAhead, setGitAhead] = useState<number | undefined>(undefined)
  const [gitBehind, setGitBehind] = useState<number | undefined>(undefined)
  /** Latest terminalIds mirror for task-launch tab indexing. */
  const terminalIdsRef = useRef(terminalIds)
  useEffect(() => { terminalIdsRef.current = terminalIds }, [terminalIds])
  /** Bumped on snippet-store changes so the completion provider re-registers. */
  const [snippetsVersion, setSnippetsVersion] = useState(0)

  // Inject the stylesheet + CSS vars once.
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = IDE_STYLES
    document.head.appendChild(style)
    const root = containerRef.current?.closest('.ide-root') as HTMLElement | null
    if (root) {
      for (const [k, v] of Object.entries(cssVarsForTheme(ideSettings.getSnapshot().theme))) root.style.setProperty(k, v)
      // Restore the user's last sidebar width (drag the right-edge grip).
      root.style.setProperty('--ide-sidebar-width', String(sidebarWidth) + 'px')
    }
    return () => { document.head.removeChild(style) }
  }, [])

  // Theme hot-apply: settings.theme changes re-write the CSS vars on the root
  // and switch the Monaco theme on the singleton editor + the diff editor.
  useEffect(() => {
    const root = containerRef.current?.closest('.ide-root') as HTMLElement | null
    if (root) {
      for (const [k, v] of Object.entries(cssVarsForTheme(settings.theme))) root.style.setProperty(k, v)
    }
    Monaco.editor.setTheme(monacoThemeFor(settings.theme))
  }, [settings.theme])
  // Editor-option hot-apply (font size, minimap, word wrap, ...).
  useEffect(() => {
    const ed = editorRef.current
    if (ed) applyEditorOptions(ed, settings)
  }, [settings])
  useEffect(() => ideSnippets.subscribe(() => setSnippetsVersion((v) => v + 1)), [])

  /** Collect every dirty buffer straight from the Monaco models. */
  const collectDirtyBuffers = useCallback((): Array<{ path: string; text: string }> => {
    const out: Array<{ path: string; text: string }> = []
    for (const path of dirtyRef.current) {
      const model = ideEditor.models.get(path)
      if (model !== undefined && !model.isDisposed()) out.push({ path, text: model.getValue() })
    }
    return out
  }, [])

  /**
   * Push the current dirty set to the host, coalescing bursts.
   *
   * The agent reads files from disk, so without this an unsaved edit is
   * invisible to it. Debounced rather than sent per keystroke, and always the
   * COMPLETE set: the host replaces its copy wholesale, so a save that empties
   * the set must reach it too (an empty array is a meaningful report).
   */
  const scheduleDirtyFlush = useCallback(() => {
    if (dirtyFlushTimerRef.current !== null) clearTimeout(dirtyFlushTimerRef.current)
    dirtyFlushTimerRef.current = setTimeout(() => {
      dirtyFlushTimerRef.current = null
      if (sessionId === undefined || ideTools === undefined) return
      void ideTools.pushDirtyBuffers(sessionId, collectDirtyBuffers())
    }, 400)
  }, [sessionId, ideTools, collectDirtyBuffers])
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
        // The markdown preview renders the live model value (debounced).
        if (isMarkdownPath(path) && previewOpenRef.current) {
          if (previewTimerRef.current !== null) clearTimeout(previewTimerRef.current)
          previewTimerRef.current = setTimeout(() => {
            previewTimerRef.current = null
            setPreviewContent(model.getValue())
          }, 150)
        }
        const saved = ideEditor.saved.get(path)
        const dirty = saved !== undefined && model.getValue() !== saved
        if (dirtyRef.current.has(path) === dirty) return
        if (dirty) dirtyRef.current.add(path)
        else dirtyRef.current.delete(path)
        setTabs((prev) => prev.map((t) => t.path === path ? { ...t, dirty } : t))
        // Mirror the change into the host's dirty-buffer cache so the agent
        // can see edits that are not on disk yet. Debounced: this runs on the
        // dirty TRANSITION only, but a burst of edits across several tabs still
        // collapses into one push.
        scheduleDirtyFlush()
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
  /** The active tab is a fully-loaded markdown document → preview available. */
  const activeIsMd = activeTab !== undefined && activeTab.status === 'ready' && activeTab.kind === 'text' && isMarkdownPath(activeTab.path)

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
    setMdPreviewOpen(parked?.mdPreview === true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  // Park the current editor state whenever it changes, so remounts and
  // workspace switches always read back the freshest state.
  useEffect(() => {
    const key = storeKeyOf(cwd)
    if (key === null) return
    workspaceTabs.set(key, { tabs, activePath, diffPath, mdPreview: mdPreviewOpen })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, tabs, activePath, diffPath, mdPreviewOpen])

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

  // Dirty-buffer mirror: keep the host cache in step with this session's
  // editor. Fires on session switch (clears the previous session's stale
  // entry by pushing this session's set) and on unmount (clears the cache so
  // a parked IDE does not keep claiming unsaved edits).
  useEffect(() => {
    if (sessionId === undefined || ideTools === undefined) return
    scheduleDirtyFlush()
    return () => {
      // Clear BOTH: the pending debounce must not fire after teardown, and the
      // host must not keep a dirty report for a view that is gone. Emptying is
      // correct — a parked IDE holds no live buffers to report.
      if (dirtyFlushTimerRef.current !== null) {
        clearTimeout(dirtyFlushTimerRef.current)
        dirtyFlushTimerRef.current = null
      }
      void ideTools.pushDirtyBuffers(sessionId, [])
    }
  }, [sessionId, ideTools, scheduleDirtyFlush])
  const openFile = useCallback(async (path: string, line?: number) => {
    if (!sessionId) return
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
    // PDFs are binary previews too: they must be classified as such from the
    // very first render. Treating the placeholder as text mounted an empty
    // Monaco model that covered the pane, so a PDF opened to a blank panel
    // until (and unless) the ready tab replaced it.
    const binary = binaryMimeOf(path)
    const isImage = binary?.kind === 'image'
    const language = binary === null ? detectLanguage(path) : (isImage ? 'image' : 'pdf')
    const loadingTab: OpenTab = { path, name, language, version: '', truncated: false, lines: 0, status: 'loading', error: null, dirty: false, kind: binary === null ? 'text' : 'image' }
    setTabs((prev) => {
      const next = prev.some((t) => t.path === path) ? prev.map((t) => t.path === path ? loadingTab : t) : [...prev, loadingTab]
      return next
    })
    setActivePath(path)
    activePathRef.current = path
    // A newer openFile supersedes this one: its token differs, so its result is
    // dropped instead of hijacking the editor (and the save target) of the file
    // the user actually clicked last.
    const mySeq = ++openSeqRef.current
    const stillWanted = (): boolean => mySeq === openSeqRef.current && activePathRef.current === path
    const ctrl = new AbortController()
    const result = await loadFileContent(workspaceFiles, sessionId, path, ctrl.signal)
    if (ctrl.signal.aborted) return
    if (!stillWanted()) return
    if (result.error) {
      const errTab: OpenTab = { path, name, language, version: result.version, truncated: false, lines: 0, status: 'error', error: result.error, dirty: false, kind: isImage ? 'image' : 'text' }
      setTabs((prev) => prev.map((t) => t.path === path ? errTab : t))
      return
    }
    // Image / PDF tab: keep the data URI on the tab and let the overlay
    // render it (<img> for images, <iframe> for PDF).
    if (result.imageSrc) {
      const isPdf = path.toLowerCase().endsWith('.pdf')
      const imageTab: OpenTab = {
        path, name, language: isPdf ? 'pdf' : 'image', version: result.version, truncated: false, lines: 0,
        status: 'ready', error: null, dirty: false, kind: 'image', imageSrc: result.imageSrc,
      }
      setTabs((prev) => prev.map((t) => t.path === path ? imageTab : t))
      return
    }
    const m = await loadMonaco()
    if (!stillWanted()) return
    const model = createOrReuseModel(m, path, result.text, language)
    ideEditor.models.set(path, model)
    ideEditor.saved.set(path, result.text)
    dirtyRef.current.delete(path)
    const readyTab: OpenTab = {
      path, name, language, version: result.version, truncated: result.truncated, lines: result.lines,
      status: 'ready', error: null, dirty: false, kind: 'text',
      encoding: result.encoding, encodingLossless: result.encodingLossless,
    }
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
    setDiffPath((current) => (current !== undefined && paths.includes(current.path) ? undefined : current))
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
    // Read-only when the view is truncated (saving it would drop the tail) or
    // when the file's encoding cannot be reproduced (a UTF-8 write-back would
    // corrupt every non-ASCII byte). Disabling save alone was not enough: the
    // user could still edit and then hit the interlock only at save time.
    editorRef.current.updateOptions({ readOnly: tab?.truncated === true || tab?.encodingLossless === false })
  }, [activePath, monacoReady, tabs])

  // Keep the preview feed in step with the open flag / active markdown tab.
  useEffect(() => {
    previewOpenRef.current = mdPreviewOpen
    if (!mdPreviewOpen || !monacoReady) return
    if (activePath === undefined || !isMarkdownPath(activePath)) return
    const model = ideEditor.models.get(activePath)
    if (model) setPreviewContent(model.getValue())
  }, [mdPreviewOpen, monacoReady, activePath, tabs])

  // VS Code parity: scrolling the editor scrolls the preview proportionally
  // (one-way sync, editor → preview).
  useEffect(() => {
    if (!mdPreviewOpen || !monacoReady || !activeIsMd) return
    const editor = editorRef.current
    if (editor === null) return
    const d = editor.onDidScrollChange((e) => {
      const el = previewScrollRef.current
      if (el === null) return
      const layout = editor.getLayoutInfo()
      const srcRange = e.scrollHeight - layout.height
      const dstRange = el.scrollHeight - el.clientHeight
      el.scrollTop = srcRange > 0 ? (e.scrollTop / srcRange) * dstRange : 0
    })
    return () => { d.dispose() }
  }, [mdPreviewOpen, monacoReady, activeIsMd])

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
    setDiffPath((current) => (current !== undefined && (current.path === oldAbs || current.path.startsWith(oldAbs + '/')) ? undefined : current))
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
    setDiffPath((current) => (current !== undefined && (current.path === abs || current.path.startsWith(abs + '/')) ? undefined : current))
    for (const tb of tabs) {
      if (tb.path === abs || tb.path.startsWith(abs + '/')) closeTabNow(tb.path)
    }
  }, [tabs, setDiffPath, closeTabNow])

  // Subscribe to file changes; refresh open files whose version changed.
  useEffect(() => {
    if (!sessionId) return
    const ctrl = new AbortController()
    let cancelled = false
    // Throttled SCM refresh: a burst of writes (an agent editing many files)
    // triggers one git status refetch, not one per frame.
    let bumpTimer: ReturnType<typeof setTimeout> | undefined
    const bumpGit = () => {
      if (bumpTimer !== undefined) return
      bumpTimer = setTimeout(() => { bumpTimer = undefined; setGitRefreshKey((k) => k + 1) }, 1000)
    }
    // Throttled Explorer tree refresh: an agent editing/deleting/creating
    // files externally should update the tree, not just the SCM badge.
    let treeTimer: ReturnType<typeof setTimeout> | undefined
    const bumpTree = () => {
      if (treeTimer !== undefined) return
      treeTimer = setTimeout(() => { treeTimer = undefined; explorerRef.current?.refresh() }, 1000)
    }
    ;(async () => {
      try {
        for await (const frame of workspaceFiles.changes(sessionId, cwd ?? '', ctrl.signal)) {
          if (cancelled || frame.kind !== 'change') continue
          const absPath = frame.change.absolutePath
          // Every workspace write can flip the SCM badge and the change
          // groups (VS Code reacts to every external write too) — bump the
          // throttled git refresh for each change frame, not only open-tab
          // hits; deletions included. The 1s throttle keeps bursts cheap.
          bumpGit()
          bumpTree()
          // Match by absolute path or relative path against open tabs.
          const hit = tabsRef.current.find((t) => matchesPath(t.path, absPath, cwd))
          const newVersion = 'version' in frame.change ? frame.change.version : undefined
          if ('absent' in frame.change) {
            // Externally deleted: close a matching tab / diff overlay so a
            // stale buffer is never saved back over a new file.
            const victim = tabsRef.current.find((t) => matchesPath(t.path, absPath, cwd))?.path
              ?? (diffPathRef.current !== undefined && matchesPath(diffPathRef.current.path, absPath, cwd) ? diffPathRef.current.path : undefined)
            if (victim !== undefined) {
              setDiffPath((d) => (d?.path === victim ? undefined : d))
              // A tab with UNSAVED edits is not silently discarded: disposing
              // the model here threw the user's work away with no undo. Keep
              // it open and marked, so the edits survive and the next save
              // recreates the file (the version guard turns into a create).
              if (dirtyRef.current.has(victim)) {
                setTabs((prev) => prev.map((t) => t.path === victim ? { ...t, version: '', deletedOnDisk: true } : t))
                notifications.warning(t('editor.deletedOnDisk', { name: victim.split('/').pop() ?? victim }))
              } else {
                ideEditor.models.get(victim)?.dispose()
                ideEditor.models.delete(victim)
                ideEditor.saved.delete(victim)
                dirtyRef.current.delete(victim)
                setTabs((prev) => prev.filter((t) => t.path !== victim))
              }
            }
            continue
          }
          // Dirty tabs keep their in-editor edits; the user resolves the
          // divergence on save (stale-version conflict dialog).
          if (hit && hit.status === 'ready' && !hit.dirty && newVersion !== undefined && newVersion !== hit.version) {
            // Re-open IN PLACE (no remount); do not steal focus.
            void reopenFile(hit.path)
          }
        }
      } catch {
        // The change stream is best-effort; ignore transport errors.
      }
    })()
    return () => { cancelled = true; ctrl.abort(); if (bumpTimer !== undefined) clearTimeout(bumpTimer); if (treeTimer !== undefined) clearTimeout(treeTimer) }
  }, [sessionId, workspaceFiles, cwd])

  // Keep a ref to tabs so the change-stream effect (created once per session) sees latest.
  const tabsRef = useRef(tabs)
  useEffect(() => { tabsRef.current = tabs }, [tabs])

  // Auto-fetch git status for activity bar badge and file tree coloring.
  // Runs regardless of which sidebar view is active, so the badge count stays
  // current even when the user is in explorer or search view.
  //
  // SINGLE-POLLER RULE: while the SCM panel (git sidebar view) is mounted it
  // polls gitStatus itself and mirrors the full result back through
  // onStatusChanged — this effect then stands down (no fetch, no interval) so
  // the wire sees exactly one gitStatus request per cycle. Any other view
  // (explorer/search/extensions) has no other poller, so this one runs.
  useEffect(() => {
    if (!sessionId || !cwd || !ideTools) return
    if (sidebarView === 'git') return
    const ctrl = new AbortController()
    let cancelled = false
    const fetch = () => {
      void ideTools.gitStatus(sessionId, ctrl.signal).then((res) => {
        if (cancelled) return
        if (res.ok) {
          if (res.value.notARepo) { applyGitEntries(undefined); setGitBranch(undefined); setGitDetachedSha(undefined); setGitAhead(undefined); setGitBehind(undefined) }
          else {
            if (res.value.entries) applyGitEntries(res.value.entries)
            setGitBranch(res.value.branch)
            setGitDetachedSha(res.value.detached && res.value.headSha !== undefined ? res.value.headSha.slice(0, 7) : undefined)
            setGitAhead(res.value.ahead > 0 ? res.value.ahead : undefined)
            setGitBehind(res.value.behind > 0 ? res.value.behind : undefined)
          }
        }
      }).catch(() => {
        // Swallow git status fetch errors (namespace not mounted, not a repo,
        // network blip) so they never crash the React effect.
      })
    }
    fetch()
    // Poll every 15s as a slow fallback. Fast freshness comes from event
    // bumps (file writes, diff saves) — and every fetch is deduped in
    // applyGitEntries, so a no-change result never re-renders anything.
    const id = setInterval(fetch, 15000)
    return () => { cancelled = true; ctrl.abort(); clearInterval(id) }
  }, [sessionId, cwd, ideTools, gitRefreshKey, applyGitEntries, sidebarView])

  // External-change fallback watch: a slow silent stat pass over the open
  // tabs — covers changes no stream reports (external editors, terminal git
  // commands). The `changes` stream (above) already pushes agent/IDE writes.
  // Updates are in-place (no remount) so nothing ever flickers; unsaved
  // buffers are never touched — their save flow's version guard surfaces the
  // conflict instead.
  useEffect(() => {
    if (!sessionId || !workspaceFiles || !cwd) return
    const reloading = new Set<string>()
    let bumpTimer: ReturnType<typeof setTimeout> | undefined
    // Throttle the SCM refresh bump: a burst of writes (an agent editing many
    // files) should trigger one git status refetch, not one per frame.
    const bumpGit = () => {
      if (bumpTimer !== undefined) return
      bumpTimer = setTimeout(() => { bumpTimer = undefined; setGitRefreshKey((k) => k + 1) }, 1000)
    }
    const dropTab = (path: string) => {
      ideEditor.models.get(path)?.dispose()
      ideEditor.models.delete(path)
      ideEditor.saved.delete(path)
      dirtyRef.current.delete(path)
      setTabs((prev) => prev.filter((t) => t.path !== path))
      setDiffPath((d) => (d?.path === path ? undefined : d))
    }
    const applyExternalVersion = (path: string, version: string) => {
      const current = tabsRef.current.find((t) => t.path === path)
      if (!current || current.dirty || reloading.has(path)) return
      if (current.version === version) return
      reloading.add(path)
      void reopenRef.current(path).finally(() => reloading.delete(path))
      bumpGit()
    }
    const ctrl = new AbortController()
    // Slow silent stat pass for non-instrumented external writes.
    const poll = () => {
      const open = tabsRef.current.filter((t) => t.status === 'ready')
      for (const tab of open) {
        if (ctrl.signal.aborted) return
        if (tab.dirty || reloading.has(tab.path)) continue
        void workspaceFiles.stat(sessionId, tab.path, ctrl.signal).then((res) => {
          if (ctrl.signal.aborted) return
          const current = tabsRef.current.find((t) => t.path === tab.path)
          if (!current || current.dirty) return
          if (!res.ok) {
            // Externally deleted: drop the tab like VS Code closes a vanished
            // file, so a stale buffer is never saved back over a new file.
            if (res.error.code === 'workspace-file/not-found') dropTab(tab.path)
            return
          }
          applyExternalVersion(tab.path, res.value.version)
        }).catch(() => { /* transient transport errors: next tick retries */ })
      }
    }
    const id = setInterval(poll, 15000)
    return () => { ctrl.abort(); clearInterval(id); if (bumpTimer !== undefined) clearTimeout(bumpTimer) }
  }, [sessionId, workspaceFiles, cwd])

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
    // In-place update (VS Code's auto-revert): refresh the SAME model via
    // setValue instead of disposing and recreating it — the editor keeps its
    // identity, so nothing flashes and the layout never jumps. The cursor is
    // restored to its prior position afterwards.
    const model = ideEditor.models.get(path)
    const editor = editorRef.current
    const prior = model !== undefined && activePathRef.current === path && editor !== null && editor.getModel() === model
      ? editor.getPosition()
      : null
    if (model !== undefined) {
      // Refresh the saved baseline BEFORE setValue: the content listener
      // recomputes the dirty flag synchronously and must see the new text as
      // the clean baseline.
      ideEditor.saved.set(path, result.text)
      dirtyRef.current.delete(path)
      model.setValue(result.text)
    } else {
      const m = await loadMonaco()
      const created = createOrReuseModel(m, path, result.text, detectLanguage(path))
      ideEditor.models.set(path, created)
      ideEditor.saved.set(path, result.text)
      dirtyRef.current.delete(path)
    }
    if (prior !== null && editor !== null && editor.getModel() === model) {
      editor.setPosition(prior)
      editor.revealPositionInCenterIfOutsideViewport(prior)
    }
    setTabs((prev) => prev.map((t) => t.path === path ? { ...t, text: undefined as never, version: result.version, truncated: result.truncated, lines: result.lines, status: 'ready' as const, error: null, dirty: false } : t))
  }, [sessionId, workspaceFiles])

  // Latest-values refs so the Monaco command and listeners never run stale closures.
  const activePathRef = useRef(activePath)
  useEffect(() => { activePathRef.current = activePath }, [activePath])
  const saveRef = useRef<(path: string) => Promise<boolean>>(async () => false)
  useEffect(() => { saveRef.current = saveFile })
  const reopenRef = useRef<(path: string) => Promise<void>>(async () => {})
  useEffect(() => { reopenRef.current = reopenFile })

  /** Open the in-file find widget on whatever the editor area is showing —
   *  the SCM diff overlay when one is open, else the active normal editor.
   *  Monaco only binds its built-in Ctrl/Cmd+F while the editor has DOM
   *  focus; this gives the toolbar button and the global keydown fallback a
   *  reliable entry point (VS Code parity: Find works from any focus). */
  const triggerFind = useCallback((): void => {
    const diff = diffEditorRef.current
    if (diff !== null) {
      // Focus the modified (working-tree) pane first: the find action targets
      // the focused inner editor of the diff composite.
      const target = diff.getModifiedEditor() ?? diff.getOriginalEditor()
      target?.focus()
      const action = target?.getAction('actions.find')
      if (action) void action.run()
      return
    }
    const editor = editorRef.current
    if (editor === null || editor.getModel() === null) return
    editor.focus()
    const action = editor.getAction('actions.find')
    if (action) void action.run()
  }, [])
  // Global Ctrl/Cmd+F fallback while focus is OUTSIDE the editors (sidebar,
  // toolbar, terminal): let Monaco's own keybinding win when an editor has
  // focus, so the widget opens exactly once either way.
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f') return
      const el = document.activeElement
      // Inside Monaco (editor / its find input) the built-in binding handles it.
      if (el instanceof HTMLElement && (el.closest('.monaco-editor') !== null || el.closest('.find-widget') !== null)) return
      const root = containerRef.current
      // Only while the IDE view is on screen.
      if (root === null || !root.isConnected) return
      e.preventDefault()
      e.stopPropagation()
      triggerFind()
    }
    window.addEventListener('keydown', onKeydown, true)
    return () => { window.removeEventListener('keydown', onKeydown, true) }
  }, [triggerFind])

  // Monaco markers → problems snapshot (status bar + Problems panel).
  useEffect(() => {
    let disposed = false
    void loadMonaco().then((m) => {
      if (disposed) return
      const refresh = () => {
        const out: ProblemItem[] = []
        for (const marker of m.editor.getModelMarkers({})) {
          const uri = marker.resource.toString()
          // Model URIs are the workspace-relative path (see createModel call sites).
          const path = uri.startsWith('file:///') ? decodeURIComponent(uri.slice('file:///'.length)) : uri
          const sev = marker.severity === 8 ? 'error' : marker.severity === 4 ? 'warning' : 'info'
          out.push({ path, line: marker.startLineNumber, column: marker.startColumn, severity: sev, message: marker.message })
        }
        setProblems(out)
      }
      const sub = m.editor.onDidChangeMarkers(() => refresh())
      refresh()
      return () => sub.dispose()
    }).then((un) => { return un })
    return () => { disposed = true }
  }, [])

  // Track the ACTIVE model's language / indentation / EOL for the status-bar pickers.
  const syncModelMeta = useCallback(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!model) { setModelLanguage(undefined); setModelIndent(undefined); setModelEol(undefined); return }
    setModelLanguage(model.getLanguageId())
    const opts = model.getOptions()
    setModelIndent({ tabSize: opts.tabSize, insertSpaces: opts.insertSpaces })
    setModelEol(model.getEOL() === '\r\n' ? '\r\n' : '\n')
  }, [])
  useEffect(() => { syncModelMeta() }, [activePath, syncModelMeta])

  // User snippets → Monaco completion provider (re-registered on snippet saves).
  useEffect(() => {
    let dispose: (() => void) | undefined
    void loadMonaco().then((m) => {
      const provider = m.languages.registerCompletionItemProvider('*', {
        provideCompletionItems: (model, position) => {
          const lang = model.getLanguageId()
          const snippets = ideSnippets.snippetsFor(lang)
          if (snippets.length === 0) return { suggestions: [] }
          const word = model.getWordUntilPosition(position)
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
          const suggestions = snippets.map((sn, i) => ({
            label: sn.prefix,
            kind: m.languages.CompletionItemKind.Snippet,
            documentation: sn.description ?? sn.prefix,
            insertText: sn.body.join('\n'),
            insertTextRules: m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: String(i).padStart(4, '0'),
          }))
          return { suggestions }
        },
      })
      dispose = () => provider.dispose()
    })
    const un = ideSnippets.subscribe(() => { /* re-render picks up new snapshots via closure */ })
    return () => { un(); dispose?.() }
  }, [snippetsVersion])


  // FIM inline completion (ghost text). Registered once; the provider itself
  // checks the live setting, so toggling it needs no re-registration.
  //
  // Three guards keep this off the keystroke path: the setting must be on, a
  // debounce must elapse with no further typing, and a short host-side timeout
  // bounds the wait. A cancelled request (the user typed again) resolves to no
  // suggestion rather than to an error banner.
  useEffect(() => {
    if (sessionId === undefined || ideTools === undefined) return
    let dispose: (() => void) | undefined
    void loadMonaco().then((m) => {
      const provider = (m.languages as unknown as {
        registerInlineCompletionsProvider(
          selector: string,
          provider: {
            provideInlineCompletions(
              model: import('monaco-editor').editor.ITextModel,
              position: import('monaco-editor').Position,
              context: unknown,
              token: import('monaco-editor').CancellationToken,
            ): Promise<{ items: Array<{ insertText: string; range: import('monaco-editor').IRange }> }>
            freeInlineCompletions(completions: unknown): void
          },
          groupId?: string,
        ): { dispose(): void }
      }).registerInlineCompletionsProvider('*', {
        provideInlineCompletions: async (model, position, _context, token) => {
          if (!ideSettings.getSnapshot()['fim.enabled']) return { items: [] }
          const setting = ideSettings.getSnapshot()
          const debounceMs = setting['fim.debounceMs'] ?? 250
          // Wait out the typing burst before spending a model call.
          await new Promise<void>((resolveWait) => setTimeout(resolveWait, debounceMs))
          if (token.isCancellationRequested) return { items: [] }

          const modelPath = model.uri.path.replace(/^\//, '')
          const offset = model.getOffsetAt(position)
          const full = model.getValue()
          const before = full.slice(0, offset)
          const after = full.slice(offset)

          const ctrl = new AbortController()
          token.onCancellationRequested(() => ctrl.abort())
          try {
            const res = await ideTools.completeInline(
              sessionId,
              { path: modelPath, before, after, language: model.getLanguageId() },
              ctrl.signal,
            )
            if (!res.ok || res.value.text.length === 0) return { items: [] }
            // A completion that merely repeats what is already there would
            // shadow the user's own text as ghost output. Drop those.
            const text = res.value.text
            if (after.startsWith(text) && text.length > 0) return { items: [] }
            return {
              items: [{
                insertText: text,
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                },
              }],
            }
          } catch {
            // Inline completion is best-effort: a transport hiccup, a timeout
            // or a cancelled request must never surface as a red banner while
            // the user is typing.
            return { items: [] }
          }
        },
        freeInlineCompletions: () => { /* no resources to release */ },
      })
      dispose = () => provider.dispose()
    })
    return () => { dispose?.() }
  }, [sessionId, ideTools])
  /** Run a package.json script in a fresh terminal (VS Code Run Task). */
  const runBuildTask = useCallback((script: string) => {
    if (!sessionId) return
    void ideTools.terminalOpen(sessionId, { cols: 80, rows: 24 }).then((res) => {
      if (!res.ok) { notifications.error(res.error.message ?? res.error.code); return }
      setTerminalIds((prev) => prev.includes(res.value.terminalId) ? prev : [...prev, res.value.terminalId])
      setTerminalOpen(true)
      setBottomTab('terminal')
      setActiveTerminalIdx((prev) => prev + 1)
      setTimeout(() => {
        void ideTools.terminalWrite(sessionId, res.value.terminalId, 'npm run ' + script + '\r')
      }, 400)
    }).catch((err) => { notifications.error(err instanceof Error ? err.message : String(err)) })
  }, [sessionId, ideTools])

  /** The Manage gear menu (VS Code Manage menu). */
  const gearRef = useRef<HTMLDivElement>(null)
  const openManageMenu = useCallback(() => {
    const rect = gearRef.current?.getBoundingClientRect()
    const x = rect ? rect.left : 40
    const y = rect ? rect.top - 4 : 40
    showContextMenu(x, y, [
      { id: 'palette', label: t('manage.commandPalette'), icon: Icons.terminal, onClick: () => setPaletteOpen(true) },
      { id: 'settings', label: t('manage.settings'), icon: Icons.gear, onClick: () => setSettingsOpen(true) },
      { id: 'keybindings', label: t('manage.keybindings'), icon: Icons.bell, onClick: () => setKeybindingsOpen(true) },
      { id: 'snippets', label: t('manage.snippets'), icon: Icons.copy, onClick: () => setSnippetsOpen(true) },
      { id: 'sep1', label: '', separator: true },
      { id: 'tasks', label: t('manage.tasks'), icon: Icons.debug, onClick: () => { void openTasksMenu() } },
      { id: 'extensions', label: t('manage.extensions'), icon: Icons.extensions, onClick: () => setSidebarView('extensions') },
      { id: 'sep2', label: '', separator: true },
      { id: 'about', label: t('manage.about'), icon: Icons.eye, onClick: () => setAboutOpen(true) },
    ])
  }, [t])

  /** Tasks menu: package.json scripts → run in a fresh terminal. */
  const openTasksMenu = useCallback(async () => {
    if (!sessionId) return
    const res = await workspaceFiles.read(sessionId, 'package.json', { offset: 0, limit: 65536 })
    let items: Parameters<typeof showContextMenu>[2]
    if (res.ok) {
      try {
        const pkg = JSON.parse(res.value.text) as { scripts?: Record<string, string> }
        const scripts = Object.keys(pkg.scripts ?? {})
        items = scripts.length > 0
          ? scripts.map((sc) => ({ id: sc, label: 'npm run ' + sc, onClick: () => runBuildTask(sc) }))
          : [{ id: 'empty', label: t('tasks.empty'), disabled: true }]
      } catch {
        items = [{ id: 'failed', label: t('tasks.failed'), disabled: true }]
      }
    } else {
      items = [{ id: 'failed', label: t('tasks.failed'), disabled: true }]
    }
    const rect = gearRef.current?.getBoundingClientRect()
    showContextMenu(rect ? rect.left : 40, rect ? rect.top - 4 : 40, items)
  }, [sessionId, workspaceFiles, t, runBuildTask])

  /** Pull/push/sync shared by the command palette and the status bar.
   *  Failures surface as notifications — a bare .then chain dropped ok:false
   *  and left no-remote / no-upstream / auth failures with zero feedback. */
  const runGitSyncCommand = (action: 'pull' | 'push' | 'sync') => {
    const label = action === 'pull' ? t('command.gitPull') : action === 'push' ? t('command.gitPush') : t('command.gitSync')
    // One sync at a time: a second click while pull/push is in flight would
    // race two git processes against the same index and refs.
    if (gitSyncBusy) return
    setGitSyncBusy(true)
    void ideTools.gitSync(sessionId, action)
      .then((res) => {
        if (res.ok) {
          setGitRefreshKey((k) => k + 1)
        } else {
          notifications.error(label + ': ' + (res.error.message ?? res.error.code))
        }
      })
      .catch((err) => {
        notifications.error(label + ': ' + (err instanceof Error ? err.message : String(err)))
      })
      .finally(() => { setGitSyncBusy(false) })
  }

  /** Status-bar branch name: TOGGLE the Branches view. When it is already
   *  showing (Source Control open with Branches expanded) a second click
   *  collapses it again; otherwise it switches to Source Control and expands
   *  Branches — the same open/close rhythm as VS Code's branch picker button. */
  const openScmBranches = () => {
    const branchesShown = sidebarView === 'git' && scmOpenViews.branches
    setSidebarView('git')
    // A fresh object each call: the panel applies it on every identity change,
    // so a view the user collapsed by hand re-opens on the next click.
    setScmOpenViewsRequest({ branches: !branchesShown })
  }

  /** Build the command registry (rebuilt per render: closures stay fresh). */
  useEffect(() => {
    const cmds: IdeCommand[] = [
      { id: 'ide.commandPalette', category: t('category.view'), label: t('command.commandPalette'), run: () => setPaletteOpen(true) },
      { id: 'ide.settings', category: t('category.preferences'), label: t('command.settings'), run: () => setSettingsOpen(true) },
      { id: 'ide.keybindings', category: t('category.preferences'), label: t('command.keybindings'), run: () => setKeybindingsOpen(true) },
      { id: 'ide.snippets', category: t('category.preferences'), label: t('command.snippets'), run: () => setSnippetsOpen(true) },
      { id: 'ide.about', category: t('category.help'), label: t('command.about'), run: () => setAboutOpen(true) },
      { id: 'ide.find', category: t('category.editor'), label: t('command.find'), run: triggerFind },
      { id: 'ide.save', category: t('category.editor'), label: t('command.save'), run: () => { if (activePath !== undefined) void saveRef.current(activePath) } },
      { id: 'ide.toggleTerminal', category: t('category.view'), label: t('command.toggleTerminal'), run: () => { setTerminalOpen((v) => !v); setBottomTab('terminal') } },
      { id: 'ide.toggleSidebar', category: t('category.view'), label: t('command.toggleSidebar'), run: () => setSidebarView('explorer') },
      { id: 'ide.toggleRightSidebar', category: t('category.view'), label: t('command.toggleRightSidebar'), run: () => setRightSidebarOpen((v) => !v) },
      { id: 'ide.problems', category: t('category.view'), label: t('command.problems'), run: () => { setTerminalOpen((v) => v && bottomTab === 'problems' ? false : true); setBottomTab('problems') } },
      { id: 'ide.viewExplorer', category: t('category.view'), label: t('command.viewExplorer'), run: () => setSidebarView('explorer') },
      { id: 'ide.viewSearch', category: t('category.view'), label: t('command.viewSearch'), run: () => setSidebarView('search') },
      { id: 'ide.viewGit', category: t('category.git'), label: t('command.viewGit'), run: () => setSidebarView('git') },
      { id: 'ide.viewExtensions', category: t('category.view'), label: t('command.viewExtensions'), run: () => setSidebarView('extensions') },
      { id: 'ide.gitPull', category: t('category.git'), label: t('command.gitPull'), run: () => runGitSyncCommand('pull') },
      { id: 'ide.gitPush', category: t('category.git'), label: t('command.gitPush'), run: () => runGitSyncCommand('push') },
      { id: 'ide.gitSync', category: t('category.git'), label: t('command.gitSync'), run: () => runGitSyncCommand('sync') },
      { id: 'ide.task', category: t('category.tasks'), label: t('command.task'), run: () => { void openTasksMenu() } },
      { id: 'ide.themeDark', category: t('category.preferences'), label: t('command.themeDark'), run: () => ideSettings.update({ theme: 'dark-modern' }) },
      { id: 'ide.themeLight', category: t('category.preferences'), label: t('command.themeLight'), run: () => ideSettings.update({ theme: 'light-modern' }) },
    ]
    ideCommands.setAll(cmds)
  })

  /** Global keybinding dispatch (user-customizable, settings-store backed). */
  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes('mac')
    const onKeydown = (e: KeyboardEvent): void => {
      const root = containerRef.current
      if (root === null || !root.isConnected) return
      const chord = eventToChord(e, isMac)
      if (!chord) return
      const el = document.activeElement
      // Focus that already consumed the chord: the editor, the command input,
      // and ANY text field (search box, settings filter, snippet textarea).
      // Only the editor and the palette input were covered before, so typing
      // in the other inputs still ran global commands — and preventDefault()
      // swallowed the keystroke the field expected.
      const inEditor = el instanceof HTMLElement && (el.closest('.monaco-editor') !== null || el.closest('.ide-palette-input') !== null)
      const inTextField = el instanceof HTMLElement && (
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable
      )
      for (const kb of keybindings) {
        if (!kb.keys || !chordMatches(kb.keys, e, isMac)) continue
        const isGlobalCommand = kb.command === 'ide.commandPalette' || kb.command === 'ide.settings'
        if (inEditor && !isGlobalCommand) continue
        if (inTextField && !isGlobalCommand) continue
        const cmd = ideCommands.byId(kb.command)
        if (!cmd || cmd.disabled) continue
        e.preventDefault()
        e.stopPropagation()
        cmd.run()
        return
      }
    }
    window.addEventListener('keydown', onKeydown, true)
    return () => { window.removeEventListener('keydown', onKeydown, true) }
  }, [keybindings])
  /** Save one tab through the write Remote with a version-guarded intent. */
  const saveFile = useCallback(async (path: string): Promise<boolean> => {
    if (!sessionId) return false
    const tab = tabsRef.current.find((t) => t.path === path)
    const model = ideEditor.models.get(path)
    if (!tab || !model || tab.status !== 'ready' || tab.truncated) return false
    // Safety interlock: a file whose encoding this editor cannot reproduce
    // (e.g. GBK — no encoder exists in the platform) must never be written
    // back, because the write path is UTF-8 only and would replace the whole
    // file with mangled bytes. The tab is read-only for that reason; state it
    // explicitly instead of failing silently.
    if (tab.encodingLossless === false) {
      setError(t('save.encodingReadOnly', { encoding: tab.encoding ?? 'UTF-8' }))
      return false
    }
    // One write per path at a time: the follow-up press is a no-op rather than
    // a second write racing the first one's (now obsolete) version token.
    if (savingRef.current.has(path)) return false
    savingRef.current.add(path)
    const content = model.getValue()
    setSaveState('saving')
    // A tab whose file was deleted underneath it (version reset to '') saves
    // as a fresh create, so the preserved edits can be recovered.
    const intent = tab.version ? { kind: 'replaceIfVersion' as const, version: tab.version } : { kind: 'createIfAbsent' as const }
    let res
    try {
      res = await workspaceFilesWrite.write(sessionId, path, content, intent)
    } catch (err) {
      // A rejected write (transport drop) used to leave saveState on 'saving'
      // forever with no message at all.
      savingRef.current.delete(path)
      setSaveState('idle')
      setError(t('save.failed', { message: err instanceof Error ? err.message : String(err) }))
      return false
    }
    savingRef.current.delete(path)
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
    // The buffer is no longer dirty — tell the host now rather than waiting for
    // the debounce, so the agent stops seeing the stale copy.
    scheduleDirtyFlush()
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
      {settingsOpen && <SettingsDialog t={t} onClose={() => setSettingsOpen(false)} />}
      {aboutOpen && <AboutDialog t={t} version={IDE_VERSION} monacoVersion={monacoVersion} branch={gitBranch} onClose={() => setAboutOpen(false)} />}
      {keybindingsOpen && <KeybindingsDialog t={t} onClose={() => setKeybindingsOpen(false)} />}
      {snippetsOpen && <SnippetsDialog t={t} onClose={() => setSnippetsOpen(false)} />}
      {paletteOpen && <CommandPalette t={t} onClose={() => setPaletteOpen(false)} />}
      <div className="ide-body">
        <div className="ide-body-main">
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
          <div className="ide-activitybar-icon" data-active={sidebarView === 'extensions'} title={t('extensions.title')} onClick={() => setSidebarView('extensions')} data-testid="ide-activitybar-extensions">{Icons.extensions}</div>
          <div className="ide-activitybar-spacer" />
          <div
            className="ide-activitybar-icon"
            data-active={terminalOpen}
            title={t('terminal.title')}
            onClick={() => setTerminalOpen((v) => !v)}
            data-testid="ide-activitybar-terminal"
          >{Icons.terminal}</div>
          <div
            ref={gearRef}
            className="ide-activitybar-icon"
            title={t('settings.title')}
            onClick={openManageMenu}
            data-testid="ide-activitybar-gear"
          >{Icons.gear}</div>
        </div>
        <div className="ide-sidebar">
          {sidebarView === 'extensions' ? (
            <div className="ide-sidebar-view">
              <ExtensionsView t={t} />
            </div>
          ) : sidebarView === 'git' ? (
            sessionId ? (
              <SourceControlPanel
                sessionId={sessionId}
                cwd={cwd}
                ideTools={ideTools}
                onOpenDiff={(path, _kind, diffKind) => {
                  // The diff overlays the editor area, so the underlying Monaco
                  // host stays attached and closing the diff returns to the
                  // previously active file untouched. diffKind='staged' opens
                  // the index-vs-HEAD diff (a Staged Changes group entry).
                  setDiffPath({ path, diffKind })
                }}
                onOpenFile={(path) => {
                  // VS Code SCM "Open File": open the working-tree file in the
                  // editor, closing any active diff overlay first.
                  setDiffPath(undefined)
                  void openFile(path)
                }}
                onOpenCommitDiff={(sha, path, oldPath) => {
                  // One file inside one commit (source control graph details).
                  setDiffPath({ path, oldPath, sha })
                }}
                onChangesDiscarded={handleChangesDiscarded}
                commitMessage={scmCommitMessage}
                onCommitMessageChange={setScmCommitMessage}
                refreshKey={gitRefreshKey}
                openViewsRequest={scmOpenViewsRequest}
                onOpenViewsChanged={setScmOpenViews}
                onStatusChanged={(result) => {
                  // The panel is the single poller while mounted: mirror its
                  // full result into every consumer — badge + file tree
                  // (entries, deduped) and the status bar (branch/ahead/
                  // behind). Our own interval is paused in this view, so the
                  // wire still sees exactly one gitStatus per cycle.
                  if (result === undefined || result.notARepo) {
                    applyGitEntries(undefined)
                    setGitBranch(undefined)
                    setGitDetachedSha(undefined)
                    setGitAhead(undefined)
                    setGitBehind(undefined)
                  } else {
                    applyGitEntries(result.entries)
                    setGitBranch(result.branch)
                    setGitDetachedSha(result.detached && result.headSha !== undefined ? result.headSha.slice(0, 7) : undefined)
                    setGitAhead(result.ahead > 0 ? result.ahead : undefined)
                    setGitBehind(result.behind > 0 ? result.behind : undefined)
                  }
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
                  onOpenInTerminal={(absDir) => {
                    // VS Code "Open in Integrated Terminal": spawn a shell already
                    // inside the chosen directory and focus the terminal dock.
                    if (!sessionId || !ideTools || !cwd) return
                    const root = cwd.replace(/[/\\]+$/, '')
                    const dir = absDir.replace(/[/\\]+$/, '')
                    const rel = dir === root ? '' : (dir.startsWith(root + '/') ? dir.slice(root.length + 1) : dir)
                    void ideTools.terminalOpen(sessionId, { cols: 80, rows: 24, cwd: rel }).then((res) => {
                      if (!res.ok) { notifications.error(res.error.message ?? res.error.code); return }
                      setTerminalIds((prev) => prev.includes(res.value.terminalId) ? prev : [...prev, res.value.terminalId])
                      setTerminalOpen(true)
                      setBottomTab('terminal')
                      setActiveTerminalIdx(terminalIds.length)
                      const cdLine = 'cd ' + ("'" + absDir.replace(/'/g, "'\\''") + "'") + '\r'
                      window.setTimeout(() => {
                        const bytes = new TextEncoder().encode(cdLine)
                        let bin = ''
                        for (const byte of bytes) bin += String.fromCharCode(byte)
                        void ideTools.terminalWrite(sessionId, res.value.terminalId, btoa(bin))
                      }, 600)
                    }).catch((err) => { notifications.error(err instanceof Error ? err.message : String(err)) })
                  }}
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
          <div className="ide-editor-toolbar">
            <button
              className="ide-tabbar-action"
              data-testid="ide-find-in-file"
              disabled={!(diffPath !== undefined || (activePath !== undefined && activeTab?.kind !== 'image'))}
              title={t('editor.findInFile')}
              aria-label={t('editor.findInFile')}
              onClick={triggerFind}
            >{Icons.search}</button>
            <button
              className="ide-tabbar-action"
              data-active={terminalOpen || undefined}
              title={t('panel.toggleBottom')}
              aria-label={t('panel.toggleBottom')}
              onClick={() => setTerminalOpen((v) => !v)}
            >{Icons.panelBottom}</button>
            <button
              className="ide-tabbar-action"
              data-active={rightSidebarOpen || undefined}
              title={t('panel.toggleRightSidebar')}
              aria-label={t('panel.toggleRightSidebar')}
              onClick={() => setRightSidebarOpen((v) => !v)}
            >{Icons.splitEditor}</button>
          </div>
          <TabBar tabs={tabs} active={activePath} onSelect={setActivePath} onClose={closeTab} t={t}
            actions={!diffPath && activeIsMd ? (
              <button
                className="ide-tabbar-action"
                data-active={mdPreviewOpen || undefined}
                title={mdPreviewOpen ? t('md.closePreview') : t('md.openPreview')}
                aria-label={mdPreviewOpen ? t('md.closePreview') : t('md.openPreview')}
                data-testid="ide-md-preview-toggle"
                onClick={() => setMdPreviewOpen((v) => !v)}
              >{Icons.openPreview}</button>
            ) : undefined}
          />
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
          <div className="ide-editor-container" ref={containerRef} data-md-split={mdPreviewOpen && !diffPath && activeIsMd ? 'true' : undefined} />
          {activeImageSrc && (
            <div className="ide-editor-image">
              {/* PDFs render in the browser's built-in viewer via an iframe.
                  The data URI is what the read path already produces, so no
                  extra round-trip or PDF.js dependency is needed. */}
              {activeTab?.language === 'pdf'
                ? <iframe className="ide-editor-pdf" src={activeImageSrc} title={activeTab?.name ?? 'PDF'} />
                : <img src={activeImageSrc} alt={activeTab?.name ?? ''} />}
            </div>
          )}
          {/* Markdown split preview (VS Code "Open Preview to the Side"):
              the Monaco container narrows via data-md-split while this pane
              owns the right half. Hidden while a git diff overlay is open. */}
          {mdPreviewOpen && !diffPath && activeIsMd && (
            <div className="ide-md-pane" data-testid="ide-md-preview">
              <div className="ide-md-pane-header">
                <span className="ide-md-pane-title">{activeTab?.name ?? ''}</span>
                <button
                  className="ide-tabbar-action"
                  title={t('md.refresh')}
                  aria-label={t('md.refresh')}
                  onClick={() => {
                    const m = activePath !== undefined ? ideEditor.models.get(activePath) : undefined
                    if (m) setPreviewContent(m.getValue())
                    setPreviewNonce((n) => n + 1)
                  }}
                >{Icons.refresh}</button>
                <button
                  className="ide-tabbar-action"
                  title={t('md.closePreview')}
                  aria-label={t('md.closePreview')}
                  onClick={() => setMdPreviewOpen(false)}
                >{Icons.close}</button>
              </div>
              <MarkdownPreview
                sessionId={sessionId}
                workspaceFiles={workspaceFiles}
                basePath={activePath ?? ''}
                content={previewContent}
                nonce={previewNonce}
                scrollRef={(el) => { previewScrollRef.current = el }}
                onOpenPath={(p) => { void openFile(p) }}
                t={t}
              />
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
              workspaceFilesWrite={workspaceFilesWrite}
              path={diffPath.path}
              name={diffPath.path.split('/').pop() ?? diffPath.path}
              commit={diffPath.sha !== undefined ? { sha: diffPath.sha, path: diffPath.path, oldPath: diffPath.oldPath } : undefined}
              diffKind={diffPath.diffKind}
              onSaved={(savedPath) => {
                // A save from the editable diff pane changed the worktree: sync
                // the matching normal tab (its model + saved baseline are stale
                // now) and refresh the git badge immediately.
                if (tabs.some((t) => t.path === savedPath)) void reopenFile(savedPath)
                setGitRefreshKey((k) => k + 1)
              }}
              onExternalChange={() => setGitRefreshKey((k) => k + 1)}
              onEditorReady={(ed) => { diffEditorRef.current = ed }}
              onClose={() => setDiffPath(undefined)}
              t={t}
            />
          )}
          </div>
        </div>
        {rightSidebarOpen && (
          <div className="ide-sidebar-right" data-testid="ide-sidebar-right">
            <div className="ide-sidebar-right-header">
              <span className="ide-sidebar-right-title">{t('panel.rightSidebar')}</span>
              <button
                className="ide-sidebar-right-close"
                title={t('terminal.close')}
                onClick={() => setRightSidebarOpen(false)}
              >{Icons.close}</button>
            </div>
            <div className="ide-sidebar-right-body">
              <p className="ide-sidebar-right-placeholder">{t('panel.rightSidebarPlaceholder')}</p>
            </div>
          </div>
        )}
        </div>
        {terminalOpen && sessionId && (
          <div className="ide-bottompanel" data-testid="ide-bottom-panel">
            <div className="ide-bottomtabs">
              <button className="ide-bottomtab" data-active={bottomTab === 'problems' || undefined} onClick={() => setBottomTab('problems')} data-testid="ide-bottomtab-problems">{t('problems.title')}{problems.length > 0 && <span className="ide-bottomtab-count">{problems.length}</span>}</button>
              <button className="ide-bottomtab" data-active={bottomTab === 'terminal' || undefined} onClick={() => setBottomTab('terminal')} data-testid="ide-bottomtab-terminal">{t('terminal.title')}</button>
              {/* Right end of the tab row: the terminal panel portals its action
                  buttons in here, so they sit at the top-right of the bottom
                  panel instead of in the terminal's own toolbar. */}
              <div ref={setBottomTabsActions} className="ide-bottomtabs-actions" data-testid="ide-bottomtabs-actions" />
            </div>
            {bottomTab === 'problems' && (
              <div className="ide-bottom-problems">
                <ProblemsPanel problems={problems} onOpen={(path, line) => { setDiffPath(undefined); void openFile(path, line) }} t={t} />
              </div>
            )}
            {bottomTab === 'terminal' && (
          <TerminalPanel
            sessionId={sessionId}
            ideTools={ideTools}
            terminalIds={terminalIds}
            activeIdx={activeTerminalIdx}
            onTerminalOpened={handleTerminalOpened}
            onActiveChange={setActiveTerminalIdx}
            onTerminalClosed={handleTerminalClosed}
            onClose={handleTerminalClose}
            tabVisible={props.tabVisible}
            actionsHost={bottomTabsActions}
            t={t}
          />
            )}
          </div>
        )}
        <StatusBar
          activeTab={activeTab}
          encoding={activeTab?.encoding}
          cursor={cursor}
          t={t}
          saveState={saveState}
          onSave={() => { if (activePath !== undefined) void saveFile(activePath) }}
          model={model}
          branch={gitBranch}
          detachedSha={gitDetachedSha}
          ahead={gitAhead}
          behind={gitBehind}
          onSync={() => runGitSyncCommand('sync')}
          syncBusy={gitSyncBusy}
          onOpenBranch={openScmBranches}
          branchPanelOpen={sidebarView === 'git' && scmOpenViews.branches}
          problems={problemCounts}
          onOpenProblems={() => { setTerminalOpen((v) => v && bottomTab === 'problems' ? false : true); setBottomTab('problems') }}
          workspaceName={workspaceName}
          sessionId={sessionId}
          cwd={cwd}
          onToggleTerminal={() => { setTerminalOpen((v) => !v); setBottomTab('terminal') }}
          terminalOpen={terminalOpen}
          bottomTab={bottomTab}
          language={modelLanguage}
          onSetLanguage={(lang) => { const model = editorRef.current?.getModel(); if (model) { Monaco.editor.setModelLanguage(model, lang); syncModelMeta(); setTabs((prev) => prev.map((tab) => tab.path === activePath ? { ...tab, language: lang } : tab)) } }}
          indent={modelIndent}
          onSetIndent={(tabSize, insertSpaces) => { const model = editorRef.current?.getModel(); if (model) { model.updateOptions({ tabSize, insertSpaces }); syncModelMeta() } }}
          eol={modelEol}
          onSetEol={(eol) => { const model = editorRef.current?.getModel(); if (model) { model.pushEOL(eol === '\r\n' ? Monaco.editor.EndOfLineSequence.CRLF : Monaco.editor.EndOfLineSequence.LF); syncModelMeta() } }}
          onToggleSidebar={() => setSidebarView('explorer')}
          onToggleRightSidebar={() => setRightSidebarOpen((v) => !v)}
          rightSidebarOpen={rightSidebarOpen}
        />
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
