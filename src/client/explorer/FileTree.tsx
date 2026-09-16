import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitStatusEntry, SessionId, WorkspaceDirectoryEntry, WorkspaceDirectoryListing, WorkspaceFilesRemote } from '../types.js'
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

export function FileTree({ sessionId, rootDir, workspaceFiles, activePath, onOpenFile, t, gitEntries }: FileTreeProps) {
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

  // Load root once on mount / session change.
  useEffect(() => {
    const ctrl = new AbortController()
    setRootState({ entries: [], truncated: false, loading: true, error: null })
    loadDir(rootDir, ctrl.signal).then(setRootState)
    return () => ctrl.abort()
  }, [loadDir, rootDir])

  const toggle = useCallback((dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

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
          />
        ))}
        {state.truncated && <div className="ide-tree-truncated">{t('tree.truncated')}</div>}
      </>
    )
  }

  return <div className="ide-sidebar-body">{renderDir(rootDir, rootState, 0)}</div>
}

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
}

function TreeNode({ entry, dirPath, depth, rootDir, sessionId, workspaceFiles, expanded, activePath, onToggle, onOpenFile, loadDir, t, gitFileMap, gitDirMap }: TreeNodeProps) {
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
  // Files: look up their own git status entry. Directories: inherit the
  // dominant kind from their children (so a folder containing a modified
  // file shows the modification color too, like VS Code).
  const gitEntry = !isDir ? gitFileMap?.get(childPath) : undefined
  const dirKind = isDir ? gitDirMap?.get(childPath) : undefined
  const gitKind = gitEntry?.kind ?? dirKind
  const gitColor = gitKind ? gitStatusColor(gitKind) : undefined
  const gitLetter = gitKind ? gitStatusLetter(gitKind) : ''

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const items = isDir ? [
      { id: 'new-file', label: t('context.newFile'), icon: Icons.newFile, onClick: () => onOpenFile(childPath) },
      { id: 'new-folder', label: t('context.newFolder'), icon: Icons.newFolder },
      { id: 'sep1', label: '', separator: true },
      { id: 'copy-path', label: t('context.copyPath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(childPath) } },
      { id: 'copy-rel-path', label: t('context.copyRelativePath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(childPath.replace(rootDir.replace(/[/\\]+$/, '') + '/', '')) } },
      { id: 'sep2', label: '', separator: true },
      { id: 'rename', label: t('context.rename'), icon: Icons.edit, disabled: depth === 0 },
      { id: 'delete', label: t('context.delete'), icon: Icons.trash, disabled: depth === 0 },
    ] : [
      { id: 'open', label: t('context.open'), icon: Icons.goToFile, onClick: () => onOpenFile(childPath) },
      { id: 'sep1', label: '', separator: true },
      { id: 'copy-path', label: t('context.copyPath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(childPath) } },
      { id: 'copy-rel-path', label: t('context.copyRelativePath'), icon: Icons.copy, onClick: () => { void navigator.clipboard.writeText(childPath.replace(rootDir.replace(/[/\\]+$/, '') + '/', '')) } },
      { id: 'sep2', label: '', separator: true },
      { id: 'rename', label: t('context.rename'), icon: Icons.edit },
      { id: 'delete', label: t('context.delete'), icon: Icons.trash },
    ]
    showContextMenu(e.clientX, e.clientY, items)
  }

  return (
    <>
      <div
        className="ide-tree-row"
        data-active={isActive || undefined}
        style={{ paddingLeft }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="ide-tree-chevron" data-expanded={isOpen || undefined}>
          {isDir ? Icons.chevronRight : null}
        </span>
        <span className="ide-tree-icon">
          {fileIcon(entry.name, isDir, isOpen)}
        </span>
        <span className="ide-tree-name" style={gitColor ? ({ color: gitColor } as React.CSSProperties) : undefined}>{entry.name}</span>
        {gitLetter && (
          <span className="ide-tree-git-badge" style={gitColor ? ({ color: gitColor } as React.CSSProperties) : undefined}>{gitLetter}</span>
        )}
      </div>
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
          />
        ))}</>
      )}
    </>
  )
}
