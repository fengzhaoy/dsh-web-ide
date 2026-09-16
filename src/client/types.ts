/**
 * Runtime types for the IDE view. The host context `ctx` is loosely typed here
 * (matching the trajectory plugin convention): the `inject` array names the
 * services the boot kernel resolves before calling `apply`, and the kernel
 * shapes `ctx` accordingly. We type only what we touch.
 */
import type { ReactNode } from 'react'

/** Session identifiers are opaque strings on the wire. */
export type SessionId = string

/** Result shape of a workspace-files Remote call: ok/value or an error. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The workspace-files Remote face bound under `ctx.remote.workspaceFiles`. */
export interface WorkspaceFilesRemote {
  stat(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileStat>>
  read(sessionId: SessionId, path: string, range: { offset?: number; limit?: number }, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileText>>
  readAll(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileBytes>>
  list(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<RemoteResult<WorkspaceDirectoryListing>>
  changes(sessionId: SessionId, signal?: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>
}

export interface WorkspaceFileStat {
  readonly absolutePath: string
  readonly version: string
  readonly bytes?: number
}
export interface WorkspaceFileText extends WorkspaceFileStat {
  readonly offset: number
  readonly text: string
  readonly lines: number
  readonly eof: boolean
}
export interface WorkspaceFileBytes extends WorkspaceFileStat {
  readonly offset: number
  readonly data: string
  readonly eof: boolean
}
export interface WorkspaceDirectoryEntry {
  readonly name: string
  readonly type: 'file' | 'directory' | 'other'
  readonly size?: number
}
export interface WorkspaceDirectoryListing {
  readonly path: string
  readonly entries: readonly WorkspaceDirectoryEntry[]
  readonly truncated: boolean
}
export type WorkspaceFileChange =
  | { readonly absolutePath: string; readonly version: string }
  | { readonly absolutePath: string; readonly absent: true }
export type WorkspaceFileWatchFrame =
  | { readonly kind: 'ready' }
  | { readonly kind: 'change'; readonly change: WorkspaceFileChange }

/** Result of one bounded write through the workspace-files-write Remote. */
export interface WorkspaceFileWriteResult {
  readonly absolutePath: string
  readonly version: string
  readonly operation: 'create' | 'update'
  readonly bytes: number
}

/** Write intent forwarded to the fs seam's writeText. */
export type WorkspaceFileWriteIntent =
  | { readonly kind: 'createIfAbsent' }
  | { readonly kind: 'replaceIfVersion'; readonly version: string }

/** The workspace-files-write Remote face bound under ctx.remote.workspaceFilesWrite. */
export interface WorkspaceFilesWriteRemote {
  write(
    sessionId: SessionId,
    path: string,
    content: string,
    intent: WorkspaceFileWriteIntent | undefined,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkspaceFileWriteResult>>
}

/** One workspace grep hit. */
export interface IdeSearchMatch {
  readonly path: string
  readonly lineNumber: number
  readonly line: string
}
export interface IdeSearchResult {
  readonly matches: readonly IdeSearchMatch[]
  readonly truncated: boolean
  readonly totalMatches: number
}
export interface IdeTerminalOpenResult {
  readonly terminalId: string
  readonly pid: number
}
export interface IdeTerminalOutputFrame {
  readonly data: string
  readonly exit: boolean
}
export type IdeTerminalSignalName = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'

/** One entry in the workspace's git status. */
export interface GitStatusEntry {
  /** Workspace-relative path (uses '/' separators). */
  readonly path: string
  /** Renamed-from path when status is 'R'. */
  readonly oldPath?: string
  /** Worktree status code (index x working-tree y, e.g. ' M', 'M ', 'A ', 'D ', 'R '). */
  readonly statusCode: string
  /** Human-friendly change kind for icon/color mapping. */
  readonly kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'ignored' | 'conflicted' | 'unmodified'
}

/** Aggregated git status for the workspace. */
export interface GitStatusResult {
  /** True when the cwd is not inside a git repository. */
  readonly notARepo: boolean
  /** Current branch name (HEAD short name), when known. */
  readonly branch: string | undefined
  /** Upstream tracking branch name, when configured. */
  readonly upstream: string | undefined
  /** Commits ahead of upstream. */
  readonly ahead: number
  /** Commits behind upstream. */
  readonly behind: number
  /** Detached HEAD state. */
  readonly detached: boolean
  /** All changed entries (staged + unstaged + untracked), no dups. */
  readonly entries: readonly GitStatusEntry[]
  /** True when there are no changes (clean working tree). */
  readonly clean: boolean
}

/** One local branch summary. */
export interface GitBranch {
  readonly name: string
  readonly current: boolean
  readonly upstream?: string
  readonly ahead?: number
  readonly behind?: number
  readonly lastCommit?: string
  readonly lastCommitDate?: string
}

/** Local branches list. */
export interface GitBranchesResult {
  readonly notARepo: boolean
  readonly branches: readonly GitBranch[]
  readonly current: string | undefined
}

/** A unified diff for one file path. */
export interface GitDiffResult {
  /** True when the path has no changes (empty diff). */
  readonly empty: boolean
  /** The raw unified diff text (git diff output). */
  readonly diff: string
  /** Old file content (HEAD or empty for added). */
  readonly oldContent: string
  /** New file content (working tree or index). */
  readonly newContent: string
  /** Old path (may differ for renames). */
  readonly oldPath: string
  /** New path. */
  readonly newPath: string
  /** Detected language id for Monaco. */
  readonly language: string
}

/** The ideTools Remote face bound under ctx.remote.ideTools (self-mounted by
 *  this package's client bundle). */
export interface IdeToolsRemote {
  search(
    sessionId: SessionId,
    query: { pattern: string; include?: string; path?: string; caseSensitive: boolean },
    signal?: AbortSignal,
  ): Promise<RemoteResult<IdeSearchResult>>
  terminalOpen(
    sessionId: SessionId,
    spec: { cols: number; rows: number; command?: string },
    signal?: AbortSignal,
  ): Promise<RemoteResult<IdeTerminalOpenResult>>
  terminalWrite(sessionId: SessionId, terminalId: string, data: string, signal?: AbortSignal): Promise<RemoteResult<void>>
  terminalSignal(sessionId: SessionId, terminalId: string, signalName: IdeTerminalSignalName, signal?: AbortSignal): Promise<RemoteResult<void>>
  terminalTerminate(sessionId: SessionId, terminalId: string, signal?: AbortSignal): Promise<RemoteResult<void>>
  terminalOutput(sessionId: SessionId, terminalId: string, signal?: AbortSignal): AsyncIterable<IdeTerminalOutputFrame>
  /** Snapshot the workspace's git status (branch, ahead/behind, changed files). */
  gitStatus(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<GitStatusResult>>
  /** List local branches with ahead/behind and last-commit metadata. */
  gitBranches(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<GitBranchesResult>>
  /** Fetch a unified diff (and old/new content) for one path. */
  gitDiff(sessionId: SessionId, path: string, kind: 'unstaged' | 'staged' | 'head', signal?: AbortSignal): Promise<RemoteResult<GitDiffResult>>
  /** Stage all changes (git add -A) and commit with a message. */
  gitCommit(sessionId: SessionId, message: string, signal?: AbortSignal): Promise<RemoteResult<{ committed: boolean; hash?: string }>>
  /** Stage all changes (git add -A). */
  gitStageAll(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<void>>
}

/** Props injected into the IdeView by the conversation.view slot registration. */
export interface IdeViewInjected {
  /** Current Session identity whose workspace root the IDE reads. */
  sessionId: SessionId
  /** Current Session workspace root absolute path, when known. */
  cwd: string | undefined
  /** Workspace-files Remote face, already bound to the session. */
  workspaceFiles: WorkspaceFilesRemote
  /** Workspace-files-write Remote face (bounded writes), mounted by the
   *  dsh-api-workspace-files-write browser bundle; the service-level inject
   *  array makes the kernel resolve it before this view registers. */
  workspaceFilesWrite: WorkspaceFilesWriteRemote
  /** ideTools Remote face (workspace grep + interactive terminals), mounted by
   *  this package's own client bundle. Delivered as a lazy getter: the slot's
   *  inject factory runs while the browser boot is still settling, and reading
   *  a namespace that is not yet mounted THROWS and poisons the whole
   *  conversation.view slot — the getter defers the read to component render,
   *  safely after boot. */
  ideTools: () => IdeToolsRemote
  /** Locale-bound translate from ctx.locale.bind; the view keeps a fallback. */
  t?: (key: string, params?: Record<string, string | number>) => string
}

/** Loose client context shaped by the boot kernel from the `inject` array. */
export interface IdeClientContext {
  effect(fn: () => unknown, name?: string): () => void
  slots: {
    inject<T>(name: string, register: () => T): T
    register(options: unknown, component: (props: unknown) => ReactNode): unknown
  }
  sessions: {
    list: {
      getSnapshot(): {
        byId: Record<string, { cwd?: string } | undefined>
        current: string | undefined
      }
    }
  }
  locale: {
    register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(ns: string): (key: string, params?: Record<string, string | number>) => string
  }
  remote: {
    workspaceFiles: WorkspaceFilesRemote
    workspaceFilesWrite: WorkspaceFilesWriteRemote
    ideTools: IdeToolsRemote
    $mount(artifact: unknown): Promise<() => void>
  }
}
