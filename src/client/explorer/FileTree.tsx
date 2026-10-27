import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { GitStatusEntry, IdeToolsRemote, SessionId, WorkspaceDirectoryEntry, WorkspaceDirectoryListing, WorkspaceFilesRemote } from '../types.js'
import { Icons, fileIcon } from '../icons.js'
import { showContextMenu } from '../ContextMenu.js'

interface FileTreeProps {
  sessionId: SessionId
  /** Absolute workspace root (the session cwd). The Host lists absolute paths. */
  rootDir: string
  workspaceFiles: WorkspaceFilesRemote
  activePath: string | undefined
  onOpenFile: (path: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
  /** Git status entries for coloring file names by modification kind. If provided, overrides auto-fetch. */
  gitEntries?: readonly GitStatusEntry[]
  /** Optional ideTools Remote for auto-fetching git status. Only used when gitEntries is not provided. */
  ideTools?: { gitStatus(workspaceFileScope: { sessionId: SessionId; workspaceRoot: string }, signal?: AbortSignal): Promise<{ ok: boolean; value?: { entries?: readonly GitStatusEntry[] }; error?: { message?: string } }> }
  /** Optional ideTools Remote (full face) powering the Explorer rename/delete context actions. */
  ideToolsFull?: IdeToolsRemote
  /** Invoked after a successful rename: (oldAbsolutePath, newAbsolutePath). */
  onFileRenamed?: (oldAbsolutePath: string, newAbsolutePath: string) => void
  /** Invoked after a successful delete: (absolutePath — file or directory root). */
  onFileDeleted?: (absolutePath: string) => void
  /** Open an integrated terminal AT this directory (VS Code "Open in
   *  Integrated Terminal"); the host shell cd's into it. */
  onOpenInTerminal?: (absDir: string) => void
}

/** Imperative API for the Explorer header actions (new file / new folder /
 *  refresh / collapse-all), called by IdeView's header buttons. */
export interface ExplorerHandle {
  /** Re-list the tree. */
  refresh(): void
  /** Collapse every expanded directory. */
  collapseAll(): void
  /** Start an inline create input: at the root when parentAbs is omitted. */
  startCreate(kind: 'file' | 'directory', parentAbs?: string): void
}

interface DirState {
  entries: readonly WorkspaceDirectoryEntry[]
  truncated: boolean
  loading: boolean
  error: string | null
}

/** Join a parent absolute path and a child name with `/`. The Host resolves mixed separators. */
function joinPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}

/** Normalize a path to forward slashes and drop trailing separators, so a
 *  Windows root (`C:\\work`) and a POSIX root (`/work`) compare the same way. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Strip the workspace-root prefix from an absolute path → workspace-relative (git-style).
 *
 *  This is a real PREFIX test, not a String.replace: replace() treats the root
 *  as a pattern and strips its FIRST occurrence anywhere in the string, so a
 *  root of `/` turned `/a/b` into `a/b`, and a Windows root (`C:\\w`) never
 *  matched the forward-slash child paths produced by joinPath — both leaked an
 *  absolute path to the host, which then refused it as "escapes the workspace
 *  root" (breaking create / rename / delete / drag for those workspaces). */
function relPathOf(rootDir: string, absPath: string): string {
  const root = normalizePath(rootDir)
  const abs = normalizePath(absPath)
  if (abs === root) return ''
  // Root '/' normalizes to '' — every absolute path is then already relative
  // once its leading slash is dropped.
  if (root === '') return abs.replace(/^\/+/, '')
  const prefix = root + '/'
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs
}

/**
 * Best-effort host OS guess from the browser itself: the DSH GUI is a local
 * desktop app, so the browser and the plugin host share the machine in the
 * common case. Seeding the cache with this guarantees the reveal menu item
 * always renders; the authoritative ideTools.hostPlatform() answer refines it
 * once it arrives (covers a remote browser against a local host).
 */
function guessHostPlatform(): 'darwin' | 'win32' | 'linux' {
  if (typeof navigator === 'undefined') return 'linux'
  const ua = navigator.userAgent
  if (/Macintosh|Mac OS X|iPhone|iPad/.test(ua)) return 'darwin'
  if (/Windows/.test(ua)) return 'win32'
  return 'linux'
}

/** Cached host OS family so context menus label the reveal action correctly
 *  without refetching on every mount (VS Code picks the label per host OS).
 *  Seeded with the navigator guess so the item never disappears. */
let hostPlatformCache: 'darwin' | 'win32' | 'linux' = guessHostPlatform()

/** True once ideTools.hostPlatform() has answered (its result beats the guess). */
let hostPlatformAuthoritative = false

/** Workspace-relative path of a directory, with '' for the workspace root itself. */
function parentRelOf(rootDir: string, absPath: string): string {
  if (normalizePath(absPath) === normalizePath(rootDir)) return ''
  return relPathOf(rootDir, absPath)
}

/**
 * Filename validation for NEW entries (VS Code's validateFileName accepts
 * multi-segment paths when creating — typing "sub/dir/name" creates the
 * parents — so unlike rename, '/' is allowed and each segment is checked).
 */
function validateCreateName(
  raw: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): { severity: 'error' | 'warning'; message: string } | null {
  const name = raw.replace(/\t+$/, '').replace(/^[/\\]+/, '').replace(/[/\\]+$/, '')
  if (!name || name.trim().length === 0) return { severity: 'error', message: t('context.nameEmpty') }
  const segments = name.split(/[/\\]/).filter((s) => s.length > 0)
  if (segments.length === 0) return { severity: 'error', message: t('context.nameEmpty') }
  for (const seg of segments) {
    if (seg === '.' || seg === '..' || /[\u0000-\u001f\u007f]/.test(seg)) {
      return { severity: 'error', message: t('context.nameInvalid', { name: raw }) }
    }
  }
  if (name.length > 255) return { severity: 'error', message: t('context.nameTooLong') }
  if (segments.some((s) => /^\s|\s$/.test(s))) return { severity: 'warning', message: t('context.nameWhitespace') }
  return null
}

/**
 * Explorer filename validation, ported from VS Code's `validateFileName` +
 * `isValidBasename` (src/vs/workbench/contrib/files/browser/fileActions.ts and
 * src/vs/base/common/extpath.ts), reduced to the portable subset: well-formed
 * (trailing tabs/slashes stripped), non-empty, no path separators, not
 * '.'/'..', no control characters, ≤255 chars. Leading/trailing spaces are a
 * non-blocking warning, exactly like VS Code's Warning severity.
 */
function validateNewName(
  raw: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): { severity: 'error' | 'warning'; message: string } | null {
  const name = raw.replace(/\t+$/, '').replace(/[/\\]+$/, '')
  if (!name || name.trim().length === 0) return { severity: 'error', message: t('context.nameEmpty') }
  if (name.startsWith('/') || name.startsWith('\\') || /[/\\]/.test(name)) {
    return { severity: 'error', message: t('context.nameInvalid', { name: raw }) }
  }
  if (name === '.' || name === '..') return { severity: 'error', message: t('context.nameInvalid', { name: raw }) }
  if (/[\u0000-\u001f\u007f]/.test(name)) return { severity: 'error', message: t('context.nameInvalid', { name: raw }) }
  if (name.length > 255) return { severity: 'error', message: t('context.nameTooLong') }
  if (/^\s|\s$/.test(name)) return { severity: 'warning', message: t('context.nameWhitespace') }
  return null
}

/** Directory ordering: directories first, then files, alphabetical within. */
function sortEntries(entries: readonly WorkspaceDirectoryEntry[]): readonly WorkspaceDirectoryEntry[] {
  return [...entries].sort((a, b) => {
    const ad = a.type === 'directory' ? 0 : 1
    const bd = b.type === 'directory' ? 0 : 1
    if (ad !== bd) return ad - bd
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

/** Status letter badge color, matching VS Code's palette (same as SourceControlPanel). */
function gitStatusColor(kind: GitStatusEntry['kind']): string | undefined {
  switch (kind) {
    case 'added': return '#73c991'      // green
    case 'deleted': return '#f48771'     // red
    case 'renamed': return '#61afef'     // blue
    case 'untracked': return '#73c991'   // green (U)
    case 'conflicted': return '#e2c08d'  // amber
    case 'modified': return '#e2c08d'    // amber (M)
    default: return undefined
  }
}

/** One-letter status badge, matching `git status --short` conventions. */
function gitStatusLetter(kind: GitStatusEntry['kind']): string {
  switch (kind) {
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'untracked': return 'U'
    case 'conflicted': return 'C'
    case 'modified': return 'M'
    default: return ''
  }
}

/** Color priority when merging a directory's child statuses (VSCode precedence:
 * untracked/added/deleted > conflicted > modified > renamed). The directory
 * shows the color of its "most significant" child change. */
const KIND_PRIORITY: Record<GitStatusEntry['kind'], number> = {
  unmodified: 0,
  ignored: 0,
  renamed: 1,
  modified: 2,
  conflicted: 3,
  added: 4,
  untracked: 4,
  deleted: 4,
}

/**
 * Build a lookup from absolute path → GitStatusEntry, plus a directory map
 * from absolute path → dominant child kind. The git status `path` values are
 * workspace-relative (e.g. "src/client/IdeView.tsx"); we resolve them to
 * absolute using the workspace root so they match the tree's absolute paths.
 */
function buildGitIndex(
  rootDir: string,
  gitEntries?: readonly GitStatusEntry[],
): {
  fileMap: Map<string, GitStatusEntry>
  dirMap: Map<string, GitStatusEntry['kind']>
} {
  const fileMap = new Map<string, GitStatusEntry>()
  const dirMap = new Map<string, GitStatusEntry['kind']>()
  if (!gitEntries || gitEntries.length === 0) return { fileMap, dirMap }
  const root = rootDir.replace(/[/\\]+$/, '')
  for (const entry of gitEntries) {
    const abs = `${root}/${entry.path}`
    fileMap.set(abs, entry)
    // Walk up the path, merging this entry's kind into each ancestor dir.
    let dir = abs
    const segs = entry.path.split('/')
    for (let i = segs.length - 1; i > 0; i--) {
      dir = dir.slice(0, dir.length - segs[i].length - 1)
      const cur = dirMap.get(dir)
      const next = entry.kind
      if (!cur || KIND_PRIORITY[next] > KIND_PRIORITY[cur]) dirMap.set(dir, next)
    }
  }
  return { fileMap, dirMap }
}

export const FileTree = forwardRef<ExplorerHandle, FileTreeProps>(function FileTree({ sessionId, rootDir, workspaceFiles, activePath, onOpenFile, t, gitEntries, ideToolsFull, onFileRenamed, onFileDeleted, onOpenInTerminal }, ref) {
  // Root directory state, listed from the absolute workspace root.
  const [rootState, setRootState] = useState<DirState>({ entries: [], truncated: false, loading: true, error: null })
  const [expanded, setExpanded] = useState<Set<string>>(new Set([]))

  // Build an absolute-path → git-status index once per gitEntries/rootDir
  // change. The git status returns workspace-relative paths; we resolve them
  // to absolute so they match the tree's childPath values, and we also derive
  // a directory map (a directory inherits the dominant kind of its children).
  const { fileMap: gitFileMap, dirMap: gitDirMap } = useMemo(
    () => buildGitIndex(rootDir, gitEntries),
    [rootDir, gitEntries],
  )

  const loadDir = useCallback(async (dirPath: string, signal: AbortSignal): Promise<DirState> => {
    try {
      const result = await workspaceFiles.list(sessionId, dirPath, signal)
      if (!result.ok) {
        return { entries: [], truncated: false, loading: false, error: result.error.message }
      }
      const listing: WorkspaceDirectoryListing = result.value
      return { entries: sortEntries(listing.entries), truncated: listing.truncated, loading: false, error: null }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { entries: [], truncated: false, loading: false, error: message }
    }
  }, [sessionId, workspaceFiles])

  // Bumped after rename/delete to re-list the root; child nodes watch it too.
  const [refreshKey, setRefreshKey] = useState(0)

  // Load root on mount / session change, and re-list after rename/delete.
  useEffect(() => {
    const ctrl = new AbortController()
    setRootState({ entries: [], truncated: false, loading: true, error: null })
    loadDir(rootDir, ctrl.signal).then(setRootState)
    return () => ctrl.abort()
  }, [loadDir, rootDir, refreshKey])

  const toggle = useCallback((dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

  // In-tree rename state (analog of VS Code explorerViewer.renderInputBox).
  const [renaming, setRenaming] = useState<{ absPath: string; initial: string } | null>(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameServerError, setRenameServerError] = useState<string | null>(null)
  // Delete confirmation (analog of VS Code deleteFiles' confirm dialog).
  const [pendingDelete, setPendingDelete] = useState<{ absPath: string; name: string; isDir: boolean } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const startRename = useCallback((absPath: string, initial: string) => {
    setRenameServerError(null)
    setRenaming({ absPath, initial })
  }, [])

  const cancelRename = useCallback(() => setRenaming(null), [])

  const clearRenameServerError = useCallback(() => setRenameServerError(null), [])

  const commitRename = useCallback(async (absPath: string, rawName: string) => {
    if (!renaming || renaming.absPath !== absPath || renameBusy || !ideToolsFull) return
    // VS Code: an unchanged name exits rename mode without doing anything.
    const wellFormed = rawName.replace(/\t+$/, '').replace(/[/\\]+$/, '')
    if (wellFormed === renaming.initial || wellFormed.length === 0) {
      setRenaming(null)
      return
    }
    if (validateNewName(rawName, t)?.severity === 'error') return
    setRenameBusy(true)
    setRenameServerError(null)
    try {
      const result = await ideToolsFull.fileRename(sessionId, relPathOf(rootDir, absPath), wellFormed)
      if (result.ok) {
        setRenaming(null)
        setRefreshKey((k) => k + 1)
        const parent = absPath.slice(0, absPath.lastIndexOf('/'))
        onFileRenamed?.(absPath, parent + '/' + wellFormed)
      } else {
        setRenameServerError(result.error.message)
      }
    } catch (err) {
      setRenameServerError(err instanceof Error ? err.message : String(err))
    } finally {
      setRenameBusy(false)
    }
  }, [renaming, renameBusy, ideToolsFull, sessionId, rootDir, t, onFileRenamed])

  const startDelete = useCallback((absPath: string, name: string, isDir: boolean) => {
    setDeleteError(null)
    setPendingDelete({ absPath, name, isDir })
  }, [])

  const cancelDelete = useCallback(() => {
    if (!deleteBusy) setPendingDelete(null)
  }, [deleteBusy])

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || deleteBusy || !ideToolsFull) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const result = await ideToolsFull.fileDelete(
        sessionId,
        relPathOf(rootDir, pendingDelete.absPath),
        pendingDelete.isDir ? 'directory' : 'file',
      )
      if (result.ok) {
        setPendingDelete(null)
        setRefreshKey((k) => k + 1)
        onFileDeleted?.(pendingDelete.absPath)
      } else {
        setDeleteError(result.error.message)
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleteBusy(false)
    }
  }, [pendingDelete, deleteBusy, ideToolsFull, sessionId, rootDir, onFileDeleted])

  // --- Inline create (VS Code explorerViewer's new-file/new-folder input) ---
  const [creating, setCreating] = useState<{ parentAbs: string; kind: 'file' | 'directory' } | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [createServerError, setCreateServerError] = useState<string | null>(null)
  // Host OS for the reveal action's label (VS Code: Reveal in Finder / File Explorer / Open Containing Folder).
  const [hostPlatform, setHostPlatform] = useState(hostPlatformCache)
  // Transient error notice (top of the tree), e.g. a failed reveal.
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | undefined>(undefined)

  // Refine the platform guess with the authoritative host answer, once per page
  // (module-level cache). No cancellation flag: a response landing after a
  // re-render is still valid, and React 18 tolerates setState after unmount.
  useEffect(() => {
    if (hostPlatformAuthoritative || !ideToolsFull) return
    void ideToolsFull.hostPlatform(sessionId).then((res) => {
      if (hostPlatformAuthoritative) return
      if (!res.ok) {
        // Keep the navigator-guessed label; leave a diagnostic breadcrumb.
        console.warn('[ide] hostPlatform unavailable:', res.error.message)
        return
      }
      const platform = res.value === 'darwin' || res.value === 'win32' ? res.value : 'linux'
      hostPlatformAuthoritative = true
      hostPlatformCache = platform
      setHostPlatform(platform)
    }).catch((err) => {
      console.warn('[ide] hostPlatform call failed:', err instanceof Error ? err.message : String(err))
    })
  }, [sessionId, ideToolsFull])

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 5000)
  }, [])

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), [])

  /** Reveal via the OS file manager (host-side per its platform). */
  const revealEntry = useCallback((absPath: string, name: string) => {
    if (!ideToolsFull) return
    const rel = absPath === rootDir || absPath === rootDir.replace(/[/\\]+$/, '') ? '' : relPathOf(rootDir, absPath)
    void ideToolsFull.fileReveal(sessionId, rel).then((res) => {
      if (!res.ok) showNotice(t('context.revealFailed', { message: res.error.message }))
    }).catch((err) => {
      showNotice(t('context.revealFailed', { message: err instanceof Error ? err.message : String(err) }))
    })
  }, [ideToolsFull, sessionId, rootDir, t, showNotice])

  const startCreate = useCallback((kind: 'file' | 'directory', parentAbs?: string) => {
    const target = parentAbs ?? rootDir
    setCreateServerError(null)
    // Creating inside a directory expands it so the input shows among children.
    if (target !== rootDir) {
      setExpanded((prev) => {
        if (prev.has(target)) return prev
        const next = new Set(prev)
        next.add(target)
        return next
      })
    }
    setCreating({ parentAbs: target, kind })
  }, [rootDir])

  const cancelCreate = useCallback(() => {
    if (!createBusy) setCreating(null)
  }, [createBusy])

  const clearCreateServerError = useCallback(() => setCreateServerError(null), [])

  const commitCreate = useCallback(async (rawName: string) => {
    if (!creating || createBusy || !ideToolsFull) return
    // Well-formed like VS Code's getWellFormedFileName: strip edge tabs/slashes.
    const name = rawName.replace(/\t+$/, '').replace(/^[/\\]+/, '').replace(/[/\\]+$/, '')
    if (name.length === 0) { setCreating(null); return }
    if (validateCreateName(rawName, t)?.severity === 'error') return
    const baseRel = parentRelOf(rootDir, creating.parentAbs)
    const rel = baseRel ? baseRel + '/' + name : name
    setCreateBusy(true)
    setCreateServerError(null)
    try {
      const result = await ideToolsFull.fileCreate(sessionId, rel, creating.kind)
      if (result.ok) {
        setCreating(null)
        setRefreshKey((k) => k + 1)
        // VS Code opens a newly created file in the editor.
        if (creating.kind === 'file') {
          onOpenFile(creating.parentAbs.replace(/[/\\]+$/, '') + '/' + name)
        }
      } else {
        setCreateServerError(result.error.message)
      }
    } catch (err) {
      setCreateServerError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreateBusy(false)
    }
  }, [creating, createBusy, ideToolsFull, sessionId, rootDir, t, onOpenFile])

  // --- Explorer clipboard (VS Code explorer cut/copy/paste) ---
  // A cut entry is dimmed (like VS Code's greyed-out cut file) until pasted
  // or cancelled; copy keeps normal styling. Kept per-FileTree, absolute paths.
  const [clip, setClip] = useState<{ absPath: string; op: 'cut' | 'copy'; isDir: boolean } | null>(null)
  const [pasteBusy, setPasteBusy] = useState(false)
  const [pasteError, setPasteError] = useState<string | null>(null)

  const copyEntry = useCallback((absPath: string, isDir: boolean) => {
    setPasteError(null)
    setClip({ absPath, op: 'copy', isDir })
  }, [])

  const cutEntry = useCallback((absPath: string, isDir: boolean) => {
    setPasteError(null)
    setClip({ absPath, op: 'cut', isDir })
  }, [])

  /** Derive a non-colliding name ("name - copy", "name - copy 2", ...) from
   *  the siblings the caller passes; VS Code's copySuffix pattern. */
  const nonCollidingName = (baseName: string, siblings: ReadonlySet<string>): string => {
    if (!siblings.has(baseName)) return baseName
    const dot = baseName.lastIndexOf('.')
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName
    const ext = dot > 0 ? baseName.slice(dot) : ''
    for (let n = 2; n < 1000; n++) {
      const candidate = stem + ' - copy' + (n > 2 ? ' ' + String(n) : '') + ext
      if (!siblings.has(candidate)) return candidate
    }
    return stem + ' - copy ' + String(Date.now()) + ext
  }

  const pasteInto = useCallback(async (targetDir: string) => {
    if (!clip || pasteBusy || !ideToolsFull) return
    if (clip.absPath === targetDir || targetDir.startsWith(clip.absPath + '/')) {
      setPasteError(t('context.pasteIntoItself'))
      return
    }
    setPasteBusy(true)
    setPasteError(null)
    try {
      const rel = relPathOf(rootDir, clip.absPath)
      const targetRel = targetDir === rootDir ? '' : relPathOf(rootDir, targetDir)
      if (clip.op === 'copy') {
        // Sibling names come from a fresh listing so the -copy suffix is accurate.
        const listed = await workspaceFiles.list(sessionId, targetRel)
        const siblings = new Set<string>(listed.ok ? listed.value.entries.map((e) => e.name) : [])
        const baseName = clip.absPath.slice(clip.absPath.lastIndexOf('/') + 1)
        let newName: string | undefined
        if (siblings.has(baseName)) newName = nonCollidingName(baseName, siblings)
        const result = await ideToolsFull.fileCopy(sessionId, rel, targetRel, { newName })
        if (!result.ok) { setPasteError(result.error.message); return }
      } else {
        const result = await ideToolsFull.fileMove(sessionId, rel, targetRel, undefined)
        if (!result.ok) { setPasteError(result.error.message); return }
        setClip(null)
        // Only a move (cut) relocates the source — update open editor tabs.
        // A copy leaves the original in place; calling onFileRenamed here
        // would close the original tab and reopen a non-existent path.
        onFileRenamed?.(clip.absPath, targetDir + '/' + clip.absPath.slice(clip.absPath.lastIndexOf('/') + 1))
      }
      setRefreshKey((k) => k + 1)
      // Paste into a collapsed directory should reveal it.
      setExpanded((prev) => (prev.has(targetDir) ? prev : new Set([...prev, targetDir])))
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : String(err))
    } finally {
      setPasteBusy(false)
    }
  }, [clip, pasteBusy, ideToolsFull, rootDir, sessionId, workspaceFiles, t, onFileRenamed])

  // --- Drag & drop move (VS Code explorer drag) ---
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [dropBusy, setDropBusy] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)

  const dropInto = useCallback(async (sourceAbs: string, targetDir: string) => {
    if (dropBusy || !ideToolsFull) return
    const sourceParent = sourceAbs.slice(0, sourceAbs.lastIndexOf('/'))
    if (sourceAbs === targetDir || targetDir.startsWith(sourceAbs + '/') || sourceParent === targetDir) return
    setDropBusy(true)
    setDropError(null)
    try {
      const result = await ideToolsFull.fileMove(sessionId, relPathOf(rootDir, sourceAbs), targetDir === rootDir ? '' : relPathOf(rootDir, targetDir), undefined)
      if (!result.ok) { setDropError(result.error.message); return }
      setRefreshKey((k) => k + 1)
      setExpanded((prev) => (prev.has(targetDir) ? prev : new Set([...prev, targetDir])))
      onFileRenamed?.(sourceAbs, targetDir + '/' + sourceAbs.slice(sourceAbs.lastIndexOf('/') + 1))
    } catch (err) {
      setDropError(err instanceof Error ? err.message : String(err))
    } finally {
      setDropBusy(false)
    }
  }, [dropBusy, ideToolsFull, sessionId, rootDir, onFileRenamed])

  // --- Upload (VS Code explorer "Upload..."): native picker → writeFile ---
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadTarget, setUploadTarget] = useState<string | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const startUpload = useCallback((targetDir: string) => {
    setUploadError(null)
    setUploadTarget(targetDir)
    uploadInputRef.current?.click()
  }, [])

  const onUploadPicked = useCallback(async (files: FileList | null) => {
    if (files === null || files.length === 0 || uploadTarget === null || !ideToolsFull) return
    setUploadBusy(true)
    setUploadError(null)
    try {
      for (const file of Array.from(files)) {
        const text = await file.text()
        const targetRel = (uploadTarget === rootDir ? '' : relPathOf(rootDir, uploadTarget)) + (uploadTarget === rootDir || uploadTarget === '' ? '' : '/') + file.name
        const result = await ideToolsFull.writeFile(sessionId, targetRel, text, { kind: 'createIfAbsent' })
        if (!result.ok) {
          setUploadError(t('context.uploadFailed', { name: file.name, message: result.error.message }))
          break
        }
      }
      setRefreshKey((k) => k + 1)
      setExpanded((prev) => (prev.has(uploadTarget) ? prev : new Set([...prev, uploadTarget])))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadBusy(false)
      setUploadTarget(null)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }, [uploadTarget, ideToolsFull, sessionId, rootDir, t])

  // --- Download (VS Code explorer "Download..."): readBytes → Blob save ---
  const downloadEntry = useCallback(async (absPath: string) => {
    const rel = relPathOf(rootDir, absPath)
    const res = await workspaceFiles.readBytes(sessionId, rel, {})
    if (!res.ok) { setDropError(res.error.message); return }
    const name = absPath.slice(absPath.lastIndexOf('/') + 1)
    const blob = new Blob([res.value.data], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }, [sessionId, rootDir, workspaceFiles])

  // --- Open in terminal (VS Code "Open in Integrated Terminal") ---
  const openInTerminal = useCallback((absPath: string) => {
    // The terminal panel's default shell lands in the workspace root; opening
    // a terminal AT a directory is surfaced through the IdeView's terminal
    // toggle + a cd command via a new terminal session spec below.
    onOpenInTerminal?.(absPath)
  }, [onOpenInTerminal])

  // Keyboard navigation focus (VS Code list pattern): the focused row.
  const [focusPath, setFocusPath] = useState<string | null>(null)

  // --- Filter box (VS Code explorer type-to-filter): rows whose own name (or
  //  any loaded descendant row) matches stay visible; the input lives at the
  //  top of the tree. Matching is case-insensitive substring, like VS Code's
  //  fuzzy filter default. ---
  const [filterText, setFilterText] = useState('')
  // Visible row order, collected from the DOM after each commit — the tree
  // loads lazily per directory so this is the single source of truth for both
  // ↑/↓ keyboard movement and "does this directory contain a visible match".
  const [visiblePaths, setVisiblePaths] = useState<readonly string[]>([])
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.ide-explorer-tree .ide-tree-row[data-path]'))
      const paths = rows.map((r) => r.dataset.path ?? '')
      setVisiblePaths((prev) => (prev.join('\n') === paths.join('\n') ? prev : paths))
    })
    return () => cancelAnimationFrame(raf)
  })

  // Explorer header actions (IdeView's hover buttons call into these).
  useImperativeHandle(ref, () => ({
    refresh: () => setRefreshKey((k) => k + 1),
    collapseAll: () => setExpanded(new Set()),
    startCreate,
  }), [startCreate])

  const renderDir = (dirPath: string, state: DirState, depth: number) => {
    if (state.loading) {
      return <div className="ide-tree-loading">{t('tree.loading')}</div>
    }
    if (state.error) {
      return <div className="ide-tree-error">{t('tree.error', { message: state.error })}</div>
    }
    if (state.entries.length === 0) {
      return <div className="ide-tree-loading">{t('tree.empty')}</div>
    }
    return (
      <>
        {creating && creating.parentAbs === dirPath && (
          <NewEntryRow
            kind={creating.kind}
            depth={depth}
            busy={createBusy}
            serverError={createServerError}
            onCommit={(name) => { void commitCreate(name) }}
            onCancel={cancelCreate}
            onDraft={clearCreateServerError}
            t={t}
          />
        )}
        {state.entries.map((entry) => (
          <TreeNode
            key={entry.name}
            entry={entry}
            dirPath={dirPath}
            depth={depth}
            rootDir={rootDir}
            sessionId={sessionId}
            workspaceFiles={workspaceFiles}
            expanded={expanded}
            activePath={activePath}
            onToggle={toggle}
            onOpenFile={onOpenFile}
            loadDir={loadDir}
            t={t}
            gitFileMap={gitFileMap}
            gitDirMap={gitDirMap}
            renamingPath={renaming?.absPath}
            renameBusy={renameBusy}
            renameServerError={renameServerError}
            onRenameStart={startRename}
            onRenameCommit={commitRename}
            onRenameCancel={cancelRename}
            onRenameDraft={clearRenameServerError}
            onRequestDelete={startDelete}
            refreshKey={refreshKey}
            createFlow={creating && creating.parentAbs !== rootDir ? {
              parentAbs: creating.parentAbs,
              kind: creating.kind,
              busy: createBusy,
              serverError: createServerError,
              onCommit: (name) => { void commitCreate(name) },
              onCancel: cancelCreate,
              onDraft: clearCreateServerError,
            } : undefined}
            onCreateStart={startCreate}
            hostPlatform={hostPlatform}
            onReveal={revealEntry}
            clipState={clip}
            onCut={cutEntry}
            onCopy={copyEntry}
            onPaste={(d) => { void pasteInto(d) }}
            pasteBusy={pasteBusy}
            onDropInto={(s, d) => { void dropInto(s, d) }}
            dragOverDir={dragOver}
            setDragOverDir={setDragOver}
            onDownload={(p) => { void downloadEntry(p) }}
            onUpload={startUpload}
            onOpenInTerminal={openInTerminal}
            focusPath={focusPath}
            setFocusPath={setFocusPath}
            filterText={filterText}
            visiblePaths={visiblePaths}
          />
        ))}
        {state.truncated && <div className="ide-tree-truncated">{t('tree.truncated')}</div>}
      </>
    )
  }

  // Blank-area context menu (VS Code explorer background menu).
  const handleBlankContextMenu = (e: React.MouseEvent) => {
    // A row handles its own menu; only the empty background shows this one.
    if ((e.target as HTMLElement).closest('.ide-tree-row')) return
    e.preventDefault()
    e.stopPropagation()
    showContextMenu(e.clientX, e.clientY, [
      { id: 'new-file', label: t('context.newFile'), icon: Icons.newFile, onClick: () => startCreate('file', rootDir) },
      { id: 'new-folder', label: t('context.newFolder'), icon: Icons.newFolder, onClick: () => startCreate('directory', rootDir) },
      { id: 'sep1', label: '', separator: true },
      { id: 'paste', label: t('context.paste'), icon: Icons.paste, disabled: pasteBusy || !clip, onClick: () => { void pasteInto(rootDir) } },
      { id: 'upload', label: t('context.upload'), icon: Icons.upload, onClick: () => startUpload(rootDir) },
      { id: 'sep2', label: '', separator: true },
      { id: 'collapse-all', label: t('tree.collapseAll'), icon: Icons.chevronDown, onClick: () => setExpanded(new Set()) },
      { id: 'refresh', label: t('tree.refresh'), icon: Icons.refresh, onClick: () => setRefreshKey((k) => k + 1) },
    ])
  }

  const filterActive = filterText.trim().length > 0
  const filterMatchCount = filterActive
    ? visiblePaths.filter((p) => p.slice(p.lastIndexOf('/') + 1).toLowerCase().includes(filterText.trim().toLowerCase())).length
    : 0

  return (
    <div className="ide-sidebar-body ide-explorer-tree" onContextMenu={handleBlankContextMenu}>
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { void onUploadPicked(e.target.files) }}
      />
      <div className="ide-tree-filter">
        <span className="ide-tree-filter-icon">{Icons.search}</span>
        <input
          className="ide-tree-filter-input"
          value={filterText}
          placeholder={t('explorer.filterFiles')}
          spellCheck={false}
          aria-label={t('explorer.filterFiles')}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setFilterText('') } }}
        />
        {filterActive && (
          <button className="ide-tree-filter-clear" aria-label={t('tree.clearFilter')} onClick={() => setFilterText('')}>
            {Icons.close}
          </button>
        )}
        {filterActive && <span className="ide-tree-filter-count">{String(filterMatchCount)}</span>}
      </div>
      {notice && <div className="ide-tree-error">{notice}</div>}
      {(pasteError ?? dropError ?? uploadError) && (
        <div className="ide-tree-error">{pasteError ?? dropError ?? uploadError}</div>
      )}
      {uploadBusy && <div className="ide-tree-loading">{t('context.uploading')}</div>}
      {renderDir(rootDir, rootState, 0)}
      {pendingDelete && (
        <div
          className="ide-dialog-backdrop ide-dialog-modal"
          onMouseDown={(e) => { if (e.target === e.currentTarget) cancelDelete() }}
        >
          <div className="ide-dialog">
            <div className="ide-dialog-title">{t('context.delete')}</div>
            <div className="ide-dialog-body">
              {t('context.deleteConfirmBody', { type: pendingDelete.isDir ? t('context.folder') : t('context.file'), name: pendingDelete.name })}
              <br />
              {t('context.deleteIrreversible')}
            </div>
            {deleteError && <div className="ide-git-input-error">{t('context.deleteFailed', { message: deleteError })}</div>}
            <div className="ide-dialog-actions">
              <button className="ide-dialog-button ide-dialog-button-quiet" disabled={deleteBusy} onClick={cancelDelete}>
                <span>{t('git.cancel')}</span>
              </button>
              <button className="ide-dialog-button" disabled={deleteBusy} onClick={() => { void confirmDelete() }}>
                {deleteBusy ? Icons.loading : Icons.trash}
                <span>{t('context.confirm')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

/** A single row; directories recurse, files open. */
interface TreeNodeProps {
  entry: WorkspaceDirectoryEntry
  dirPath: string
  depth: number
  rootDir: string
  sessionId: SessionId
  workspaceFiles: WorkspaceFilesRemote
  expanded: Set<string>
  activePath: string | undefined
  onToggle: (dirPath: string) => void
  onOpenFile: (path: string) => void
  loadDir: (dirPath: string, signal: AbortSignal) => Promise<DirState>
  t: (key: string, params?: Record<string, string | number>) => string
  /** Absolute-path → git status entry (files only). */
  gitFileMap?: Map<string, GitStatusEntry>
  /** Absolute-path → dominant child kind (directories). */
  gitDirMap?: Map<string, GitStatusEntry['kind']>
  /** Absolute path currently being renamed inline (VS Code in-tree InputBox). */
  renamingPath?: string
  renameBusy?: boolean
  /** Server-side rename error shown under the editing row until the next attempt. */
  renameServerError?: string | null
  onRenameStart?: (absPath: string, initial: string) => void
  onRenameCommit?: (absPath: string, newName: string) => void
  onRenameCancel?: () => void
  onRenameDraft?: () => void
  onRequestDelete?: (absPath: string, name: string, isDir: boolean) => void
  /** Bumped by the parent after rename/delete so open directories re-list. */
  refreshKey?: number
  /** Active inline-create session (VS Code new-file/new-folder input); the node
   *  whose childPath equals parentAbs renders the input as its first child. */
  createFlow?: CreateFlow
  /** Start an inline-create input rooted at the given directory. */
  onCreateStart?: (kind: 'file' | 'directory', parentAbs: string) => void
  /** Host OS family, for the reveal action's label (undefined = not yet known). */
  hostPlatform?: 'darwin' | 'win32' | 'linux'
  /** Reveal the entry in the OS file manager. */
  onReveal?: (absPath: string, name: string) => void
  /** Explorer clipboard state (cut/copy), for the cut entry's dimmed style. */
  clipState?: { absPath: string; op: 'cut' | 'copy' } | null
  onCut?: (absPath: string, isDir: boolean) => void
  onCopy?: (absPath: string, isDir: boolean) => void
  onPaste?: (targetDir: string) => void
  pasteBusy?: boolean
  /** Drag & drop move: source absolute path → target directory. */
  onDropInto?: (sourceAbs: string, targetDir: string) => void
  dragOverDir?: string | null
  setDragOverDir?: (dir: string | null) => void
  /** Download the file (readBytes → Blob save). */
  onDownload?: (absPath: string) => void
  /** Upload files INTO this directory (native picker). */
  onUpload?: (targetDir: string) => void
  /** Open an integrated terminal AT this directory. */
  onOpenInTerminal?: (absDir: string) => void
  /** Keyboard focus ring (VS Code list focus). */
  focusPath?: string | null
  setFocusPath?: (p: string | null) => void
  /** Filter text; a non-matching subtree hides itself. */
  filterText?: string
  /** Flat visible-paths list for keyboard navigation (↑↓ movement). */
  visiblePaths?: readonly string[]
}

/** Everything the inline-create input needs, threaded from FileTree. */
interface CreateFlow {
  parentAbs: string
  kind: 'file' | 'directory'
  busy: boolean
  serverError: string | null
  onCommit: (rawName: string) => void
  onCancel: () => void
  onDraft: () => void
}

/**
 * Inline new-file/new-folder editor row (VS Code's explorerViewer new-entry
 * input): appears at the top of the target folder's listing with the entry's
 * icon; Enter commits when validation passes, Escape cancels, blur commits
 * when valid — an empty name cancels, exactly like VS Code dropping the
 * pending stat. Validation is VS Code's validateFileName with multi-segment
 * paths allowed (typing "sub/dir/name" creates the parents).
 */
function NewEntryRow({ kind, depth, busy, serverError, onCommit, onCancel, onDraft, t }: {
  kind: 'file' | 'directory'
  depth: number
  busy: boolean
  serverError: string | null
  onCommit: (rawName: string) => void
  onCancel: () => void
  onDraft: () => void
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const selectStateRef = useRef<'prefix' | 'all' | 'suffix'>('all')
  const issue = validateCreateName(draft, t)
  const isDir = kind === 'directory'

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const commit = () => {
    if (busy) return
    // VS Code: an empty pending name just drops the input (cancel).
    if (draft.trim().length === 0) { onCancel(); return }
    if (issue?.severity === 'error') return
    onCommit(draft)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'F2' && !isDir) {
      const value = e.currentTarget.value
      const dot = value.lastIndexOf('.')
      if (dot === -1) return
      const el = e.currentTarget
      if (selectStateRef.current === 'all') {
        selectStateRef.current = 'suffix'
        el.setSelectionRange(dot + 1, value.length)
      } else {
        selectStateRef.current = 'all'
        el.setSelectionRange(0, value.length)
      }
    }
  }

  const handleBlur = () => {
    if (busy) return
    if (draft.trim().length === 0 || issue?.severity === 'error') onCancel()
    else onCommit(draft)
  }

  const paddingLeft = depth * 12 + 4
  return (
    <>
      <div className="ide-tree-row" style={{ paddingLeft }} onClick={(e) => e.stopPropagation()}>
        <span className="ide-tree-chevron" />
        <span className="ide-tree-icon">{fileIcon(kind === 'directory' ? 'folder' : 'file.txt', isDir, false)}</span>
        <input
          ref={inputRef}
          className="ide-tree-rename-input"
          data-invalid={issue?.severity === 'error' || undefined}
          value={draft}
          aria-label={kind === 'directory' ? t('explorer.newFolder') : t('explorer.newFile')}
          spellCheck={false}
          onChange={(e) => { setDraft(e.target.value); onDraft() }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      </div>
      {issue?.severity === 'error' ? (
        <div className="ide-tree-rename-error" style={{ marginLeft: paddingLeft }}>{issue.message}</div>
      ) : serverError ? (
        <div className="ide-tree-rename-error" style={{ marginLeft: paddingLeft }}>{t('context.createFailed', { message: serverError })}</div>
      ) : issue ? (
        <div className="ide-tree-rename-warning" style={{ marginLeft: paddingLeft }}>{issue.message}</div>
      ) : null}
    </>
  )
}

function TreeNode({ entry, dirPath, depth, rootDir, sessionId, workspaceFiles, expanded, activePath, onToggle, onOpenFile, loadDir, t, gitFileMap, gitDirMap, renamingPath, renameBusy, renameServerError, onRenameStart, onRenameCommit, onRenameCancel, onRenameDraft, onRequestDelete, refreshKey, createFlow, onCreateStart, hostPlatform, onReveal, clipState, onCut, onCopy, onPaste, pasteBusy, onDropInto, dragOverDir, setDragOverDir, onDownload, onUpload, onOpenInTerminal, focusPath, setFocusPath, filterText, visiblePaths }: TreeNodeProps) {
  const childPath = joinPath(dirPath, entry.name)
  const isDir = entry.type === 'directory'
  const isOpen = expanded.has(childPath)
  const [childState, setChildState] = useState<DirState | null>(null)

  useEffect(() => {
    if (!isDir || !isOpen || childState !== null) return
    const ctrl = new AbortController()
    loadDir(childPath, ctrl.signal).then(setChildState)
    return () => ctrl.abort()
  }, [isDir, isOpen, childPath, loadDir, childState])

  // Rename/delete elsewhere in the tree invalidates this directory's cached
  // listing; nulling it makes the load effect above refetch (if open).
  useEffect(() => {
    setChildState(null)
  }, [refreshKey])

  const handleClick = () => {
    if (isDir) {
      if (isOpen) {
        // Collapse and forget children so reopening re-fetches.
        setChildState(null)
      }
      onToggle(childPath)
    } else {
      onOpenFile(childPath)
    }
  }

  const isActive = !isDir && activePath === childPath
  const paddingLeft = depth * 12 + 4

  // --- Explorer clipboard styling: a CUT entry is dimmed like VS Code. ---
  const isCut = clipState?.op === 'cut' && clipState.absPath === childPath

  // --- Filter: hide rows whose own/subtree names don't match. When the
  //  filter is active, directories stay expanded so matches are reachable. ---
  const filterLower = filterText?.trim().toLowerCase() ?? ''
  const matchesFilter = filterLower.length === 0
    || entry.name.toLowerCase().includes(filterLower)
    || (isDir && visiblePaths?.some((p) => p.startsWith(childPath + '/')) === true)
  // Hidden by filter: still run every hook above (React's rules-of-hooks), the
  // JSX below renders nothing when hidden.
  const hiddenByFilter = filterLower.length > 0 && !matchesFilter

  // --- Keyboard navigation (VS Code list pattern): ↑/↓ move focus, Enter
  //  opens/toggles, →/← expand/collapse, F2 renames, Delete deletes. ---
  const isFocused = focusPath === childPath
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const list = visiblePaths ?? []
    const idx = list.indexOf(childPath)
    const move = (delta: number) => {
      e.preventDefault()
      e.stopPropagation()
      const next = list[Math.min(list.length - 1, Math.max(0, idx + delta))]
      if (next !== undefined) {
        setFocusPath?.(next)
        document.querySelector<HTMLElement>('.ide-tree-row[data-path="' + CSS.escape(next) + '"]')?.focus()
      }
    }
    if (e.key === 'ArrowDown') { move(1); return }
    if (e.key === 'ArrowUp') { move(-1); return }
    if (e.key === 'ArrowRight' && isDir) { e.preventDefault(); if (!isOpen) onToggle(childPath); return }
    if (e.key === 'ArrowLeft' && isDir) { e.preventDefault(); if (isOpen) onToggle(childPath); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (isDir) onToggle(childPath)
      else onOpenFile(childPath)
      return
    }
    if (e.key === 'F2') { e.preventDefault(); onRenameStart?.(childPath, entry.name); return }
    if (e.key === 'Delete') { e.preventDefault(); onRequestDelete?.(childPath, entry.name, isDir); return }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') { e.preventDefault(); onCut?.(childPath, isDir); return }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); onCopy?.(childPath, isDir); return }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && isDir) { e.preventDefault(); onPaste?.(childPath); return }
  }
  // Files: look up their own git status entry. Directories: inherit the
  // dominant kind from their children (so a folder containing a modified
  // file shows the modification color too, like VS Code).
  const gitEntry = !isDir ? gitFileMap?.get(childPath) : undefined
  const dirKind = isDir ? gitDirMap?.get(childPath) : undefined
  const gitKind = gitEntry?.kind ?? dirKind
  const gitColor = gitKind ? gitStatusColor(gitKind) : undefined
  const gitLetter = gitKind ? gitStatusLetter(gitKind) : ''

  // --- Inline rename (VS Code explorerViewer.renderInputBox analog) ---
  const isRenaming = renamingPath === childPath
  const [draft, setDraft] = useState(entry.name)
  const selectStateRef = useRef<'prefix' | 'all' | 'suffix'>('prefix')
  const draftIssue = isRenaming ? validateNewName(draft, t) : null

  // Focus + select the name-without-extension on mount, like VS Code
  // (inputBox.select({ start: 0, end: lastDot > 0 && !isDirectory ? lastDot : length })).
  const focusRenameInput = useCallback((el: HTMLInputElement | null) => {
    if (el && isRenaming) {
      el.focus()
      const dot = entry.name.lastIndexOf('.')
      const end = dot > 0 && !isDir ? dot : entry.name.length
      el.setSelectionRange(0, end)
      selectStateRef.current = 'prefix'
    }
  }, [isRenaming, entry.name, isDir])

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // VS Code: Enter commits only when validation passes.
      if (draftIssue?.severity !== 'error') onRenameCommit?.(childPath, draft)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onRenameCancel?.()
    } else if (e.key === 'F2' && !isDir) {
      // VS Code: F2 cycles the selection prefix → all → suffix → prefix.
      const value = e.currentTarget.value
      const dot = value.lastIndexOf('.')
      if (dot === -1) return
      const el = e.currentTarget
      if (selectStateRef.current === 'prefix') {
        selectStateRef.current = 'all'
        el.setSelectionRange(0, value.length)
      } else if (selectStateRef.current === 'all') {
        selectStateRef.current = 'suffix'
        el.setSelectionRange(dot + 1, value.length)
      } else {
        selectStateRef.current = 'prefix'
        el.setSelectionRange(0, dot)
      }
    }
  }

  // VS Code: blur commits when valid, cancels when invalid. While a commit is
  // in flight (renameBusy) blur does nothing — the FileTree handler already
  // ignores duplicate/stale commits.
  const handleRenameBlur = () => {
    if (renameBusy) return
    if (draftIssue?.severity === 'error') onRenameCancel?.()
    else onRenameCommit?.(childPath, draft)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // The reveal item always renders: the prop starts as a navigator guess and
    // is refined by the authoritative ideTools.hostPlatform() answer.
    const revealPlatform: 'darwin' | 'win32' | 'linux' = hostPlatform ?? guessHostPlatform()
    const revealItem = {
      id: 'reveal',
      label: revealPlatform === 'darwin' ? t('context.revealInFinder') : revealPlatform === 'win32' ? t('context.revealInExplorer') : t('context.revealInFolder'),
      onClick: () => onReveal?.(childPath, entry.name),
    }
    const items = isDir ? [
      { id: 'new-file', label: t('context.newFile'), icon: Icons.newFile, onClick: () => onCreateStart?.('file', childPath) },
      { id: 'new-folder', label: t('context.newFolder'), icon: Icons.newFolder, onClick: () => onCreateStart?.('directory', childPath) },
      { id: 'sep1', label: '', separator: true },
      { id: 'cut', label: t('context.cut'), icon: Icons.cut, disabled: childPath === rootDir, onClick: () => onCut?.(childPath, true) },
      { id: 'copy-entry', label: t('context.copy'), icon: Icons.copy, disabled: childPath === rootDir, onClick: () => onCopy?.(childPath, true) },
      { id: 'paste', label: t('context.paste'), icon: Icons.paste ?? Icons.copy, disabled: pasteBusy || !clipState, onClick: () => onPaste?.(childPath) },
      { id: 'sep-clip', label: '', separator: true },
      { id: 'upload', label: t('context.upload'), icon: Icons.upload ?? Icons.goToFile, onClick: () => onUpload?.(childPath) },
      { id: 'open-terminal', label: t('context.openInTerminal'), icon: Icons.terminal, onClick: () => onOpenInTerminal?.(childPath) },
      { id: 'sep-ut', label: '', separator: true },
      { id: 'copy-path', label: t('context.copyPath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(childPath) } },
      { id: 'copy-rel-path', label: t('context.copyRelativePath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(childPath.replace(rootDir.replace(/[/\\]+$/, '') + '/', '')) } },
      { id: 'sep-reveal', label: '', separator: true },
      revealItem,
      { id: 'sep2', label: '', separator: true },
      { id: 'rename', label: t('context.rename'), icon: Icons.edit, disabled: childPath === rootDir, onClick: () => onRenameStart?.(childPath, entry.name) },
      { id: 'delete', label: t('context.delete'), icon: Icons.trash, disabled: childPath === rootDir, onClick: () => onRequestDelete?.(childPath, entry.name, true) },
    ] : [
      { id: 'open', label: t('context.open'), icon: Icons.goToFile, onClick: () => onOpenFile(childPath) },
      { id: 'new-file', label: t('context.newFile'), icon: Icons.newFile, onClick: () => onCreateStart?.('file', dirPath) },
      { id: 'new-folder', label: t('context.newFolder'), icon: Icons.newFolder, onClick: () => onCreateStart?.('directory', dirPath) },
      { id: 'sep1', label: '', separator: true },
      { id: 'cut', label: t('context.cut'), icon: Icons.cut, onClick: () => onCut?.(childPath, false) },
      { id: 'copy-entry', label: t('context.copy'), icon: Icons.copy, onClick: () => onCopy?.(childPath, false) },
      { id: 'sep-clip', label: '', separator: true },
      { id: 'download', label: t('context.download'), icon: Icons.download ?? Icons.goToFile, onClick: () => onDownload?.(childPath) },
      { id: 'copy-path', label: t('context.copyPath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(childPath) } },
      { id: 'copy-rel-path', label: t('context.copyRelativePath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(childPath.replace(rootDir.replace(/[/\\]+$/, '') + '/', '')) } },
      { id: 'sep-reveal', label: '', separator: true },
      revealItem,
      { id: 'sep2', label: '', separator: true },
      { id: 'rename', label: t('context.rename'), icon: Icons.edit, onClick: () => onRenameStart?.(childPath, entry.name) },
      { id: 'delete', label: t('context.delete'), icon: Icons.trash, onClick: () => onRequestDelete?.(childPath, entry.name, false) },
    ]
    showContextMenu(e.clientX, e.clientY, items)
  }

  if (hiddenByFilter) return null

  return (
    <>
      <div
        className="ide-tree-row"
        data-active={isActive || undefined}
        data-focused={isFocused || undefined}
        data-cut={isCut || undefined}
        data-path={childPath}
        data-drop-target={isDir && dragOverDir === childPath || undefined}
        style={{ paddingLeft }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        draggable={!isRenaming}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', childPath) }}
        onDragOver={isDir ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverDir !== childPath) setDragOverDir?.(childPath) } : undefined}
        onDragLeave={isDir ? () => { if (dragOverDir === childPath) setDragOverDir?.(null) } : undefined}
        onDrop={isDir ? (e) => {
          e.preventDefault()
          e.stopPropagation()
          const src = e.dataTransfer.getData('text/plain')
          setDragOverDir?.(null)
          if (src.length > 0 && src !== childPath && !src.startsWith(childPath + '/')) onDropInto?.(src, childPath)
        } : undefined}
        onFocus={() => setFocusPath?.(childPath)}
      >
        <span className="ide-tree-chevron" data-expanded={isOpen || undefined}>
          {isDir ? Icons.chevronRight : null}
        </span>
        <span className="ide-tree-icon">
          {fileIcon(entry.name, isDir, isOpen)}
        </span>
        {isRenaming ? (
          <input
            ref={focusRenameInput}
            className="ide-tree-rename-input"
            data-invalid={draftIssue?.severity === 'error' || undefined}
            value={draft}
            aria-label={t('context.rename')}
            spellCheck={false}
            onChange={(e) => { setDraft(e.target.value); onRenameDraft?.() }}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameBlur}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="ide-tree-name" style={gitColor ? ({ color: gitColor } as React.CSSProperties) : undefined}>{entry.name}</span>
        )}
        {gitLetter && (
          <span className="ide-tree-git-badge" style={gitColor ? ({ color: gitColor } as React.CSSProperties) : undefined}>{gitLetter}</span>
        )}
      </div>
      {isRenaming && (draftIssue?.severity === 'error' ? (
        <div className="ide-tree-rename-error" style={{ marginLeft: paddingLeft }}>{draftIssue.message}</div>
      ) : renameServerError ? (
        <div className="ide-tree-rename-error" style={{ marginLeft: paddingLeft }}>{t('context.renameFailed', { message: renameServerError })}</div>
      ) : draftIssue ? (
        <div className="ide-tree-rename-warning" style={{ marginLeft: paddingLeft }}>{draftIssue.message}</div>
      ) : null)}
      {isDir && isOpen && createFlow && createFlow.parentAbs === childPath && (
        <NewEntryRow
          kind={createFlow.kind}
          depth={depth + 1}
          busy={createFlow.busy}
          serverError={createFlow.serverError}
          onCommit={createFlow.onCommit}
          onCancel={createFlow.onCancel}
          onDraft={createFlow.onDraft}
          t={t}
        />
      )}
      {isDir && isOpen && childState && (
        <>{childState.entries.map((child) => (
          <TreeNode
            key={child.name}
            entry={child}
            dirPath={childPath}
            depth={depth + 1}
            rootDir={rootDir}
            sessionId={sessionId}
            workspaceFiles={workspaceFiles}
            expanded={expanded}
            activePath={activePath}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
            loadDir={loadDir}
            t={t}
            gitFileMap={gitFileMap}
            gitDirMap={gitDirMap}
            renamingPath={renamingPath}
            renameBusy={renameBusy}
            renameServerError={renameServerError}
            onRenameStart={onRenameStart}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            onRenameDraft={onRenameDraft}
            onRequestDelete={onRequestDelete}
            refreshKey={refreshKey}
            createFlow={createFlow}
            onCreateStart={onCreateStart}
            hostPlatform={hostPlatform}
            onReveal={onReveal}
            clipState={clipState}
            onCut={onCut}
            onCopy={onCopy}
            onPaste={onPaste}
            pasteBusy={pasteBusy}
            onDropInto={onDropInto}
            dragOverDir={dragOverDir}
            setDragOverDir={setDragOverDir}
            onDownload={onDownload}
            onUpload={onUpload}
            onOpenInTerminal={onOpenInTerminal}
            focusPath={focusPath}
            setFocusPath={setFocusPath}
            filterText={filterText}
            visiblePaths={visiblePaths}
          />
        ))}</>
      )}
    </>
  )
}
