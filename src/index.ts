/**
 * Host loader entry for the IDE plugin: one typert Remote service (namespace
 * 'ideTools') carrying the IDE's host-backed conveniences —
 *
 *  - search: workspace grep over ripgrep, reusing dsh-tool-fs-search's
 *    argv builder, runner, and --json parser verbatim;
 *  - terminal*: interactive human terminals over ctx.subprocess.spawnTerminal
 *    (node-pty backed), with a bounded scrollback replay so a client that
 *    unsubscribed (view unmount) and resubscribed sees everything it missed.
 *
 * The browser face (view registration) lives in ./client; this file is loaded
 * only by the host.
 */
import type { Context } from '@deepseek-ai/cordis'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteErrorDetailsMap } from '@deepseek-ai/dsh-typert-protocol'
// The plugin's ide-tools/* and workspace-file-write/* failure codes are
// declaration-merged into the typert protocol's extensible
// RemoteErrorDetailsMap by src/remote-errors.d.ts (DSH 0.2.0 narrowed
// RemoteError's code argument to keyof RemoteErrorDetailsMap). That .d.ts is
// picked up by tsconfig's include:["src"], so no runtime import is needed.
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import {
  buildGrepCommand,
  parseGrepMatches,
  previewLine,
  runRipgrep,
  RAW_OUTPUT_MAX_BYTES,
  SEARCH_GRACE_MS,
  SEARCH_STDERR_MAX_BYTES,
  GREP_MAX_LINE_BYTES,
} from '@deepseek-ai/dsh-tool-fs-search'

/** Prototype marker the typert protocol's Remote decorators write; declared
 * here as a plain property so this package needs no decorator lowering
 * (rolldown's native transform passes Stage-3 decorator syntax through, which
 * Node cannot parse). The gateway's source-mode discovery and remoteMethods()
 * readers consume exactly this shape. */
const REMOTE_METHODS_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/**
 * Resolve a workspace-relative path against the workspace root, refusing any
 * escape: absolute input resolves outside the root (resolve() replaces the
 * base), '..' traversal climbs out, and the root itself is not a writable
 * entry. Used by the Explorer's rename/delete host methods so a malicious or
 * buggy client can never touch files outside the session's workspace.
 */
function resolveWorkspacePath(workspaceRoot: string, relPath: string): string {
  const root = resolve(workspaceRoot)
  const abs = resolve(root, relPath)
  if (abs === root || !abs.startsWith(root + sep)) {
    throw new Error('path escapes the workspace root')
  }
  return abs
}

/**
 * Guarded write intent, mirroring the host fs seam's own union: `createIfAbsent`
 * refuses an existing target, `replaceIfVersion` refuses a version mismatch.
 * An omitted intent means unconditional create-or-overwrite.
 */
export type WorkspaceFileWriteIntent =
  | { readonly kind: 'createIfAbsent' }
  | { readonly kind: 'replaceIfVersion'; readonly version: string }

/** Outcome of one bounded write through this namespace (the browser's tabs and
 *  diff panel read `version` back as the new optimistic-concurrency token). */
export interface WorkspaceFileWriteResult {
  readonly absolutePath: string
  readonly version: string
  readonly operation: 'create' | 'update'
  readonly bytes: number
}

/**
 * The write face of the host `fs` seam (dsh-fs), declared structurally: this
 * package deliberately takes no dependency on dsh-fs, but a content write must
 * still go through the seam so the deployment's sandbox policy fences it and
 * the version guard is the backend's own — exactly as for the agent's fs tools.
 * The two calls this file makes are `resolve` (path → opaque target token) and
 * `writeText` (the guarded whole-file write).
 */
interface FsWriteSeam {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  writeText(
    target: unknown,
    content: string,
    expected?: WorkspaceFileWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxWritePolicy,
  ): Promise<{ readonly operation: 'create' | 'update'; readonly version: string }>
}

/** The per-call fence the sandboxed fs backend enforces: `read-only` denies
 *  every mutation, `workspace-write` requires containment under `workspaceRoot`. */
interface SandboxWritePolicy {
  readonly mode: string
  readonly workspaceRoot: string
}

/**
 * The two host services that turn a wire-level Session id into that fence,
 * declared structurally like the fs seam above. `sessions.get(id).header.cwd` is
 * the Session workspace directory; `sandboxPolicy.resolve` folds it together
 * with the Session's standing mode (its last `sandbox/mode` event, else the
 * deployment default) — the same resolution the browser terminal controller
 * performs for its own user-driven calls.
 */
interface SessionsSeam {
  get(id: string): { readonly header?: { readonly cwd?: string } } | undefined
}
interface SandboxPolicySeam {
  resolve(request?: { session?: unknown }): SandboxWritePolicy
}
/**
 * The host context slice a write fence is resolved from (see writePolicyFor),
 * reached through cordis's soft lookup rather than `static inject`: a plugin
 * that HARD-depends on a service it cannot resolve takes the whole plugin tree
 * down with it — which is exactly how this package's install used to crash
 * `dsh web`. Both services only ever NARROW a save that the caller's own
 * confinement has already bounded, so their absence degrades the fence, never
 * the editor.
 */
interface WritePolicyContext {
  get?(name: string): unknown
}

/**
 * The fence stamped onto one save: the Session's standing mode (its last
 * `sandbox/mode` event, else the deployment default) over the Session's own
 * workspace directory.
 *
 * Resolving it per call — rather than letting the seam fall back — is what makes
 * a save land wherever `dsh web` was launched from. Without a policy the seam
 * uses the DEPLOYMENT default root, which is the server process's `cwd()`: a
 * server started outside the workspace (a `cd /tmp && dsh web`, a service
 * manager's working directory) then denies every save to a file that the
 * Session, and the browser, consider plainly inside the workspace.
 *
 * `scope.workspaceRoot` is host-derived — the typert `workspaceFileScope` lookup
 * fills it from the same `header.cwd` the policy would read — so it stands in
 * for the Session's directory when the Session is no longer live (a save racing
 * a reconnect) and is used verbatim then.
 *
 * An absent policy service means an unsandboxed backend, which ignores the
 * argument entirely; returning undefined rather than inventing a mode keeps this
 * file from widening a fence it did not establish.
 */
function writePolicyFor(
  ctx: WritePolicyContext,
  scope: { sessionId: string; workspaceRoot: string },
): SandboxWritePolicy | undefined {
  const sandboxPolicy = ctx.get?.('sandboxPolicy') as SandboxPolicySeam | undefined
  if (sandboxPolicy === undefined) return undefined
  const sessions = ctx.get?.('sessions') as SessionsSeam | undefined
  const session = sessions?.get(scope.sessionId)
  const policy = sandboxPolicy.resolve(session === undefined ? {} : { session })
  return { mode: policy.mode, workspaceRoot: scope.workspaceRoot || policy.workspaceRoot }
}

/**
 * The fs seam's stable `FsError` codes mapped onto this namespace's own, which
 * the browser already branches on — notably 'workspace-file-write/stale-version',
 * which opens the diff panel's and the editor's reload/overwrite conflict
 * prompt. `FS_SANDBOX_DENIED` is the seam's single refusal code for both
 * boundaries it enforces (outside the writable roots, and the Session standing
 * at `read-only`); its own message already names which one, and that message —
 * not the code — is what the editor's 保存失败 banner shows. Unmapped codes
 * collapse to a generic write failure.
 */
const FS_WRITE_ERROR_CODES: Readonly<Record<string, string>> = {
  FS_STALE_VERSION: 'workspace-file-write/stale-version',
  FS_NOT_OBSERVED: 'workspace-file-write/already-exists',
  FS_SANDBOX_DENIED: 'workspace-file-write/outside-workspace',
  FS_NOT_TEXT: 'workspace-file-write/not-text',
  FS_NOT_REGULAR_FILE: 'workspace-file-write/not-regular-file',
  FS_NOT_FOUND: 'workspace-file-write/not-found',
  FS_TOO_LARGE: 'workspace-file-write/too-large',
  FS_PERMISSION_DENIED: 'workspace-file-write/permission-denied',
}

/** Wire shapes (mirrored as strict zod in ./typert.host.ts). */
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
export interface GitStatusEntry {
  readonly path: string
  readonly oldPath?: string
  readonly statusCode: string
  readonly kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'ignored' | 'conflicted' | 'unmodified'
}
export interface GitStatusResult {
  readonly notARepo: boolean
  readonly branch: string | undefined
  readonly upstream: string | undefined
  readonly ahead: number
  readonly behind: number
  readonly detached: boolean
  readonly entries: readonly GitStatusEntry[]
  readonly clean: boolean
}
export interface GitBranch {
  readonly name: string
  readonly current: boolean
  readonly upstream?: string
  readonly ahead?: number
  readonly behind?: number
  readonly lastCommit?: string
  readonly lastCommitDate?: string
}
export interface GitBranchesResult {
  readonly notARepo: boolean
  readonly branches: readonly GitBranch[]
  /** Remote-tracking branches (origin/main, …), when requested. */
  readonly remoteBranches?: readonly GitRemoteBranch[]
  /** Configured remote names (git remote), when requested. */
  readonly remotes?: readonly string[]
  readonly current: string | undefined
}
export interface GitDiffResult {
  readonly empty: boolean
  readonly diff: string
  readonly oldContent: string
  readonly newContent: string
  readonly oldPath: string
  readonly newPath: string
  readonly language: string
  readonly contentType?: 'text' | 'image' | 'binary'
  readonly imageBase64?: string
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
  /** HEAD commit hash ('' / undefined when the repo has no commits). */
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
  /** Full commit message body (subject + body, trimmed). */
  readonly message: string
  readonly parents: readonly string[]
  readonly refs: readonly GitLogRef[]
  readonly files: readonly GitCommitFile[]
}

/** One remote-tracking branch (refs/remotes, without the remote's HEAD). */
export interface GitRemoteBranch {
  /** Short name including the remote, e.g. 'origin/main'. */
  readonly name: string
  readonly lastCommit?: string
  readonly lastCommitDate?: string
}

/** One live interactive terminal plus its replay log and live subscribers. */
interface TerminalEntry {
  readonly id: string
  readonly handle: {
    readonly pid: number
    readonly output: NodeJS.ReadableStream
    readonly done: Promise<unknown>
    write(data: string): Promise<void>
    resize(cols: number, rows: number): Promise<void>
    signalForeground(signal: string): Promise<number>
    terminate(): Promise<void>
  }
  /** Replay log: base64 output chunks in order, capped in bytes. */
  readonly log: string[]
  logBytes: number
  exited: boolean
  /** Live per-subscriber queues; the pump pushes into every queue. */
  readonly subscribers: Set<(frame: IdeTerminalOutputFrame) => void>
}

/** Cap the replay log at ~512 KiB per terminal, dropping the oldest chunks. */
const MAX_LOG_BYTES = 512 * 1024
/** Cap the returned matches per search. */
const MAX_RESULTS = 250

export class IdeTools extends TypertRemoteService {
  static inject = ['subprocess', 'sessions', 'typert', 'llm', 'agentDefaultModel', 'fs']

  static Config = z.object({})

  private readonly terminals = new Map<string, TerminalEntry>()
  private counter = 0

  constructor(ctx: Context, _config: Record<string, never>) {
    super(ctx, 'ideTools')
    // Equivalent of @Remote on every method: the protocol marker the
    // gateway's source-mode discovery reads. The strict typert.host.js
    // manifest is the primary descriptor; this marker is the fallback.
    Object.defineProperty(Object.getPrototypeOf(this), REMOTE_METHODS_KEY, {
      configurable: true,
      value: Object.freeze({
        version: 1,
        methods: Object.freeze([
          Object.freeze({ method: 'search', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'terminalOpen', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'terminalWrite', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'terminalSignal', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'terminalTerminate', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'terminalResize', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'terminalOutput', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitStatus', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitBranches', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitDiff', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitStage', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitDiscard', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitCommit', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitStageAll', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitSync', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'fileRename', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'fileDelete', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'fileCreate', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'fileMove', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'fileCopy', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'writeFile', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'fileReveal', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'hostPlatform', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitGenerateCommitMessage', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitLog', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitCommitDetails', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitCommitFileDiff', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitCheckout', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitCreateBranch', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitDeleteBranch', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitFetch', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitUnstage', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitUnstageAll', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitDiscardAll', invocation: Object.freeze({ kind: 'direct' }) }),
        ]),
      }),
    })

    // Terminate every still-live terminal when the plugin unloads.
    ctx.effect(() => () => {
      void this.disposeAll()
    }, 'ideTools: terminal teardown')
  }

  /** Workspace grep reusing dsh-tool-fs-search's ripgrep machinery verbatim. */
  async search(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    query: { pattern: string; include?: string; path?: string; caseSensitive: boolean },
    signal: AbortSignal,
  ): Promise<IdeSearchResult> {
    const { workspaceRoot } = workspaceFileScope
    if (query.pattern.length === 0) throw new RemoteError('ide-tools/bad-request', 'pattern is empty', {})
    const input: { pattern: string; include?: string; path?: string } = { pattern: query.pattern }
    if (query.include !== undefined && query.include.length > 0) input.include = query.include
    if (query.path !== undefined && query.path.length > 0) input.path = query.path
    let argv = buildGrepCommand(input)
    if (!query.caseSensitive) argv = ['-i', ...argv]
    // runRipgrep reads only exec.signal and exec.agent.session.header.cwd at runtime
    // (see @deepseek-ai/dsh-tool-fs-search search-core). Its TS type widened to a full
    // ToolExecution in 0.2.0 — whose registry-owned token this host service cannot mint
    // — so the structurally-compatible exec is cast through never, exactly as this.ctx is.
    const exec = { signal, agent: { session: { header: { cwd: workspaceRoot } } } }
    const run = await runRipgrep(this.ctx as never, exec as never, 'grep', argv, RAW_OUTPUT_MAX_BYTES, SEARCH_GRACE_MS, SEARCH_STDERR_MAX_BYTES)
    const parsed = run.noMatches ? [] : parseGrepMatches(run.stdout)
    const total = parsed.length
    const kept = parsed.slice(0, MAX_RESULTS)
    return {
      matches: kept.map((m) => ({ path: m.path, lineNumber: m.lineNumber, line: previewLine(m.line, GREP_MAX_LINE_BYTES) })),
      truncated: total > kept.length,
      totalMatches: total,
    }
  }

  /** Spawn one interactive login shell in the workspace root. */
  async terminalOpen(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    spec: { cols: number; rows: number; command?: string; cwd?: string },
    signal: AbortSignal,
  ): Promise<IdeTerminalOpenResult> {
    const { workspaceRoot } = workspaceFileScope
    // "Open in Integrated Terminal" spawns the shell already inside the chosen
    // directory. The path stays inside the workspace (empty string = the root).
    let spawnCwd = workspaceRoot
    if (spec.cwd !== undefined && spec.cwd.length > 0) {
      try {
        spawnCwd = resolveWorkspacePath(workspaceRoot, spec.cwd)
      } catch {
        throw new RemoteError('ide-tools/bad-path', 'the terminal cwd escapes the workspace', { path: spec.cwd })
      }
    }
    const shell = spec.command !== undefined && spec.command.length > 0 ? spec.command : (process.env.SHELL ?? '/bin/zsh')
    // `-l` (login: sources .zprofile/.zlogin) + `-i` (interactive: sources .zshrc) so the
    // IDE terminal inherits the user's real zsh environment — prompt theme (p10k/starship/
    // oh-my-zsh), aliases, PATH, nvm, etc. — exactly like VS Code's integrated terminal.
    const argv = [shell, '-l', '-i']
    const cols = Math.max(2, Math.min(500, Math.round(spec.cols)))
    const rows = Math.max(2, Math.min(300, Math.round(spec.rows)))
    const handle = await this.ctx.subprocess.spawnTerminal({
      argv,
      cwd: spawnCwd,
      // terminalType is what the subprocess seam forwards to node-pty as the PTY
      // `name` AND writes into the child env as TERM. Omitting it left TERM unset,
      // which made zsh drop into dumb-terminal mode (no colors, broken prompt).
      terminalType: 'xterm-256color',
      // Inherit the parent environment so zsh picks up PATH, HOME, LANG,
      // ZDOTDIR, and any ZSH_* / LS_COLORS / PROMPT settings the user has
      // configured. Then force COLORTERM so xterm.js renders the full ANSI
      // palette the shell emits (TERM is set via terminalType above).
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        CLICOLOR: '1',
        CLICOLOR_FORCE: '1',
      },
      rows,
      cols,
      graceMs: 5000,
      signal,
    })
    const id = 't' + ++this.counter + '-' + Date.now().toString(36)
    const entry: TerminalEntry = {
      id,
      handle: handle as unknown as TerminalEntry['handle'],
      log: [],
      logBytes: 0,
      exited: false,
      subscribers: new Set(),
    }
    this.terminals.set(id, entry)
    this.pump(entry)
    return { terminalId: id, pid: handle.pid }
  }

  /** Pump the PTY output Readable into the replay log and live subscribers. */
  private pump(entry: TerminalEntry): void {
    const emit = (data: string, exit: boolean, exitCode?: number | null): void => {
      entry.log.push(data)
      entry.logBytes += data.length * 0.75
      while (entry.logBytes > MAX_LOG_BYTES && entry.log.length > 1) {
        entry.logBytes -= entry.log[0].length * 0.75
        entry.log.shift()
      }
      for (const subscriber of entry.subscribers) subscriber({ data, exit, ...(exit ? { exitCode } : {}) })
    }
    entry.handle.output.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      emit(text.toString('base64'), false)
    })
    let finished = false
    const finish = (exitCode?: number | null): void => {
      if (finished) return
      finished = true
      entry.exited = true
      for (const subscriber of entry.subscribers) subscriber({ data: '', exit: true, exitCode })
      entry.subscribers.clear()
    }
    // The seam resolves `done` with the exit outcome { exitCode, ... } when the
    // shell terminates — prefer that (it carries the code) over the bare
    // output-stream end/error events, which only say the PTY went away.
    void entry.handle.done
      .then((outcome: unknown) => { finish((outcome as { exitCode?: number | null } | undefined)?.exitCode ?? null) })
      .catch(() => finish(null))
    entry.handle.output.on('end', () => finish(null))
    entry.handle.output.on('error', () => finish(null))
  }

  /** Deliver one input chunk to the terminal. */
  async terminalWrite(
    _workspaceFileScope: { sessionId: string; workspaceRoot: string },
    terminalId: string,
    data: string,
    _signal: AbortSignal,
  ): Promise<void> {
    const entry = this.terminals.get(terminalId)
    if (entry === undefined) throw new RemoteError('ide-tools/no-such-terminal', 'terminal ' + JSON.stringify(terminalId) + ' is not open', {})
    if (entry.exited) throw new RemoteError('ide-tools/terminal-exited', 'terminal ' + JSON.stringify(terminalId) + ' has exited', {})
    const text = Buffer.from(data, 'base64').toString('utf8')
    await entry.handle.write(text)
  }

  /** Signal the terminal's foreground process group (e.g. Ctrl+C as SIGINT). */
  async terminalSignal(
    _workspaceFileScope: { sessionId: string; workspaceRoot: string },
    terminalId: string,
    signalName: 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP',
    _signal: AbortSignal,
  ): Promise<void> {
    const entry = this.terminals.get(terminalId)
    if (entry === undefined) throw new RemoteError('ide-tools/no-such-terminal', 'terminal ' + JSON.stringify(terminalId) + ' is not open', {})
    await entry.handle.signalForeground(signalName)
  }

  /** Terminate the whole terminal session and drop it from the registry. */
  async terminalTerminate(
    _workspaceFileScope: { sessionId: string; workspaceRoot: string },
    terminalId: string,
    _signal: AbortSignal,
  ): Promise<void> {
    const entry = this.terminals.get(terminalId)
    if (entry === undefined) return
    this.terminals.delete(terminalId)
    for (const subscriber of entry.subscribers) subscriber({ data: '', exit: true })
    entry.subscribers.clear()
    // Do NOT await the kill. A shell that ignores the signal (or a pty that
    // stays alive until its children exit) leaves terminate() pending, and the
    // caller's RPC would then never resolve — the tab only went away on a
    // second click. The registry entry is already dropped, so the kill is
    // allowed to finish in the background.
    void entry.handle.terminate().catch(() => undefined)
  }

  /** Resize one terminal's PTY so the shell's COLUMNS/LINES and cursor
   *  positioning match the xterm.js viewport after a fit. Without this the
   *  shell keeps rendering at the PTY's creation size (80×24) while xterm
   *  shows a different viewport, so prompt wrapping, line editing, and
   *  full-screen apps (vim, less) all misbehave. */
  async terminalResize(
    _workspaceFileScope: { sessionId: string; workspaceRoot: string },
    terminalId: string,
    cols: number,
    rows: number,
    _signal: AbortSignal,
  ): Promise<void> {
    const entry = this.terminals.get(terminalId)
    if (entry === undefined) throw new RemoteError('ide-tools/no-such-terminal', 'terminal ' + JSON.stringify(terminalId) + ' is not open', {})
    const c = Math.max(2, Math.min(500, Math.round(cols)))
    const r = Math.max(2, Math.min(300, Math.round(rows)))
    await entry.handle.resize(c, r)
  }

  /** Stream one terminal's output: replay log first, then live frames. */
  async *terminalOutput(
    _workspaceFileScope: { sessionId: string; workspaceRoot: string },
    terminalId: string,
    signal: AbortSignal,
  ): AsyncGenerator<IdeTerminalOutputFrame, void, void> {
    const entry = this.terminals.get(terminalId)
    if (entry === undefined) throw new RemoteError('ide-tools/no-such-terminal', 'terminal ' + JSON.stringify(terminalId) + ' is not open', {})
    // Replay everything the terminal emitted before this subscription.
    // Yield each log entry as a SEPARATE frame: joining base64 strings
    // concatenates padding chars (=) mid-string, yielding invalid base64.
    for (const entry2 of entry.log) yield { data: entry2, exit: false }
    if (entry.exited) { yield { data: '', exit: true }; return }
    // Live phase: a queue fed by the pump, drained until exit or abort.
    const queue: IdeTerminalOutputFrame[] = []
    let resolve: (() => void) | undefined
    const subscriber = (frame: IdeTerminalOutputFrame): void => {
      queue.push(frame)
      resolve?.()
    }
    entry.subscribers.add(subscriber)
    const onAbort = (): void => { resolve?.() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      for (;;) {
        while (queue.length > 0) {
          const frame = queue.shift()
          if (frame === undefined) break
          yield frame
          if (frame.exit) return
        }
        if (signal.aborted) return
        await new Promise<void>((r) => { resolve = r })
        resolve = undefined
      }
    } finally {
      entry.subscribers.delete(subscriber)
      signal.removeEventListener('abort', onAbort)
    }
  }

  // ── Git source control ───────────────────────────────────────────────
  // All git commands run as a foreground collect-mode spawn through the
  // subprocess seam (same primitive ripgrep uses), with a bounded stdout cap.
  // The seam owns process-tree termination on abort; we only parse the text.

  /** Cap git stdout at 8 MiB (covers large diffs; oversized output truncates
   *  to the tail with a spill file the client never reads here). */
  private static readonly GIT_STDOUT_MAX_BYTES = 8 * 1024 * 1024
  private static readonly GIT_STDERR_MAX_BYTES = 16 * 1024

  /** Run one git command in the workspace root, returning its stdout text.
   *  Throws a RemoteError (notARepo / failed) so the client can map the kind. */
  private async runGit(
    workspaceRoot: string,
    argv: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const spec = {
      argv: ['git', ...argv],
      cwd: workspaceRoot,
      stdio: {
        stdin: 'ignore' as const,
        stdout: { maxBytes: IdeTools.GIT_STDOUT_MAX_BYTES },
        stderr: { maxBytes: IdeTools.GIT_STDERR_MAX_BYTES },
      },
      graceMs: 5000,
      signal,
    }
    let handle: import('@deepseek-ai/dsh-subprocess').SubprocessHandle
    try {
      handle = this.ctx.subprocess.spawn(spec as never)
    } catch {
      throw new RemoteError('ide-tools/git-failed', 'git command could not start', {})
    }
    let outcome: import('@deepseek-ai/dsh-subprocess').SubprocessOutcome
    try {
      outcome = await handle.done
    } catch {
      throw new RemoteError('ide-tools/git-failed', 'git process failed before reporting an outcome', {})
    }
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (stdout === undefined) throw new RemoteError('ide-tools/git-failed', 'git produced no collected stdout', {})
    // Exit 128 with a "not a git repository" message → notARepo, not a failure.
    const stderrText = stderr?.text ?? ''
    if (outcome.exitCode === 128 && /not a git repository/i.test(stderrText)) {
      throw new RemoteError('ide-tools/not-a-repo', 'the workspace root is not a git repository', {})
    }
    if (outcome.signal !== null || outcome.exitCode === null) {
      throw new RemoteError('ide-tools/git-failed', 'git was killed by signal ' + (outcome.signal ?? '(unknown)'), {})
    }
    if (outcome.exitCode !== 0) {
      // Some git failures ("nothing to commit", "no changes added to commit")
      // print to STDOUT with an empty stderr — surface the stdout tail then, so
      // the real cause stays diagnosable and the commit flow's nothing-to-
      // commit detection can match on it.
      const detail = stderrText.trim().length > 0 ? stderrText.trim() : stdout.text.trim().slice(-2000)
      throw new RemoteError('ide-tools/git-failed', 'git exited with code ' + outcome.exitCode + ': ' + detail, {})
    }
    return stdout.text
  }

  /** Parse `git status --porcelain=v2 --branch --untracked-files=all -z`
   *  output into a GitStatusResult.
   *
   *  With `-z` every record — branch headers included — is NUL-terminated, and
   *  the change records use spaces (not a tab) between their header fields and
   *  the path. The path is therefore the tail after the fixed header field
   *  count, joined back together because a path may itself contain spaces.
   *  A renamed/copied entry (`2 ...`) is followed by one extra NUL record
   *  holding the original path. */
  private parseGitStatusPorcelain(raw: string): Omit<GitStatusResult, 'notARepo'> {
    let branch: string | undefined
    let upstream: string | undefined
    let ahead = 0
    let behind = 0
    let detached = false
    const entries: GitStatusEntry[] = []
    const records = raw.split('\u0000')
    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      if (record.length === 0) continue
      // Branch header records: "# branch.head main", "# branch.upstream
      // origin/main", "# branch.ab +0 -0", "# branch.oid <sha>"
      // (detached: branch.head = "(detached)").
      if (record.startsWith('#')) {
        if (record.startsWith('# branch.head ')) {
          const v = record.slice('# branch.head '.length)
          if (v === '(detached)') detached = true
          else branch = v
        } else if (record.startsWith('# branch.upstream ')) {
          upstream = record.slice('# branch.upstream '.length)
        } else if (record.startsWith('# branch.ab ')) {
          const m = record.slice('# branch.ab '.length).match(/\+(\d+)\s+-(\d+)/)
          if (m) { ahead = parseInt(m[1], 10); behind = parseInt(m[2], 10) }
        }
        continue
      }
      // Change records: "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>",
      // "2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>", or
      // "u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>";
      // "? <path>" (untracked) and "! <path>" (ignored).
      const first = record[0]
      if (first === '?') {
        const path = record.slice(2)
        if (path.length > 0) entries.push({ path, statusCode: '??', kind: 'untracked' })
        continue
      }
      if (first === '!') continue // ignored — not surfaced
      if (first !== '1' && first !== '2' && first !== 'u') continue
      const fields = record.split(' ')
      const xy = fields[1] ?? '  '
      // 1: "1" + XY/sub/mH/mI/mW/hH/hI (8 tokens) before the path.
      // 2: the same 8 plus <X><score> (9 tokens).
      // u: "u" + XY/sub/m1/m2/m3/mW/h1/h2/h3 (10 tokens).
      const headerFieldCount = first === '1' ? 8 : first === '2' ? 9 : 10
      const path = fields.slice(headerFieldCount).join(' ')
      if (first === '2') {
        // The original path trails the entry as its own NUL-terminated record.
        const oldPath = records[i + 1] ?? ''
        i++
        entries.push({ path, oldPath, statusCode: xy, kind: this.xyToKind(xy) })
      } else {
        entries.push({ path, statusCode: xy, kind: first === 'u' ? 'conflicted' : this.xyToKind(xy) })
      }
    }
    return {
      branch,
      upstream,
      ahead,
      behind,
      detached,
      entries,
      clean: entries.length === 0,
    }
  }

  /** Map a porcelain v2 XY status code to a human kind. */
  private xyToKind(xy: string): GitStatusEntry['kind'] {
    const x = xy[0] ?? ' '
    const y = xy[1] ?? ' '
    if (x === 'A' || y === 'A') return 'added'
    if (x === 'D' || y === 'D') return 'deleted'
    // 'C' (copied) shares the renamed treatment.
    if (x === 'R' || y === 'R' || x === 'C' || y === 'C') return 'renamed'
    if (x === 'M' || y === 'M' || x === 'T' || y === 'T') return 'modified'
    if (x === 'U' || y === 'U') return 'conflicted'
    return 'modified'
  }

  /** Snapshot the workspace's git status (branch, ahead/behind, changed files). */
  async gitStatus(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<GitStatusResult> {
    const { workspaceRoot: cwd } = workspaceFileScope
    const EMPTY: GitStatusResult = {
      notARepo: true, branch: undefined, upstream: undefined, ahead: 0, behind: 0,
      detached: false, entries: [], clean: true,
    }
    try {
      if (!cwd) return { ...EMPTY, notARepo: false }
      const raw = await this.runGit(cwd, ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'], signal)
      // The parser owns the NUL-record framing for both branch headers and
      // change entries (including a rename's trailing original-path record).
      const parsed = this.parseGitStatusPorcelain(raw)
      return { notARepo: false, ...parsed }
    } catch (err) {
      if (err instanceof RemoteError && err.code === 'ide-tools/not-a-repo') return EMPTY
      throw err
    }
  }

  /** List local branches with ahead/behind and last-commit metadata. */
  async gitBranches(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<GitBranchesResult> {
    const { workspaceRoot: cwd } = workspaceFileScope
    const EMPTY: GitBranchesResult = { notARepo: true, branches: [], current: undefined }
    try {
      // %00 delim: refname, upstream, ahead, behind, objectname, committerdate, HEAD
      // %(upstream:track,nobracket) → "ahead N, behind M" (no brackets) or empty;
      // plain 'track' + 'normalspace' is not a valid atom on any git release.
      const fmt = '%(refname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(objectname:short)%00%(committerdate:short)%00%(HEAD)%00'
      if (!cwd) return EMPTY
      const raw = await this.runGit(cwd, ['for-each-ref', '--format=' + fmt, 'refs/heads'], signal)
      const branches: GitBranch[] = []
      let current: string | undefined
      if (raw.length > 0) {
        for (const line of raw.split('\n')) {
          if (line.length === 0) continue
          const [name, up, track, sha, date, head] = line.split('\u0000')
          let ahead: number | undefined
          let behind: number | undefined
          if (track && track.length > 0) {
            const am = track.match(/ahead (\d+)/)
            const bm = track.match(/behind (\d+)/)
            if (am) ahead = parseInt(am[1], 10)
            if (bm) behind = parseInt(bm[1], 10)
          }
          const isCurrent = head === '*'
          if (isCurrent) current = name
          branches.push({
            name, current: isCurrent,
            upstream: up && up.length > 0 ? up : undefined,
            ahead, behind,
            lastCommit: sha,
            lastCommitDate: date,
          })
        }
      }
      // Remote-tracking branches (refs/remotes, minus each remote's HEAD
      // symref) plus the configured remote names — the branches view lists
      // both. Best effort: a repo without remotes still lists local branches.
      let remoteBranches: GitRemoteBranch[] | undefined
      let remotes: string[] | undefined
      try {
        // %(refname:short) collapses refs/remotes/<remote>/HEAD to just "<remote>",
        // so the HEAD symref is filtered on the FULL refname, not the short form.
        const remoteFmt = '%(refname)%00%(refname:short)%00%(objectname:short)%00%(committerdate:short)%00'
        const remoteRaw = await this.runGit(cwd, ['for-each-ref', '--format=' + remoteFmt, 'refs/remotes'], signal)
        remotes = (await this.runGit(cwd, ['remote'], signal)).split('\n').map((r) => r.trim()).filter((r) => r.length > 0)
        remoteBranches = []
        for (const line of remoteRaw.split('\n')) {
          if (line.length === 0) continue
          const [full, name, sha, date] = line.split('\u0000')
          if (full.endsWith('/HEAD')) continue
          remoteBranches.push({ name, lastCommit: sha, lastCommitDate: date })
        }
      } catch { /* no remotes configured */ }
      return { notARepo: false, branches, remoteBranches, remotes, current }
    } catch (err) {
      if (err instanceof RemoteError && err.code === 'ide-tools/not-a-repo') return EMPTY
      throw err
    }
  }

  // ── Git graph (VS Code Source Control Graph parity) ──────────────────
  // The history provider feeds the swimlane graph: git log pages with
  // decorations parsed into typed refs, plus the per-commit actions the
  // graph's context menu exposes (checkout / create branch / fetch ...).

  /** Refuse ref-ish arguments that git could parse as its own options. */
  private static assertGitRevision(rev: string, label: string): void {
    if (rev.length === 0 || rev.startsWith('-')) {
      throw new RemoteError('ide-tools/bad-request', 'invalid ' + label, {})
    }
  }

  /** Strip a --decorate=full full-ref prefix down to the short name. */
  private gitRefShortName(fullname: string): string {
    for (const prefix of ['refs/heads/', 'refs/remotes/', 'refs/tags/']) {
      if (fullname.startsWith(prefix)) return fullname.slice(prefix.length)
    }
    return fullname
  }

  /** Parse git log --decorate=full %D into typed graph refs. */
  private parseGitLogDecorations(decorations: string): GitLogRef[] {
    const refs: GitLogRef[] = []
    if (decorations.length === 0) return refs
    for (const part of decorations.split(', ')) {
      if (part.startsWith('HEAD -> ')) {
        // The checked-out branch: e.g. "HEAD -> refs/heads/main".
        const name = this.gitRefShortName(part.slice('HEAD -> '.length))
        if (name.length > 0) refs.push({ name, type: 'head', current: true })
        continue
      }
      if (part === 'HEAD') continue
      if (part.startsWith('tag: ')) {
        const name = this.gitRefShortName(part.slice('tag: '.length))
        if (name.length > 0) refs.push({ name, type: 'tag', current: false })
        continue
      }
      if (part.startsWith('refs/heads/')) {
        refs.push({ name: part.slice('refs/heads/'.length), type: 'head', current: false })
      } else if (part.startsWith('refs/remotes/')) {
        const name = part.slice('refs/remotes/'.length)
        if (name.endsWith('/HEAD')) continue // remote HEAD symref, not a branch
        refs.push({ name, type: 'remote', current: false })
      }
      // Other namespaces (refs/stash ...) are not surfaced in the graph.
    }
    return refs
  }

  /** One page of the commit history for the SCM graph (VS Code's history
   *  provider): git log --topo-order --decorate=full -z with NUL-separated
   *  records, so multi-line data can never split a page. scope: 'current' =
   *  HEAD history, 'all' = every ref, 'branch' = one named ref. */
  async gitLog(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    options: { limit?: number; skip?: number; scope?: 'current' | 'all' | 'branch'; ref?: string },
    signal: AbortSignal | undefined,
  ): Promise<GitLogResult> {
    const { workspaceRoot: cwd } = workspaceFileScope
    const EMPTY: GitLogResult = {
      notARepo: true, commits: [], hasMore: false,
      head: undefined, currentBranch: undefined, upstream: undefined, detached: false,
    }
    try {
      if (!cwd) return EMPTY
      const limit = Math.max(1, Math.min(500, Math.round(options?.limit ?? 100)))
      const skip = Math.max(0, Math.round(options?.skip ?? 0))
      const scope = options?.scope ?? 'current'
      // Unborn repository (no commits yet): rev-parse --quiet --verify HEAD
      // exits 1 with no output — treat that as "no history", not an error
      // (runGit throws on any non-zero exit; the .catch maps it to empty).
      const head = await this.runGit(cwd, ['rev-parse', '--quiet', '--verify', 'HEAD'], signal)
        .then((s) => s.trim())
        .catch(() => '')
      if (head.length === 0) return { ...EMPTY, notARepo: false }
      const argv = [
        '-c', 'i18n.logOutputEncoding=UTF-8',
        'log', '--format=%H%x1f%h%x1f%aN%x1f%aE%x1f%at%x1f%P%x1f%D%x1f%s',
        '-z', '--topo-order', '--decorate=full',
        '-n', String(limit + 1), '--skip', String(skip),
      ]
      if (scope === 'all') argv.push('--all')
      if (scope === 'branch') {
        const ref = options?.ref ?? ''
        IdeTools.assertGitRevision(ref, 'branch name')
        argv.push(ref)
      }
      const raw = await this.runGit(cwd, argv, signal)
      const commits: GitLogEntry[] = []
      let hasMore = false
      for (const record of raw.split('\u0000')) {
        if (record.length === 0) continue
        if (commits.length === limit) { hasMore = true; break }
        const [hash, displayId, author, authorEmail, authorDate, parents, decorations, subject] = record.split('\u001f')
        commits.push({
          hash, displayId,
          parents: parents.length > 0 ? parents.split(' ') : [],
          author, authorEmail,
          authorDate: Number(authorDate) || 0,
          subject: subject ?? '',
          refs: this.parseGitLogDecorations(decorations ?? ''),
        })
      }
      const [currentBranch, upstream] = await Promise.all([
        this.runGit(cwd, ['branch', '--show-current'], signal).then((s) => s.trim()).catch(() => ''),
        this.runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], signal).then((s) => s.trim()).catch(() => ''),
      ])
      return {
        notARepo: false,
        commits, hasMore, head,
        currentBranch: currentBranch.length > 0 ? currentBranch : undefined,
        upstream: upstream.length > 0 ? upstream : undefined,
        detached: currentBranch.length === 0,
      }
    } catch (err) {
      if (err instanceof RemoteError && err.code === 'ide-tools/not-a-repo') return EMPTY
      throw err
    }
  }

  /** One commit's metadata + changed files (VS Code's commit details view).
   *  Merge commits diff against their FIRST parent; root commits diff
   *  against the empty tree (git diff-tree --root). */
  async gitCommitDetails(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    sha: string,
    signal: AbortSignal | undefined,
  ): Promise<GitCommitDetailsResult> {
    const { workspaceRoot: cwd } = workspaceFileScope
    IdeTools.assertGitRevision(sha, 'commit hash')
    if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) throw new RemoteError('ide-tools/bad-request', 'invalid commit hash', {})
    const meta = (
      await this.runGit(cwd, ['show', '-s', '--format=%H%x1f%h%x1f%aN%x1f%aE%x1f%at%x1f%P%x1f%D', sha], signal)
    ).trimEnd()
    const [hash, displayId, author, authorEmail, authorDate, parentsRaw, decorations] = meta.split('\u001f')
    const parents = parentsRaw.length > 0 ? parentsRaw.split(' ') : []
    const message = (await this.runGit(cwd, ['show', '-s', '--format=%B', sha], signal)).trimEnd()
    const files = await this.commitChangedFiles(cwd, sha, parents[0], signal)
    return {
      hash, displayId, author, authorEmail,
      authorDate: Number(authorDate) || 0,
      subject: message.split('\n', 1)[0] ?? '',
      message,
      parents,
      refs: this.parseGitLogDecorations(decorations ?? ''),
      files,
    }
  }

  /** Changed files of one commit: name-status (kinds + renames, -z) joined
   *  with numstat (line counts) keyed by the new path. */
  private async commitChangedFiles(
    cwd: string,
    sha: string,
    firstParent: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<GitCommitFile[]> {
    const nameArgs = firstParent !== undefined
      ? ['diff-tree', '-M', '--no-commit-id', '--name-status', '-r', '-z', firstParent, sha]
      : ['diff-tree', '-M', '--no-commit-id', '--name-status', '-r', '-z', '--root', sha]
    const raw = await this.runGit(cwd, nameArgs, signal)
    const counts = new Map<string, { additions?: number; deletions?: number; binary: boolean }>()
    try {
      const numArgs = firstParent !== undefined
        ? ['diff-tree', '-M', '--no-commit-id', '--numstat', '-r', firstParent, sha]
        : ['diff-tree', '-M', '--no-commit-id', '--numstat', '-r', '--root', sha]
      const numRaw = await this.runGit(cwd, numArgs, signal)
      for (const line of numRaw.split('\n')) {
        if (line.length === 0) continue
        const tab = line.indexOf('\t')
        const tab2 = line.indexOf('\t', tab + 1)
        if (tab < 0 || tab2 < 0) continue
        const adds = line.slice(0, tab)
        const dels = line.slice(tab + 1, tab2)
        const path = this.numstatNewPath(line.slice(tab2 + 1))
        if (path === undefined) continue
        counts.set(path, adds === '-' || dels === '-'
          ? { binary: true }
          : { additions: Number(adds) || 0, deletions: Number(dels) || 0, binary: false })
      }
    } catch { /* counts are optional decoration */ }

    // -z name-status records: <status> NUL <path> [NUL <origPath>] NUL ...
    // (the rename pair is printed src first, then dst — verified against
    // git 2.x diff-tree -z --name-status).
    const files: GitCommitFile[] = []
    const fields = raw.split('\u0000')
    for (let i = 0; i < fields.length; i++) {
      const status = fields[i]
      if (status.length === 0) continue
      const letter = status[0]
      const count = (newPath: string) => {
        const c = counts.get(newPath)
        return {
          additions: c?.binary === true ? undefined : c?.additions,
          deletions: c?.binary === true ? undefined : c?.deletions,
        }
      }
      if (letter === 'R' || letter === 'C') {
        const oldPath = fields[++i] ?? ''
        const path = fields[++i] ?? ''
        if (path.length === 0) continue
        files.push({ path, oldPath: oldPath.length > 0 ? oldPath : undefined, kind: 'renamed', ...count(path) })
        continue
      }
      const path = fields[++i] ?? ''
      if (path.length === 0) continue
      // Binary first: a binary add/delete must badge as binary, not added.
      const kind: GitCommitFile['kind'] = counts.get(path)?.binary === true ? 'binary'
        : letter === 'A' ? 'added'
        : letter === 'D' ? 'deleted'
        : 'modified'
      files.push({ path, kind, ...count(path) })
    }
    return files
  }

  /** The new-path side of a numstat rename field ('old => new', or git's
   *  braces form '{pre/old => post}/suffix'). */
  private numstatNewPath(field: string): string | undefined {
    if (!field.includes(' => ')) return field
    const brace = field.match(/^(.*)\{(.*) => (.*)\}(.*)$/)
    if (brace) return brace[1] + brace[3] + brace[4]
    const arrow = field.split(' => ')
    return arrow[arrow.length - 1]
  }

  /** Old/new content + patch of ONE file inside one commit (graph commit
   *  details -> per-file diff). Same base rules as gitCommitDetails; the new
   *  side is the COMMIT's blob — never the working tree. */
  async gitCommitFileDiff(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    sha: string,
    path: string,
    oldPath: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<GitDiffResult> {
    const { workspaceRoot: cwd } = workspaceFileScope
    IdeTools.assertGitRevision(sha, 'commit hash')
    if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) throw new RemoteError('ide-tools/bad-request', 'invalid commit hash', {})
    if (path.length === 0) throw new RemoteError('ide-tools/bad-request', 'path is empty', {})
    const language = this.detectLanguage(path)
    const parentsRaw = (await this.runGit(cwd, ['show', '-s', '--format=%P', sha], signal)).trim()
    const firstParent = parentsRaw.split(' ')[0] ?? ''
    const target = oldPath !== undefined && oldPath.length > 0 && oldPath !== path ? [oldPath, path] : [path]
    const diffArgv = firstParent.length > 0
      ? ['diff', '-M', firstParent, sha, '--', ...target]
      : ['diff-tree', '-p', '-M', '--root', '--no-commit-id', sha, '--', ...target]
    let diff = ''
    try { diff = await this.runGit(cwd, diffArgv, signal) } catch { /* e.g. file untouched by a merge */ }
    // Old side: the first parent's blob (empty for root commits / adds).
    let oldContent = ''
    if (firstParent.length > 0) {
      try { oldContent = await this.runGit(cwd, ['show', firstParent + ':' + (oldPath ?? path)], signal) } catch { /* added */ }
    }
    // New side: the commit's blob (empty for deletions).
    let newContent = ''
    try { newContent = await this.runGit(cwd, ['show', sha + ':' + path], signal) } catch { /* deleted */ }
    // Binary blobs do not survive the text subprocess seam (lossy utf8 decode).
    // git numstat prints '-' for binary counts — flag the result so the
    // client renders a placeholder instead of garbled utf8-decoded bytes.
    try {
      const numArgs = firstParent.length > 0
        ? ['diff-tree', '-M', '--no-commit-id', '--numstat', '-r', firstParent, sha, '--', oldPath ?? path]
        : ['diff-tree', '-M', '--no-commit-id', '--numstat', '-r', '--root', sha, '--', oldPath ?? path]
      const numstat = (await this.runGit(cwd, numArgs, signal)).trim()
      if (/^-\t-\t/m.test(numstat)) {
        return {
          empty: false, diff: '', oldContent: '', newContent: path,
          oldPath: oldPath ?? path, newPath: path, language, contentType: 'binary',
        }
      }
    } catch { /* fall through to the text path */ }
    const isEmpty = diff.trim().length === 0 && oldContent === newContent
    return { empty: isEmpty, diff, oldContent, newContent, oldPath: oldPath ?? path, newPath: path, language }
  }

  /** Check out a branch, a remote branch (creating the local tracking branch
   *  via -b), or a detached commit (graph + branches views). */
  async gitCheckout(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    spec: { ref: string; localName?: string; detach?: boolean },
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot: cwd } = workspaceFileScope
    const ref = spec?.ref ?? ''
    IdeTools.assertGitRevision(ref, 'branch name')
    try {
      if (spec?.detach === true) {
        await this.runGit(cwd, ['checkout', '-q', '--detach', ref], signal)
      } else if (spec?.localName !== undefined && spec.localName.length > 0) {
        const local = spec.localName
        if (local.startsWith('-')) throw new RemoteError('ide-tools/bad-request', 'invalid branch name', {})
        await this.runGit(cwd, ['checkout', '-q', '-b', local, ref], signal)
      } else {
        await this.runGit(cwd, ['checkout', '-q', ref], signal)
      }
    } catch (err) {
      if (err instanceof RemoteError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-checkout-failed', message, {})
    }
  }

  /** Create a branch at HEAD (or an explicit revision), optionally checking
   *  it out (branches view + graph context menu -> Create Branch). */
  async gitCreateBranch(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    name: string,
    revision: string | undefined,
    checkout: boolean | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot: cwd } = workspaceFileScope
    if (name.length === 0 || name.startsWith('-')) {
      throw new RemoteError('ide-tools/bad-request', 'invalid branch name', {})
    }
    if (revision !== undefined && revision.length > 0) IdeTools.assertGitRevision(revision, 'revision')
    try {
      const rev = revision !== undefined && revision.length > 0 ? [revision] : []
      await this.runGit(cwd, checkout === true ? ['checkout', '-q', '-b', name, ...rev] : ['branch', name, ...rev], signal)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-branch-failed', message, {})
    }
  }

  /** Delete a LOCAL branch (-d, or -D when force). Remote branches are never
   *  touched from the UI. */
  async gitDeleteBranch(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    name: string,
    force: boolean | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot: cwd } = workspaceFileScope
    if (name.length === 0 || name.startsWith('-')) {
      throw new RemoteError('ide-tools/bad-request', 'invalid branch name', {})
    }
    try {
      await this.runGit(cwd, ['branch', force === true ? '-D' : '-d', name], signal)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-branch-failed', message, {})
    }
  }

  /** Fetch remotes with prune (graph + branches toolbar -> Fetch). Prefers
   *  'origin'; falls back to --all when origin is not configured. */
  async gitFetch(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot: cwd } = workspaceFileScope
    try {
      const remotes = (await this.runGit(cwd, ['remote'], signal)).split('\n').map((r) => r.trim()).filter((r) => r.length > 0)
      if (remotes.length === 0) {
        throw new RemoteError('ide-tools/git-fetch-failed', 'your repository has no remotes configured', {})
      }
      if (remotes.includes('origin')) {
        await this.runGit(cwd, ['fetch', '--prune', 'origin'], signal)
      } else {
        await this.runGit(cwd, ['fetch', '--all', '--prune'], signal)
      }
    } catch (err) {
      if (err instanceof RemoteError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-fetch-failed', message, {})
    }
  }

  /** Fetch a unified diff (and old/new content) for one path. */
  async gitDiff(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    kind: 'unstaged' | 'staged' | 'head',
    signal: AbortSignal | undefined,
  ): Promise<GitDiffResult> {
    const { workspaceRoot: cwd } = workspaceFileScope
    const language = this.detectLanguage(path)
    // Detect image file
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    const isImage = ['png','jpg','jpeg','gif','webp','bmp','ico','svg'].includes(ext)
    if (isImage && cwd) {
      // For image files, read the working-tree file from disk and return it as
      // base64 (covers staged clicks too — the worktree copy is normally the
      // staged blob; git blobs cannot cross the text subprocess seam).
      let inHead = true
      try { await this.runGit(cwd, ['cat-file', '-e', 'HEAD:' + path], signal) } catch { inHead = false }
      let imageBase64 = ''
      try {
        // resolveWorkspacePath refuses paths escaping the workspace root
        // (raw fs read, not a git pathspec).
        const buf = await readFile(resolveWorkspacePath(cwd, path))
        const mime = ext === 'svg' ? 'image/svg+xml' : 'image/' + ext
        imageBase64 = 'data:' + mime + ';base64,' + buf.toString('base64')
      } catch { /* deleted from the worktree / path escapes the workspace */ }
      if (imageBase64.length === 0) {
        // A missing worktree copy on a tracked image is a DELETION change —
        // an "empty diff" tile would claim nothing changed. The blob cannot
        // cross the text subprocess seam, so flag it binary and let the
        // client show the placeholder (mirrors gitCommitFileDiff).
        if (inHead) {
          return { empty: false, diff: '', oldContent: '', newContent: path, oldPath: path, newPath: path, language, contentType: 'binary' }
        }
        return { empty: true, diff: '', oldContent: '', newContent: '', oldPath: path, newPath: path, language, contentType: 'image' }
      }
      return {
        empty: false,
        diff: '',
        oldContent: '',
        newContent: '',
        oldPath: path,
        newPath: path,
        language,
        contentType: 'image',
        imageBase64,
      }
    }
    // Pick the diff scope:
    //  unstaged → git diff -- <path>            (worktree vs index)
    //  staged   → git diff --cached -- <path>   (index vs HEAD)
    //  head     → git diff HEAD -- <path>       (worktree vs HEAD, staged+unstaged)
    // Unborn repository (no commits yet): `git diff HEAD` exits 128 with
    // "fatal: bad revision 'HEAD'". Probe once (kind 'head' only) and fall
    // back to a plain diff: oldContent reads HEAD:path in a try/catch
    // (stays ''), the right side still comes from disk, so new files render.
    let hasHead = true
    if (kind === 'head' && cwd) {
      hasHead = await this.runGit(cwd, ['rev-parse', '--quiet', '--verify', 'HEAD'], signal).then(() => true, () => false)
    }
    const diffArgv: string[] = ['diff']
    if (kind === 'staged') diffArgv.push('--cached')
    else if (kind === 'head' && hasHead) diffArgv.push('HEAD')
    diffArgv.push('--', path)
    try {
      if (!cwd) return { empty: true, diff: '', oldContent: '', newContent: '', oldPath: path, newPath: path, language }
      const diff = await this.runGit(cwd, diffArgv, signal)
      // Binary blobs do not survive the text subprocess seam (lossy utf8
      // decode). git numstat prints '-' for binary counts — flag the result
      // so the client renders a placeholder instead of garbled bytes
      // (mirrors gitCommitFileDiff).
      try {
        const numstatArgv: string[] = ['diff']
        if (kind === 'staged') numstatArgv.push('--cached')
        else if (kind === 'head' && hasHead) numstatArgv.push('HEAD')
        numstatArgv.push('--numstat', '--', path)
        const numstat = (await this.runGit(cwd, numstatArgv, signal)).trim()
        if (/^-\t-\t/m.test(numstat)) {
          return { empty: false, diff: '', oldContent: '', newContent: path, oldPath: path, newPath: path, language, contentType: 'binary' }
        }
      } catch { /* fall through to the text path */ }
      if (kind === 'staged') {
        // Staged diff (VS Code's "Staged Changes" click): index vs HEAD. Both
        // sides come from git objects — the working tree is never consulted
        // (unstaged edits on top must not leak into the staged view).
        let oldContent = ''
        try {
          oldContent = await this.runGit(cwd, ['show', 'HEAD:' + path], signal)
        } catch { /* not in HEAD (a staged new file) */ }
        let newContent = ''
        try {
          newContent = await this.runGit(cwd, ['show', ':' + path], signal)
        } catch { /* not in the index (should not happen for a staged path) */ }
        const isEmpty = diff.trim().length === 0 && oldContent === newContent
        return {
          empty: isEmpty,
          diff,
          oldContent,
          newContent,
          oldPath: path,
          newPath: path,
          language,
        }
      }
      // Left side: the committed (HEAD) version for 'head' — empty for a
      // new/untracked file. For 'unstaged' the INDEX blob (:path): that diff
      // is index↔worktree, so a partially staged file must show its staged
      // content on the left, not the HEAD version.
      let oldContent = ''
      try {
        oldContent = await this.runGit(cwd, kind === 'unstaged' ? ['show', ':' + path] : ['show', 'HEAD:' + path], signal)
      } catch {
        // The blob does not exist on that side (added/untracked) — oldContent stays ''.
      }
      // Right side: the WORKING-TREE file. An unstaged edit leaves the index at
      // the HEAD blob, so reading ':path' here produced two identical sides and
      // a diff with no visible changes. Reading the file from disk shows the
      // actual uncommitted content (staged + unstaged) against HEAD.
      let newContent = ''
      try {
        // resolveWorkspacePath refuses paths escaping the workspace root —
        // git's own pathspecs are repo-bounded, but this is a raw fs read.
        const buf = await readFile(resolveWorkspacePath(cwd, path))
        newContent = buf.toString('utf8')
      } catch {
        // The file is gone from the working tree (deleted) or the path
        // escapes the workspace — newContent stays ''.
      }
      // A diff is "empty" only when there is genuinely nothing to show: no
      // diff text AND old/new content are identical (or both absent). An
      // untracked file has empty diff text but non-empty newContent — it
      // must NOT be flagged empty so the DiffEditor renders it.
      const isEmpty = diff.trim().length === 0 && oldContent === newContent
      return {
        empty: isEmpty,
        diff,
        oldContent,
        newContent,
        oldPath: path,
        newPath: path,
        language,
      }
    } catch (err) {
      if (err instanceof RemoteError && err.code === 'ide-tools/not-a-repo') {
        return { empty: true, diff: '', oldContent: '', newContent: '', oldPath: path, newPath: path, language }
      }
      throw err
    }
  }

  /** Minimal language id by extension (mirrors the client's detectLanguage
   *  for the diff result's Monaco model). */
  private detectLanguage(path: string): string {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      json: 'json', css: 'css', scss: 'scss', less: 'less',
      html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
      md: 'markdown', markdown: 'markdown',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
      c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
      sh: 'shell', bash: 'shell', zsh: 'shell',
      yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
      sql: 'sql', dockerfile: 'dockerfile', makefile: 'makefile',
    }
    return map[ext] ?? 'plaintext'
  }

  /** Stage all changes (git add -A) in the workspace root. Throws a
   *  RemoteError on failure — the wire layer maps it to the client's error
   *  branch, so host methods return PLAIN business values (the transport
   *  always wraps them into { ok, value } itself). */
  async gitStageAll(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot: cwd } = workspaceFileScope
    if (!cwd) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
    try {
      await this.runGit(cwd, ['add', '-A'], signal)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-stage-failed', message, {})
    }
  }

  /** Stage one path (git add -- path). Untracked files become staged adds. */
  async gitStage(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot: cwd } = workspaceFileScope
    if (!cwd) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
    if (path.length === 0) throw new RemoteError('ide-tools/bad-request', 'path is empty', {})
    try {
      await this.runGit(cwd, ['add', '--', path], signal)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-stage-failed', message, {})
    }
  }

  /** Unstage one path (git reset HEAD -- path, VS Code's "Unstage Changes").
   *  A newly-added (previously untracked) file becomes untracked again; a
   *  staged modification drops back to the working-tree group. */
  async gitUnstage(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot: cwd } = workspaceFileScope
    if (!cwd) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
    if (path.length === 0) throw new RemoteError('ide-tools/bad-request', 'path is empty', {})
    try {
      await this.runGit(cwd, ['reset', 'HEAD', '--', path], signal)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-unstage-failed', message, {})
    }
  }

  /** Unstage everything (git reset HEAD, VS Code's staged-group "−" action). */
  async gitUnstageAll(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot: cwd } = workspaceFileScope
    if (!cwd) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
    try {
      await this.runGit(cwd, ['reset', 'HEAD'], signal)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-unstage-failed', message, {})
    }
  }

  /** Discard ALL uncommitted changes (VS Code's changes-group "↩ Discard All
   *  Changes"): reset the index to HEAD, rewrite the working tree from it,
   *  and remove every untracked file. Destructive — the UI confirms first. */
  async gitDiscardAll(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot: cwd } = workspaceFileScope
    if (!cwd) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
    try {
      // Staged renames keep a phantom index entry after reset unless the
      // target path is also cleaned, so clean runs after reset. Staged adds
      // are deleted by reset --hard itself (the worktree is forced back to
      // HEAD); clean -d only sweeps the never-staged untracked files.
      await this.runGit(cwd, ['reset', '--hard', 'HEAD'], signal)
      await this.runGit(cwd, ['clean', '-fd'], signal)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-discard-failed', message, {})
    }
  }

  /**
   * Discard one entry's uncommitted changes: bring the index AND working tree
   * back to HEAD for that path (VS Code's "Discard Changes").
   *
   * Per-kind command sequences, all verified against git 2.x behavior:
   *  - untracked → git clean -f -- path (removes the file; exit 0 when already
   *    gone, so a stale entry never hard-fails the discard)
   *  - added (staged-new) → git rm -f -- path (drops the index entry and
   *    deletes the working file; succeeds even when the file is already gone)
   *  - renamed → reset HEAD for both paths, restore the original path, then
   *    clean the (now untracked) rename target
   *  - modified / deleted / conflicted → git reset HEAD -- path unstages (and
   *    clears unmerged state), then git checkout -- path rewrites the working
   *    tree from the index; recreates a deleted file and resolves a UU
   *    conflict to the HEAD content
   */
  async gitDiscard(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    entry: { path: string; oldPath?: string; kind: GitStatusEntry['kind'] },
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot: cwd } = workspaceFileScope
    if (!cwd) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
    const { path, oldPath, kind } = entry
    if (path.length === 0) throw new RemoteError('ide-tools/bad-request', 'path is empty', {})
    try {
      if (kind === 'untracked') {
        await this.runGit(cwd, ['clean', '-f', '-q', '--', path], signal)
      } else if (kind === 'added') {
        await this.runGit(cwd, ['rm', '-f', '-q', '--', path], signal)
      } else if (kind === 'renamed' && oldPath !== undefined && oldPath.length > 0) {
        await this.runGit(cwd, ['reset', '-q', 'HEAD', '--', oldPath, path], signal)
        await this.runGit(cwd, ['checkout', '-q', '--', oldPath], signal)
        await this.runGit(cwd, ['clean', '-f', '-q', '--', path], signal)
      } else {
        await this.runGit(cwd, ['reset', '-q', 'HEAD', '--', path], signal)
        await this.runGit(cwd, ['checkout', '-q', '--', path], signal)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-discard-failed', message, {})
    }
  }

  /**
   * Rename one workspace entry within its directory (Explorer context menu →
   * 重命名). Paths are workspace-relative; the resolved target must stay inside
   * the workspace root (absolute input, '..' traversal, and the root itself are
   * all refused). Refuses an existing target instead of overwriting.
   */
  async fileRename(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    newName: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
      if (path.length === 0 || newName.length === 0) throw new RemoteError('ide-tools/bad-request', 'path and name are required', {})
      if (newName === '.' || newName === '..' || /[/\\]/.test(newName)) {
        throw new RemoteError('ide-tools/bad-request', 'invalid name', {})
      }
      const abs = resolveWorkspacePath(workspaceRoot, path)
      const target = resolve(dirname(abs), newName)
      const root = resolve(workspaceRoot)
      if (!target.startsWith(root + sep)) {
        throw new RemoteError('ide-tools/bad-path', 'target escapes the workspace root', {})
      }
      if (existsSync(target)) {
        throw new RemoteError('ide-tools/exists', 'an entry with that name already exists', {})
      }
      await rename(abs, target)
    } catch (err) {
      if (err instanceof RemoteError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/rename-failed', message, {})
    }
  }

  /**
   * Delete one file (or a directory, recursively) from the workspace
   * (Explorer context menu → 删除). Same workspace-root confinement as
   * fileRename; an already-gone path counts as success (idempotent).
   */
  async fileDelete(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    kind: 'file' | 'directory',
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
      if (path.length === 0) throw new RemoteError('ide-tools/bad-request', 'path is required', {})
      const abs = resolveWorkspacePath(workspaceRoot, path)
      await rm(abs, { recursive: kind === 'directory', force: true })
    } catch (err) {
      if (err instanceof RemoteError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/delete-failed', message, {})
    }
  }

  /**
   * Create one new workspace entry (Explorer → New File / New Folder). The
   * path may contain new intermediate segments (VS Code's inline input accepts
   * "sub/dir/name"), so missing parents are created; an existing target is
   * refused instead of overwritten. Same workspace-root confinement as
   * fileRename/fileDelete.
   */
  async fileCreate(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    kind: 'file' | 'directory',
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
      if (path.length === 0) throw new RemoteError('ide-tools/bad-request', 'path is required', {})
      const abs = resolveWorkspacePath(workspaceRoot, path)
      if (existsSync(abs)) {
        throw new RemoteError('ide-tools/exists', 'an entry with that name already exists', {})
      }
      if (kind === 'directory') {
        await mkdir(abs, { recursive: true })
      } else {
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, '', { flag: 'wx' })
      }
    } catch (err) {
      if (err instanceof RemoteError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/create-failed', message, {})
    }
  }

  /**
   * Move (or rename across directories) one workspace entry into a target
   * directory (Explorer drag & drop). Paths are workspace-relative; the host
   * refuses a target escaping the workspace root, a move into itself or its
   * own subtree, and an existing target — mirroring VS Code's explorer
   * drag-drop guards. The optional explicit newName resolves name collisions
   * the caller already knows about (e.g. suffix "- copy"). */
  async fileMove(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    targetDir: string,
    opts: { newName?: string } | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
      if (path.length === 0 || targetDir.length === 0) throw new RemoteError('ide-tools/bad-request', 'path and target directory are required', {})
      const abs = resolveWorkspacePath(workspaceRoot, path)
      const dirAbs = targetDir === '' ? resolve(workspaceRoot) : resolveWorkspacePath(workspaceRoot, targetDir)
      const root = resolve(workspaceRoot)
      if (!dirAbs.startsWith(root + sep) && dirAbs !== root) {
        throw new RemoteError('ide-tools/bad-path', 'target directory escapes the workspace root', {})
      }
      // The destination directory must exist and be a directory.
      const dirInfo = await stat(dirAbs).catch(() => undefined)
      if (dirInfo === undefined || !dirInfo.isDirectory()) {
        throw new RemoteError('ide-tools/bad-path', 'the target is not a directory', {})
      }
      // Refuse a move into itself or into its own subtree.
      if (abs === dirAbs || dirAbs.startsWith(abs + sep)) {
        throw new RemoteError('ide-tools/bad-path', 'cannot move an entry into itself or its own subtree', {})
      }
      const finalName = opts?.newName && opts.newName.length > 0 ? opts.newName : basename(abs)
      const target = resolve(dirAbs, finalName)
      if (!target.startsWith(root + sep)) {
        throw new RemoteError('ide-tools/bad-path', 'target escapes the workspace root', {})
      }
      if (existsSync(target)) {
        throw new RemoteError('ide-tools/exists', 'an entry with that name already exists in the target directory', {})
      }
      await rename(abs, target)
    } catch (err) {
      if (err instanceof RemoteError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/move-failed', message, {})
    }
  }

  /**
   * Copy one file (not directories — VS Code's explorer paste copies files;
   * recursive directory copies stay a host-side bulk upload concern) into a
   * target directory. An existing target is refused unless the caller passes
   * an explicit newName (the UI derives "- copy" style suffixes). */
  async fileCopy(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    targetDir: string,
    opts: { newName?: string } | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
      if (path.length === 0 || targetDir.length === 0) throw new RemoteError('ide-tools/bad-request', 'path and target directory are required', {})
      const abs = resolveWorkspacePath(workspaceRoot, path)
      const info = await stat(abs).catch(() => undefined)
      if (info === undefined) throw new RemoteError('ide-tools/not-found', 'the source entry no longer exists', {})
      if (info.isDirectory()) {
        throw new RemoteError('ide-tools/bad-request', 'copying directories is not supported; move it instead', {})
      }
      const dirAbs = targetDir === '' ? resolve(workspaceRoot) : resolveWorkspacePath(workspaceRoot, targetDir)
      const root = resolve(workspaceRoot)
      if (!dirAbs.startsWith(root + sep) && dirAbs !== root) {
        throw new RemoteError('ide-tools/bad-path', 'target directory escapes the workspace root', {})
      }
      const finalName = opts?.newName && opts.newName.length > 0 ? opts.newName : basename(abs)
      const target = resolve(dirAbs, finalName)
      if (!target.startsWith(root + sep)) {
        throw new RemoteError('ide-tools/bad-path', 'target escapes the workspace root', {})
      }
      if (existsSync(target)) {
        throw new RemoteError('ide-tools/exists', 'an entry with that name already exists in the target directory', {})
      }
      await copyFile(abs, target)
    } catch (err) {
      if (err instanceof RemoteError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/copy-failed', message, {})
    }
  }

  /**
   * Write one workspace file's whole content (editor save, diff-panel save).
   * Host-side twin of the never-published `@deepseek-ai/dsh-api-workspace-files-write`
   * package this plugin used to depend on: same wire shape, same error codes,
   * same agent 回灌.
   *
   * The write goes through the host fs seam's `writeText` rather than
   * `node:fs`, for two properties the seam owns and this file cannot restate:
   * the Session's sandbox policy fences the target (`read-only` denies,
   * `workspace-write` re-canonicalizes and requires containment, so a swapped
   * symlink cannot redirect the write), and the guarded intent is applied
   * atomically against the file's real version — a tab saved from a stale
   * buffer loses the race and gets `FS_STALE_VERSION`, not a silent clobber.
   * The fence is resolved per call by {@link writePolicyFor}; the caller's own
   * `workspaceRoot` is only the lexical half of the confinement, and the seam's
   * re-canonicalization is the half that survives symlinks.
   *
   * The seam emits nothing on its own, and the `workspaceFiles.changes` stream
   * replays only instrumented writes (the OS is not watched), so a successful
   * write is announced explicitly — otherwise the session's own file-change
   * feed, and the agent's view of the tree, would not see it.
   */
  async writeFile(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    content: string,
    intent: WorkspaceFileWriteIntent | undefined,
    signal: AbortSignal | undefined,
  ): Promise<WorkspaceFileWriteResult> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
      if (path.length === 0) throw new RemoteError('ide-tools/bad-request', 'path is required', {})
      let abs: string
      try {
        abs = resolveWorkspacePath(workspaceRoot, path)
      } catch {
        throw new RemoteError('workspace-file-write/outside-workspace', `"${path}" is outside the workspace`, { path })
      }
      // Refuse a directory (or any other non-regular target) before the seam
      // sees it: the backend would otherwise fail it as a raw EISDIR.
      const info = await stat(abs).catch(() => undefined)
      if (info !== undefined && !info.isFile()) {
        throw new RemoteError('workspace-file-write/not-regular-file', `"${path}" is not a regular file`, { path })
      }
      const ctx = this.ctx as unknown as {
        fs: FsWriteSeam
        emit(event: string, ...args: unknown[]): void
      } & WritePolicyContext
      const target = await ctx.fs.resolve(abs, { cwd: resolve(workspaceRoot), signal })
      const outcome = await ctx.fs.writeText(target, content, intent, signal, writePolicyFor(ctx, workspaceFileScope))
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version })
      return {
        absolutePath: abs,
        version: outcome.version,
        operation: outcome.operation,
        bytes: Buffer.byteLength(content, 'utf8'),
      }
    } catch (err) {
      if (err instanceof RemoteError) throw err
      const rawCode = (err as { code?: unknown }).code
      const message = err instanceof Error ? err.message : String(err)
      const code = typeof rawCode === 'string'
        ? FS_WRITE_ERROR_CODES[rawCode] ?? 'workspace-file-write/failed'
        : 'workspace-file-write/failed'
      throw new RemoteError(code as keyof RemoteErrorDetailsMap, message, { path })
    }
  }

  /**
   * Reveal one workspace entry in the OS file manager (Explorer context menu →
   * Reveal in Finder / Reveal in File Explorer / Open Containing Folder, per
   * host platform — same labels as VS Code's REVEAL_IN_OS_LABEL). Implemented
   * with the platform's own opener because the plugin host is plain Node:
   *   darwin: `open -R <path>`  (selects the item in Finder)
   *   win32:  `explorer /select,<path>`  (explorer exits 1 even on success)
   *   linux:  `xdg-open <dir>`  (the item itself for directories, else parent)
   * The root path ('') opens the workspace root itself.
   */
  async fileReveal(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})
      // '' (the tree root) is allowed here: it reveals the workspace root itself.
      const abs = path.length === 0 ? resolve(workspaceRoot) : resolveWorkspacePath(workspaceRoot, path)
      if (!existsSync(abs)) throw new RemoteError('ide-tools/not-found', 'the entry no longer exists on disk', {})
      const platform = process.platform
      let argv: string[]
      if (platform === 'darwin') {
        argv = ['open', '-R', abs]
      } else if (platform === 'win32') {
        argv = ['explorer', `/select,${abs}`]
      } else {
        // Linux: a directory opens itself; a file opens its containing folder.
        argv = ['xdg-open', (await stat(abs)).isDirectory() ? abs : dirname(abs)]
      }
      const spec = {
        argv,
        cwd: workspaceRoot,
        stdio: {
          stdin: 'ignore' as const,
          stdout: { maxBytes: 4096 },
          stderr: { maxBytes: 4096 },
        },
        graceMs: 5000,
        signal,
      }
      let handle: import('@deepseek-ai/dsh-subprocess').SubprocessHandle
      try {
        handle = this.ctx.subprocess.spawn(spec as never)
      } catch {
        throw new RemoteError('ide-tools/reveal-failed', 'the OS opener could not start', {})
      }
      const outcome = await handle.done
      // Windows explorer.exe exits 1 even when it successfully opened a window.
      const benign = outcome.exitCode === 0 || (platform === 'win32' && outcome.exitCode === 1)
      if (!benign) {
        const stderrText = handle.collected.stderr?.readFrom(0)?.text ?? ''
        throw new RemoteError('ide-tools/reveal-failed', `opener exited with code ${outcome.exitCode}: ${stderrText.trim()}`, {})
      }
    } catch (err) {
      if (err instanceof RemoteError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/reveal-failed', message, {})
    }
  }

  /** The host OS family, so the client can label the reveal action like VS Code
   *  (Reveal in Finder / Reveal in File Explorer / Open Containing Folder). */
  async hostPlatform(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<string> {
    return process.platform
  }

  /** Stage all changes and commit with a message (git add -A && git commit).
   *  VS Code SCM commit split-button parity — the dropdown maps onto options:
   *  amend rewrites the last commit (an empty message keeps the previous one
   *  via --no-edit), signoff adds a Signed-off-by trailer (-s), push runs
   *  git push after the commit, sync runs git pull then git push. */
  async gitCommit(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    message: string,
    options: { amend?: boolean; signoff?: boolean; push?: boolean; sync?: boolean; autoStage?: boolean },
    signal: AbortSignal | undefined,
  ): Promise<{ committed: boolean; hash?: string; pushed?: boolean }> {
    const { workspaceRoot: cwd } = workspaceFileScope
    const opts = options ?? {}
    try {
      // VS Code's smart-commit model: stage everything UNLESS the caller says
      // the index already holds the exact set to commit (autoStage:false).
      // Staging a clean tree is a no-op, so amend-with-empty-input still only
      // rewords either way.
      if (opts.autoStage !== false) {
        await this.runGit(cwd, ['add', '-A'], signal)
      }
      // Commit with the message. Use -m to avoid editor launch.
      const argv = opts.amend
        ? (message.trim().length > 0 ? ['commit', '--amend', '-m', message] : ['commit', '--amend', '--no-edit'])
        : ['commit', '-m', message]
      if (opts.signoff) argv.push('-s')
      // VS Code smart-commit self-heal: when the client believed the index
      // held the staged set (autoStage:false) but git finds nothing staged,
      // its status snapshot was stale — stage everything and retry once,
      // exactly VS Code's "stage all changes and commit" path.
      const commitOnce = (): Promise<string> =>
        this.runGit(cwd, argv, signal).catch(async (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          if (opts.autoStage === false && /no changes added to commit|nothing to commit/.test(msg)) {
            await this.runGit(cwd, ['add', '-A'], signal)
            return this.runGit(cwd, argv, signal)
          }
          throw err
        })
      const out = await commitOnce()
      // Extract the commit hash from the commit output (line like "[main abc1234]"
      // or "[detached HEAD 5cf6db4]" — the branch label may contain spaces).
      const hashMatch = out.match(/\[[^\]]*?([0-9a-f]{7,40})\]/)
      // Post-commit commands (VS Code's Commit & Push / Commit & Sync):
      // sync = pull then push; push alone just pushes. Failures surface the
      // raw git stderr (e.g. a missing upstream), keeping the cause visible.
      let pushed: boolean | undefined
      if (opts.sync) {
        // VS Code parity: Commit and Sync pulls+pushes when an upstream is
        // configured, but PUBLISHES (push -u) a branch with no upstream instead
        // of failing on a bare pull (no tracking information).
        const hasUpstream = await this.hasUpstream(cwd, signal)
        if (hasUpstream) {
          await this.runGit(cwd, ['pull'], signal)
          await this.runGit(cwd, ['push'], signal)
        } else {
          await this.publishBranch(cwd, signal)
        }
        pushed = true
      } else if (opts.push) {
        // VS Code parity: Commit & Push pushes the upstream when set, else
        // publishes (push -u) so a branch with no upstream does not fail.
        const hasUpstream = await this.hasUpstream(cwd, signal)
        if (hasUpstream) {
          await this.runGit(cwd, ['push'], signal)
        } else {
          await this.publishBranch(cwd, signal)
        }
        pushed = true
      }
      return { committed: true, hash: hashMatch?.[1], pushed }
    } catch (err) {
      const message2 = err instanceof Error ? err.message : String(err)
      // "nothing to commit" is not a hard error — report it as committed:false.
      if (message2.includes('nothing to commit') || message2.includes('no changes')) {
        return { committed: false }
      }
      throw new RemoteError('ide-tools/git-commit-failed', message2, {})
    }
  }

  /** True when the current branch has an upstream tracking ref configured
   *  (git rev-parse --abbrev-ref @{u} succeeds). Used by sync flows to decide
   *  pull+push (has upstream) vs publish (push -u, no upstream). */
  private async hasUpstream(cwd: string, signal: AbortSignal | undefined): Promise<boolean> {
    try {
      const out = await this.runGit(cwd, ['rev-parse', '--abbrev-ref', '@{u}'], signal)
      return out.trim().length > 0
    } catch {
      // No upstream configured → rev-parse fails with "no upstream configured".
      return false
    }
  }

  /** Publish the current branch: git push -u <remote> <branch>. Prefers origin,
   *  falls back to the first listed remote. Throws a clear RemoteError when
   *  there are no remotes or HEAD is detached. */
  private async publishBranch(cwd: string, signal: AbortSignal | undefined): Promise<void> {
    const branch = (await this.runGit(cwd, ['branch', '--show-current'], signal)).trim()
    if (branch.length === 0) {
      throw new RemoteError('ide-tools/git-sync-failed', 'cannot determine the current branch (detached HEAD?)', {})
    }
    const remotes = (await this.runGit(cwd, ['remote'], signal)).split('\n').map((r) => r.trim()).filter((r) => r.length > 0)
    if (remotes.length === 0) {
      throw new RemoteError('ide-tools/git-sync-failed', 'your repository has no remotes configured to publish to', {})
    }
    const remote = remotes.includes('origin') ? 'origin' : remotes[0]
    await this.runGit(cwd, ['push', '-u', remote, branch], signal)
  }

  /** VS Code SCM action button: synchronize or publish the branch.
   *  sync = git pull then git push (the clean-tree "Synchronize Changes"
   *  button); publish = git push -u origin <branch> for a local branch with
   *  no upstream (the "Publish Branch" button). Raw git stderr surfaces so a
   *  missing remote/upstream stays diagnosable. */
  async gitSync(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    action: 'sync' | 'publish' | 'pull' | 'push',
    signal: AbortSignal | undefined,
  ): Promise<{ pushed: boolean }> {
    const { workspaceRoot: cwd } = workspaceFileScope
    try {
      if (action === 'pull') {
        // VS Code's "Pull" command: plain pull (fails with git's own message
        // when no upstream is configured — that message is the UI's error).
        await this.runGit(cwd, ['pull'], signal)
        return { pushed: false }
      }
      if (action === 'push') {
        // VS Code's "Push": pushes the upstream when set, else publishes.
        const hasUpstream = await this.hasUpstream(cwd, signal)
        if (hasUpstream) await this.runGit(cwd, ['push'], signal)
        else await this.publishBranch(cwd, signal)
        return { pushed: true }
      }
      if (action === 'sync') {
        // VS Code parity: Synchronize pulls+pushes when an upstream is
        // configured, but PUBLISHES (push -u) a branch with no upstream instead
        // of failing on a bare pull (no tracking information).
        const hasUpstream = await this.hasUpstream(cwd, signal)
        if (hasUpstream) {
          await this.runGit(cwd, ['pull'], signal)
          await this.runGit(cwd, ['push'], signal)
        } else {
          await this.publishBranch(cwd, signal)
        }
      } else {
        const branch = (await this.runGit(cwd, ['branch', '--show-current'], signal)).trim()
        if (branch.length === 0) {
          throw new RemoteError('ide-tools/git-sync-failed', 'cannot determine the current branch (detached HEAD?)', {})
        }
        // VS Code parity: single remote publishes via remotes[0]; prefer the
        // conventional origin when present, else the first listed remote.
        const remotes = (await this.runGit(cwd, ['remote'], signal)).split('\n').map((r) => r.trim()).filter((r) => r.length > 0)
        if (remotes.length === 0) {
          throw new RemoteError('ide-tools/git-sync-failed', 'your repository has no remotes configured to publish to', {})
        }
        const remote = remotes.includes('origin') ? 'origin' : remotes[0]
        await this.runGit(cwd, ['push', '-u', remote, branch], signal)
      }
      return { pushed: true }
    } catch (err) {
      if (err instanceof RemoteError) throw err
      const message2 = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/git-sync-failed', message2, {})
    }
  }

  /**
   * Generate a git-conventional commit message from the workspace's
   * uncommitted changes, using the currently configured LLM (agentDefaultModel).
   *
   * Mirrors the VS Code SCM AI assistants (Copilot / WeCode): the staged diff
   * is preferred when the index holds changes, otherwise the whole working
   * tree is used. The prompt also carries the branch name and the recent
   * commit subjects so the message matches the repository's language and
   * message conventions. The diff is capped per file section at 32 KiB and
   * the model output is sanitized (fences/labels stripped) before it lands in
   * the commit input. A client abort surfaces as the ide-tools/aborted code.
   */
  async gitGenerateCommitMessage(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<{ message: string }> {
    const { workspaceRoot: cwd } = workspaceFileScope
    try {
      if (!cwd) throw new RemoteError('ide-tools/no-workspace', 'workspace root is not set', {})

      let diff = ''
      let diffSource: 'staged' | 'working-tree' = 'working-tree'
      const untracked: string[] = []
      try {
        const statusRaw = await this.runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], signal)
        for (const part of statusRaw.split('\u0000')) {
          if (part.startsWith('?? ')) untracked.push(part.slice(3))
        }
        if (untracked.length > 0) {
          try { await this.runGit(cwd, ['add', '-N', '--', ...untracked], signal) } catch { /* ignore */ }
        }
        // VS Code SCM assistants prefer the staged diff when the index holds
        // changes, and fall back to the whole working tree otherwise.
        diff = await this.runGit(cwd, ['diff', '--cached', '--no-color'], signal)
        if (diff.trim().length > 0) {
          diffSource = 'staged'
        } else {
          // Unborn repository: `git diff HEAD` exits 128 — treat it as empty
          // so the plain worktree diff below takes over (it works on unborn
          // and includes the intent-to-add content).
          diff = await this.runGit(cwd, ['diff', 'HEAD', '--no-color'], signal).catch(() => '')
          if (diff.trim().length === 0) {
            diff = await this.runGit(cwd, ['diff', '--no-color'], signal)
          }
        }
      } catch (err) {
        if (err instanceof RemoteError && err.code === 'ide-tools/not-a-repo') {
          throw new RemoteError('ide-tools/not-a-repo', 'workspace is not a git repository', {})
        }
        throw err
      } finally {
        // Undo the intent-to-add marks: they linger in the index otherwise —
        // rendering as '.A' status entries and never being committed by a
        // plain `git commit` (git does not count i-t-a as staged changes).
        // Resetting exactly the paths we marked restores the pristine
        // untracked state, whatever happened above.
        if (untracked.length > 0) {
          try { await this.runGit(cwd, ['reset', '-q', '--', ...untracked], signal) } catch { /* ignore */ }
        }
      }

      if (diff.trim().length === 0) {
        throw new RemoteError('ide-tools/no-changes', 'no uncommitted changes to generate a message from', {})
      }

      // Style context: the branch name and the recent commit subjects teach the
      // model the repository's language and message conventions (both are best
      // effort — a missing history or detached HEAD must not block generation).
      const branch = await this.runGit(cwd, ['branch', '--show-current'], signal).catch(() => '')
      const recentSubjects = await this.runGit(cwd, ['log', '--format=%s', '-n', '10'], signal).catch(() => '')

      const MAX_DIFF = 32 * 1024
      const trimmed = this.truncateDiffForPrompt(diff, MAX_DIFF)

      const ctx = this.ctx as Context & { llm?: { stream(options: never): AsyncIterable<{ type: string; text?: string }> }; agentDefaultModel?: { currentSelection(): { provider: string; model: string; reasoningEffort?: string } } }
      if (!ctx.llm) {
        throw new RemoteError('ide-tools/llm-unavailable', 'LLM service is not available', {})
      }
      const selection = ctx.agentDefaultModel?.currentSelection()
      if (!selection || !selection.provider || !selection.model) {
        throw new RemoteError('ide-tools/no-model', 'no model is configured', {})
      }

      const systemPrompt = [
        'You are an expert software engineer who writes git commit messages.',
        'You will receive the current branch name, the recent commit subjects, and a git diff.',
        'Generate ONE commit message following the Conventional Commits specification:',
        '  <type>(<optional scope>): <subject>',
        '  <optional body>',
        '',
        'Rules:',
        '- type: one of feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert',
        '- subject: imperative mood, no trailing period, max 50 chars',
        '- body (optional): wrap at 72 chars, explain what and why (not how); separate it from the subject with one blank line',
        '- When recent commit subjects are provided, match their language and phrasing style (e.g. write Chinese if the history is Chinese); otherwise use the language of the diff, else English.',
        '- Focus on the meaningful source changes; ignore generated/build artifacts when real changes exist.',
        '- Output ONLY the commit message: no markdown fences, no quotes, no explanations.',
      ].join('\n')

      const styleBlock = recentSubjects.trim().length > 0
        ? 'Recent commit subjects (style reference):\n' + recentSubjects.trim()
        : 'No recent commit history available.'
      const userText = [
        'Branch: ' + (branch.trim().length > 0 ? branch.trim() : '(unknown)'),
        '',
        styleBlock,
        '',
        diffSource === 'staged' ? 'Staged changes (git diff --cached):' : 'Working tree changes (git diff HEAD):',
        '',
        '```',
        trimmed,
        '```',
      ].join('\n')

      // Build a properly identified + frozen user message using the dsh-llm
      // helper (hand-built messages missing the id field crash the adapter).
      // DSH 0.2.0 removed the 'plugin' message source kind: MessageSource is now a
      // merge-extensible sum type with no shared catch-all 'plugin' kind, and user
      // messages may carry any producer's kind. This plugin-initiated prompt is a
      // user-authored request, so 'user' is the faithful attribution.
      const messages = [createUserMessage({
        content: [{ type: 'text', text: userText }],
        source: { kind: 'user' },
      })]

      // No explicit maxTokens: a hardcoded 2048 cap starves reasoning models
      // — they spend the whole budget on reasoning and return no text. With the
      // cap unset, the dsh-llm adapter applies the bound model's
      // defaultMaxTokens, leaving room for both reasoning and the message.
      const options = deepFreeze({
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort as never,
        system: systemPrompt,
        messages,
        signal,
      } as never)

      // Use BlockAssembler to robustly collect all text from the stream, and keep the terminal
      // finish chunk: adapter failures arrive as an error-kind finish (not a thrown exception), so
      // ignoring it would mask the real cause behind a misleading "empty message".
      const assembler = new BlockAssembler()
      let finish: { kind?: string; failure?: { code?: string; message?: string } } | undefined
      for await (const chunk of ctx.llm.stream(options)) {
        if (signal?.aborted) break
        if ((chunk as { type?: string }).type === 'finish') {
          finish = (chunk as { reason?: { kind?: string; failure?: { code?: string; message?: string } } }).reason
          continue
        }
        assembler.push(chunk as never)
      }

      if (signal?.aborted || finish?.kind === 'aborted') {
        throw new RemoteError('ide-tools/aborted', 'commit message generation was cancelled', {})
      }
      if (finish?.kind === 'error') {
        const cause = finish.failure?.message ?? finish.failure?.code ?? 'unknown adapter failure'
        throw new RemoteError('ide-tools/llm-failed', cause, {})
      }

      const blocks = assembler.blocks()
      const message = this.sanitizeCommitMessage(
        blocks
          .filter((b) => b.type === 'text')
          .map((b) => ('text' in b ? b.text ?? '' : ''))
          .join(''),
      )

      if (message.length === 0) {
        // Distinguish "the model only reasoned" (budget spent before any text) from a truly empty
        // response — reasoning models under a small token budget hit exactly this.
        const reasoned = blocks.some((b) => b.type === 'reasoning')
        throw new RemoteError(
          'ide-tools/llm-empty',
          reasoned
            ? 'the model spent its whole token budget on reasoning and returned no text; retry or lower the reasoning effort'
            : 'the model returned an empty message',
          {},
        )
      }

      return { message }
    } catch (err) {
      if (signal?.aborted) {
        throw new RemoteError('ide-tools/aborted', 'commit message generation was cancelled', {})
      }
      if (err instanceof RemoteError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new RemoteError('ide-tools/llm-failed', message, {})
    }
  }

  /** Cap a unified diff for the prompt: keep whole per-file sections while
   *  the byte budget lasts (so no file is cut mid-hunk), then note how many
   *  files were omitted. A single oversized section (e.g. a rebuilt bundle)
   *  keeps its head at the budget. */
  private truncateDiffForPrompt(diff: string, maxBytes: number): string {
    if (diff.length <= maxBytes) return diff
    const sections: string[] = []
    let current: string[] = []
    for (const line of diff.split('\n')) {
      if (line.startsWith('diff --git ') && current.length > 0) {
        sections.push(current.join('\n'))
        current = [line]
      } else {
        current.push(line)
      }
    }
    if (current.length > 0) sections.push(current.join('\n'))

    let kept = ''
    let omitted = 0
    for (const section of sections) {
      if (kept.length === 0 && section.length > maxBytes) {
        kept = section.slice(0, maxBytes) + '\n… (file diff truncated)'
        omitted = sections.length - 1
        break
      }
      if (kept.length + section.length > maxBytes) { omitted += 1; continue }
      kept = kept.length === 0 ? section : kept + '\n' + section
    }
    return kept + (omitted > 0 ? '\n… (' + omitted + ' more file diff(s) omitted)' : '')
  }

  /** Clean model output: strip markdown fences and commit-message label
   *  lines and signature lines, collapse runs of blank lines, trim. */
  private sanitizeCommitMessage(raw: string): string {
    let text = raw.trim()
    const label = /^\s*(?:suggested commit message|commit message|提交信息|提交消息)\s*[:：]\s*/i
    text = text.replace(label, '')
    // Strip one wrapping markdown fence, optionally language-tagged.
    if (text.startsWith('```')) {
      const firstNl = text.indexOf('\n')
      const lastFence = text.lastIndexOf('```')
      if (firstNl > 0 && lastFence > firstNl) text = text.slice(firstNl + 1, lastFence)
    }
    text = text.replace(label, '')
    // Drop model signature lines (Generated with …).
    text = text.split('\n').filter((line) => !/generated\s+(with|by)\b/i.test(line)).join('\n')
    // Collapse runs of blank lines to one blank line.
    text = text.replace(/\n{3,}/g, '\n\n').trim()
    return text
  }
  /** Plugin teardown: terminate every still-live terminal. */
  private async disposeAll(): Promise<void> {
    const entries = [...this.terminals.values()]
    this.terminals.clear()
    await Promise.allSettled(entries.map(async (entry) => {
      for (const subscriber of entry.subscribers) subscriber({ data: '', exit: true })
      entry.subscribers.clear()
      await entry.handle.terminate().catch(() => undefined)
    }))
  }
}

export default IdeTools
