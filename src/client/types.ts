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

/** The workspace-files Remote face bound under `ctx.remote.workspaceFiles`.
 *
 *  DSH 0.1.7 renamed the binary reader `readAll` → `readBytes` and changed
 *  its result `data` from a base64 string to a native `Uint8Array`; the
 *  `changes` stream now takes an explicit `path` (a workspace-relative path,
 *  empty for the workspace root) instead of subscribing to the whole session. */
export interface WorkspaceByteReadOptions {
  readonly range?: { readonly offset?: number; readonly length?: number }
  readonly baseFile?: string
}
export interface WorkspaceFilesRemote {
  stat(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileStat>>
  read(sessionId: SessionId, path: string, range: { offset?: number; limit?: number }, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileText>>
  readBytes(sessionId: SessionId, path: string, options: WorkspaceByteReadOptions, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileBytes>>
  list(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<RemoteResult<WorkspaceDirectoryListing>>
  changes(sessionId: SessionId, path: string, signal?: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>
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
  readonly data: Uint8Array
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
  /** The shell's exit code, present only on the terminal's final frame. */
  readonly exitCode?: number | null
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
  /** Remote-tracking branches (origin/main, …), when requested. */
  readonly remoteBranches?: readonly GitRemoteBranch[]
  /** Configured remote names (git remote), when requested. */
  readonly remotes?: readonly string[]
  readonly current: string | undefined
}

/** One remote-tracking branch (refs/remotes, without the remote's HEAD). */
export interface GitRemoteBranch {
  /** Short name including the remote, e.g. 'origin/main'. */
  readonly name: string
  readonly lastCommit?: string
  readonly lastCommitDate?: string
}

/** One decorated reference pointing at a commit (graph pill). */
export interface GitLogRef {
  /** Short display name ('main', 'origin/main', 'v1.0'). */
  readonly name: string
  /** Reference class: local branch / remote-tracking branch / tag. */
  readonly type: 'head' | 'remote' | 'tag'
  /** True for the checked-out branch (or the HEAD itself). */
  readonly current: boolean
}

/** One commit in the source-control graph history. */
export interface GitLogEntry {
  /** Full 40-char commit hash (swimlane node id). */
  readonly hash: string
  /** Abbreviated hash for display. */
  readonly displayId: string
  /** Parent hashes (first parent first). */
  readonly parents: readonly string[]
  readonly author: string
  readonly authorEmail: string
  /** Author date, unix seconds. */
  readonly authorDate: number
  /** Subject line (single line). */
  readonly subject: string
  /** Decorated refs at this commit (branches, remotes, tags). */
  readonly refs: readonly GitLogRef[]
}

/** Result of one gitLog page (VS Code SCM Graph history provider). */
export interface GitLogResult {
  readonly notARepo: boolean
  /** Page of commits, newest first (topo-order). */
  readonly commits: readonly GitLogEntry[]
  /** True when more commits exist beyond this page (Load More). */
  readonly hasMore: boolean
  /** HEAD commit hash (undefined when the repo has no commits). */
  readonly head: string | undefined
  /** Current branch short name (undefined when detached). */
  readonly currentBranch: string | undefined
  /** Upstream tracking ref of the current branch, when set. */
  readonly upstream: string | undefined
  readonly detached: boolean
}

/** One file changed by a commit (gitCommitDetails). */
export interface GitCommitFile {
  readonly path: string
  /** Previous path for renames/copies. */
  readonly oldPath?: string
  readonly kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'binary'
  /** Line insertions (undefined for binary files). */
  readonly additions?: number
  /** Line deletions (undefined for binary files). */
  readonly deletions?: number
}

/** Metadata + changed files of one commit (VS Code commit details view). */
export interface GitCommitDetailsResult {
  readonly hash: string
  readonly displayId: string
  readonly author: string
  readonly authorEmail: string
  readonly authorDate: number
  readonly subject: string
  /** Full commit message (subject + body, trimmed). */
  readonly message: string
  readonly parents: readonly string[]
  readonly refs: readonly GitLogRef[]
  readonly files: readonly GitCommitFile[]
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
  /** Content type hint. 'text' for plain text (default), 'image' for binary image files,
   *  'binary' for non-image binaries (no content — the client shows a placeholder). */
  readonly contentType?: 'text' | 'image' | 'binary'
  /** For image files, the new content as a base64 data URI (e.g. data:image/png;base64,...). */
  readonly imageBase64?: string
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
  terminalResize(sessionId: SessionId, terminalId: string, cols: number, rows: number, signal?: AbortSignal): Promise<RemoteResult<void>>
  terminalOutput(sessionId: SessionId, terminalId: string, signal?: AbortSignal): AsyncIterable<IdeTerminalOutputFrame>
  /** Snapshot the workspace's git status (branch, ahead/behind, changed files). */
  gitStatus(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<GitStatusResult>>
  /** List local branches with ahead/behind and last-commit metadata. */
  gitBranches(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<GitBranchesResult>>
  /** One page of the SCM graph history (VS Code Source Control Graph).
   *  scope 'current' walks HEAD, 'all' every ref, 'branch' one named ref. */
  gitLog(sessionId: SessionId, options: { limit?: number; skip?: number; scope?: 'current' | 'all' | 'branch'; ref?: string }, signal?: AbortSignal): Promise<RemoteResult<GitLogResult>>
  /** One commit's metadata + changed files (graph commit details). */
  gitCommitDetails(sessionId: SessionId, sha: string, signal?: AbortSignal): Promise<RemoteResult<GitCommitDetailsResult>>
  /** Old/new content + patch of ONE file inside one commit. */
  gitCommitFileDiff(sessionId: SessionId, sha: string, path: string, oldPath?: string, signal?: AbortSignal): Promise<RemoteResult<GitDiffResult>>
  /** Check out a branch, a remote branch (creating the local tracking branch
   *  via localName), or a detached commit (detach: true). */
  gitCheckout(sessionId: SessionId, spec: { ref: string; localName?: string; detach?: boolean }, signal?: AbortSignal): Promise<RemoteResult<void>>
  /** Create a branch at HEAD (or an explicit revision), optionally checking it out. */
  gitCreateBranch(sessionId: SessionId, name: string, revision?: string, checkout?: boolean, signal?: AbortSignal): Promise<RemoteResult<void>>
  /** Delete a LOCAL branch (-d, or -D when force). */
  gitDeleteBranch(sessionId: SessionId, name: string, force?: boolean, signal?: AbortSignal): Promise<RemoteResult<void>>
  /** Fetch remotes with prune (prefers 'origin', falls back to --all). */
  gitFetch(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<void>>
  /** Fetch a unified diff (and old/new content) for one path. */
  gitDiff(sessionId: SessionId, path: string, kind: 'unstaged' | 'staged' | 'head', signal?: AbortSignal): Promise<RemoteResult<GitDiffResult>>
  /** Stage all changes (git add -A) and commit with a message. Options map
   *  the commit split-button dropdown (VS Code SCM parity): amend rewrites
   *  the last commit (an empty message keeps the previous one), signoff adds
   *  a Signed-off-by trailer, push runs git push, sync runs git pull + push. */
  gitCommit(sessionId: SessionId, message: string, options: { amend?: boolean; signoff?: boolean; push?: boolean; sync?: boolean }, signal?: AbortSignal): Promise<RemoteResult<{ committed: boolean; hash?: string; pushed?: boolean }>>
  /** Stage all changes (git add -A). */
  gitStageAll(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<void>>
  /** Stage one path (git add -- path). */
  gitStage(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<RemoteResult<void>>
  /** Discard one entry's uncommitted changes (index + working tree back to HEAD;
   *  untracked files are deleted, staged adds are unstaged and removed). */
  gitDiscard(sessionId: SessionId, entry: { path: string; oldPath?: string; kind: GitStatusEntry['kind'] }, signal?: AbortSignal): Promise<RemoteResult<void>>
  /** VS Code SCM action button: 'sync' = git pull + git push on the clean
   *  tree; 'publish' = git push -u origin <branch> for a branch without an
   *  upstream. */
  gitSync(sessionId: SessionId, action: 'sync' | 'publish', signal?: AbortSignal): Promise<RemoteResult<{ pushed: boolean }>>
  /** Generate a Conventional Commits message from the current diff via the configured LLM. */
  gitGenerateCommitMessage(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<{ message: string }>>
  /** Rename one workspace entry within its directory (Explorer context menu).
   *  Paths are workspace-relative; the host refuses anything escaping the
   *  workspace root and refuses an existing target. */
  fileRename(sessionId: SessionId, path: string, newName: string, signal?: AbortSignal): Promise<RemoteResult<void>>
  /** Delete one file (or a directory recursively) from the workspace.
   *  Same workspace-root confinement; an already-gone path is a success. */
  fileDelete(sessionId: SessionId, path: string, kind: 'file' | 'directory', signal?: AbortSignal): Promise<RemoteResult<void>>
  /** Create one new workspace entry (file with empty content, or directory).
   *  Missing parents are created; an existing target is refused. */
  fileCreate(sessionId: SessionId, path: string, kind: 'file' | 'directory', signal?: AbortSignal): Promise<RemoteResult<void>>
  /** Write one file's whole content through the host fs seam (bounded write
   *  with an optimistic version guard). Backs the editor save and the diff
   *  panel's edit-save; the workspaceFilesWrite face below adapts onto it. */
  writeFile(
    sessionId: SessionId,
    path: string,
    content: string,
    intent: WorkspaceFileWriteIntent | undefined,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkspaceFileWriteResult>>
  /** Reveal one workspace entry in the OS file manager (VS Code parity:
   *  Reveal in Finder / Reveal in File Explorer / Open Containing Folder).
   *  Pass '' to reveal the workspace root itself. */
  fileReveal(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<RemoteResult<void>>
  /** The host OS family ('darwin' | 'win32' | 'linux' | ...), for platform-
   *  specific UI labels. */
  hostPlatform(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<string>>
}

/** Props injected into the IdeView by the conversation.view slot registration. */
export interface IdeViewInjected {
  /** Current Session identity whose workspace root the IDE reads. */
  sessionId: SessionId
  /** Current Session workspace root absolute path, when known. */
  cwd: string | undefined
  /** Workspace-files Remote face, already bound to the session. */
  workspaceFiles: WorkspaceFilesRemote
  /** Workspace-files-write Remote face (bounded writes). Built by this
   *  package's own client bundle as a thin adapter over the ideTools
   *  namespace's writeFile (see ./index.ts) — the standalone package that used
   *  to provide it was never published. Same method shape and error codes as
   *  before, so the editor and the diff panel are unchanged. */
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
  /** Current AI model identifier, when known (shown in the status bar). */
  model?: string
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
    $mount(artifact: unknown): Promise<() => void>
  }
}
