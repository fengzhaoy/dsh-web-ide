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
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
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
  readonly contentType?: 'text' | 'image'
  readonly imageBase64?: string
}

/** One live interactive terminal plus its replay log and live subscribers. */
interface TerminalEntry {
  readonly id: string
  readonly handle: {
    readonly pid: number
    readonly output: NodeJS.ReadableStream
    readonly done: Promise<unknown>
    write(data: string): Promise<void>
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
  static inject = ['subprocess', 'sessions', 'typert', 'llm', 'agentDefaultModel']

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
          Object.freeze({ method: 'terminalOutput', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitStatus', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitBranches', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitDiff', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitStage', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitDiscard', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'fileRename', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'fileDelete', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'fileCreate', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'fileReveal', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'hostPlatform', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'gitGenerateCommitMessage', invocation: Object.freeze({ kind: 'direct' }) }),
        ]),
      }),
    })
    // Terminate every still-live terminal when the plugin unloads.
    ctx.effect(() => () => { void this.disposeAll() }, 'ideTools: terminal teardown')
  }

  /** Workspace grep reusing dsh-tool-fs-search's ripgrep machinery verbatim. */
  async search(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    query: { pattern: string; include?: string; path?: string; caseSensitive: boolean },
    signal: AbortSignal,
  ): Promise<IdeSearchResult> {
    const { workspaceRoot } = workspaceFileScope
    if (query.pattern.length === 0) throw new RemoteError('ide-tools/bad-request', 'pattern is empty')
    const input: { pattern: string; include?: string; path?: string } = { pattern: query.pattern }
    if (query.include !== undefined && query.include.length > 0) input.include = query.include
    if (query.path !== undefined && query.path.length > 0) input.path = query.path
    let argv = buildGrepCommand(input)
    if (!query.caseSensitive) argv = ['-i', ...argv]
    const exec = { signal, agent: { session: { header: { cwd: workspaceRoot } } } }
    const run = await runRipgrep(this.ctx as never, exec, 'grep', argv, RAW_OUTPUT_MAX_BYTES, SEARCH_GRACE_MS, SEARCH_STDERR_MAX_BYTES)
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
    spec: { cols: number; rows: number; command?: string },
    signal: AbortSignal,
  ): Promise<IdeTerminalOpenResult> {
    const { workspaceRoot } = workspaceFileScope
    const shell = spec.command !== undefined && spec.command.length > 0 ? spec.command : (process.env.SHELL ?? '/bin/zsh')
    const argv = [shell, '-l']
    const cols = Math.max(2, Math.min(500, Math.round(spec.cols)))
    const rows = Math.max(2, Math.min(300, Math.round(spec.rows)))
    const handle = await this.ctx.subprocess.spawnTerminal({
      argv,
      cwd: workspaceRoot,
      // Inherit the parent environment so zsh picks up PATH, HOME, LANG,
      // ZDOTDIR, and any ZSH_* / LS_COLORS / PROMPT settings the user has
      // configured. Then force TERM/COLORTERM so xterm.js renders the full
      // ANSI palette the shell emits.
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
    const emit = (data: string, exit: boolean): void => {
      entry.log.push(data)
      entry.logBytes += data.length * 0.75
      while (entry.logBytes > MAX_LOG_BYTES && entry.log.length > 1) {
        entry.logBytes -= entry.log[0].length * 0.75
        entry.log.shift()
      }
      for (const subscriber of entry.subscribers) subscriber({ data, exit })
    }
    entry.handle.output.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      emit(text.toString('base64'), false)
    })
    const finish = (): void => {
      entry.exited = true
      for (const subscriber of entry.subscribers) subscriber({ data: '', exit: true })
      entry.subscribers.clear()
    }
    entry.handle.output.on('end', finish)
    entry.handle.output.on('error', finish)
    void entry.handle.done.catch(() => undefined)
  }

  /** Deliver one input chunk to the terminal. */
  async terminalWrite(
    _workspaceFileScope: { sessionId: string; workspaceRoot: string },
    terminalId: string,
    data: string,
    _signal: AbortSignal,
  ): Promise<void> {
    const entry = this.terminals.get(terminalId)
    if (entry === undefined) throw new RemoteError('ide-tools/no-such-terminal', 'terminal ' + JSON.stringify(terminalId) + ' is not open')
    if (entry.exited) throw new RemoteError('ide-tools/terminal-exited', 'terminal ' + JSON.stringify(terminalId) + ' has exited')
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
    if (entry === undefined) throw new RemoteError('ide-tools/no-such-terminal', 'terminal ' + JSON.stringify(terminalId) + ' is not open')
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

  /** Stream one terminal's output: replay log first, then live frames. */
  async *terminalOutput(
    _workspaceFileScope: { sessionId: string; workspaceRoot: string },
    terminalId: string,
    signal: AbortSignal,
  ): AsyncGenerator<IdeTerminalOutputFrame, void, void> {
    const entry = this.terminals.get(terminalId)
    if (entry === undefined) throw new RemoteError('ide-tools/no-such-terminal', 'terminal ' + JSON.stringify(terminalId) + ' is not open')
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
      throw new RemoteError('ide-tools/git-failed', 'git command could not start')
    }
    let outcome: import('@deepseek-ai/dsh-subprocess').SubprocessOutcome
    try {
      outcome = await handle.done
    } catch {
      throw new RemoteError('ide-tools/git-failed', 'git process failed before reporting an outcome')
    }
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (stdout === undefined) throw new RemoteError('ide-tools/git-failed', 'git produced no collected stdout')
    // Exit 128 with a "not a git repository" message → notARepo, not a failure.
    const stderrText = stderr?.text ?? ''
    if (outcome.exitCode === 128 && /not a git repository/i.test(stderrText)) {
      throw new RemoteError('ide-tools/not-a-repo', 'the workspace root is not a git repository')
    }
    if (outcome.signal !== null || outcome.exitCode === null) {
      throw new RemoteError('ide-tools/git-failed', 'git was killed by signal ' + (outcome.signal ?? '(unknown)'))
    }
    if (outcome.exitCode !== 0) {
      throw new RemoteError('ide-tools/git-failed', 'git exited with code ' + outcome.exitCode + ': ' + stderrText.trim())
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
    if (x === 'R' || y === 'R') return 'renamed'
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
      // %00 delim: refname, upstream, ahead, behind, objectname, authordate:short, HEAD
      const fmt = '%(refname:short)%00%(upstream:short)%00%(upstream:track,normalspace)%00%(objectname:short)%00%(committerdate:short)%00%(HEAD)%00'
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
      return { notARepo: false, branches, current }
    } catch (err) {
      if (err instanceof RemoteError && err.code === 'ide-tools/not-a-repo') return EMPTY
      throw err
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
      // For image files, read the working-tree file from disk and return it as base64
      let oldContent = ''
      try {
        oldContent = await this.runGit(cwd, ['show', 'HEAD:' + path], signal)
      } catch { /* untracked */ }
      let imageBase64 = ''
      try {
        const buf = await readFile(join(cwd, path))
        const mime = ext === 'svg' ? 'image/svg+xml' : 'image/' + ext
        imageBase64 = 'data:' + mime + ';base64,' + buf.toString('base64')
      } catch { /* deleted */ }
      return {
        empty: !imageBase64,
        diff: '',
        oldContent,
        newContent: '',
        oldPath: path,
        newPath: path,
        language,
        contentType: 'image',
        imageBase64: imageBase64 || undefined,
      }
    }
    // Pick the diff scope:
    //  unstaged → git diff -- <path>            (worktree vs index)
    //  staged   → git diff --cached -- <path>   (index vs HEAD)
    //  head     → git diff HEAD -- <path>       (worktree vs HEAD, staged+unstaged)
    const diffArgv: string[] = ['diff']
    if (kind === 'staged') diffArgv.push('--cached')
    else if (kind === 'head') diffArgv.push('HEAD')
    diffArgv.push('--', path)
    try {
      if (!cwd) return { empty: true, diff: '', oldContent: '', newContent: '', oldPath: path, newPath: path, language }
      const diff = await this.runGit(cwd, diffArgv, signal)
      // Left side: the committed (HEAD) version — empty for a new/untracked file.
      let oldContent = ''
      try {
        oldContent = await this.runGit(cwd, ['show', 'HEAD:' + path], signal)
      } catch {
        // HEAD:path does not exist (added/untracked) — oldContent stays ''.
      }
      // Right side: the WORKING-TREE file. An unstaged edit leaves the index at
      // the HEAD blob, so reading ':path' here produced two identical sides and
      // a diff with no visible changes. Reading the file from disk shows the
      // actual uncommitted content (staged + unstaged) against HEAD.
      let newContent = ''
      try {
        const buf = await readFile(join(cwd, path))
        newContent = buf.toString('utf8')
      } catch {
        // The file is gone from the working tree (deleted) — newContent stays ''.
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

  /** Stage all changes (git add -A) in the workspace root. */
  async gitStageAll(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
    const { workspaceRoot: cwd } = workspaceFileScope
    try {
      await this.runGit(cwd, ['add', '-A'], signal)
      return { ok: true, value: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'ide-tools/git-stage-failed', message } }
    }
  }

  /** Stage one path (git add -- path). Untracked files become staged adds. */
  async gitStage(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
    const { workspaceRoot: cwd } = workspaceFileScope
    try {
      if (!cwd) return { ok: false, error: { code: 'ide-tools/no-workspace', message: 'workspace root is not set' } }
      if (path.length === 0) return { ok: false, error: { code: 'ide-tools/bad-request', message: 'path is empty' } }
      await this.runGit(cwd, ['add', '--', path], signal)
      return { ok: true, value: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'ide-tools/git-stage-failed', message } }
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
  ): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
    const { workspaceRoot: cwd } = workspaceFileScope
    if (!cwd) return { ok: false, error: { code: 'ide-tools/no-workspace', message: 'workspace root is not set' } }
    const { path, oldPath, kind } = entry
    if (path.length === 0) return { ok: false, error: { code: 'ide-tools/bad-request', message: 'path is empty' } }
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
      return { ok: true, value: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'ide-tools/git-discard-failed', message } }
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
  ): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) return { ok: false, error: { code: 'ide-tools/no-workspace', message: 'workspace root is not set' } }
      if (path.length === 0 || newName.length === 0) return { ok: false, error: { code: 'ide-tools/bad-request', message: 'path and name are required' } }
      if (newName === '.' || newName === '..' || /[/\\]/.test(newName)) {
        return { ok: false, error: { code: 'ide-tools/bad-request', message: 'invalid name' } }
      }
      const abs = resolveWorkspacePath(workspaceRoot, path)
      const target = resolve(dirname(abs), newName)
      const root = resolve(workspaceRoot)
      if (!target.startsWith(root + sep)) {
        return { ok: false, error: { code: 'ide-tools/bad-path', message: 'target escapes the workspace root' } }
      }
      if (existsSync(target)) {
        return { ok: false, error: { code: 'ide-tools/exists', message: 'an entry with that name already exists' } }
      }
      await rename(abs, target)
      return { ok: true, value: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'ide-tools/rename-failed', message } }
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
  ): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) return { ok: false, error: { code: 'ide-tools/no-workspace', message: 'workspace root is not set' } }
      if (path.length === 0) return { ok: false, error: { code: 'ide-tools/bad-request', message: 'path is required' } }
      const abs = resolveWorkspacePath(workspaceRoot, path)
      await rm(abs, { recursive: kind === 'directory', force: true })
      return { ok: true, value: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'ide-tools/delete-failed', message } }
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
  ): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) return { ok: false, error: { code: 'ide-tools/no-workspace', message: 'workspace root is not set' } }
      if (path.length === 0) return { ok: false, error: { code: 'ide-tools/bad-request', message: 'path is required' } }
      const abs = resolveWorkspacePath(workspaceRoot, path)
      if (existsSync(abs)) {
        return { ok: false, error: { code: 'ide-tools/exists', message: 'an entry with that name already exists' } }
      }
      if (kind === 'directory') {
        await mkdir(abs, { recursive: true })
      } else {
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, '', { flag: 'wx' })
      }
      return { ok: true, value: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'ide-tools/create-failed', message } }
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
  ): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
    const { workspaceRoot } = workspaceFileScope
    try {
      if (!workspaceRoot) return { ok: false, error: { code: 'ide-tools/no-workspace', message: 'workspace root is not set' } }
      // '' (the tree root) is allowed here: it reveals the workspace root itself.
      const abs = path.length === 0 ? resolve(workspaceRoot) : resolveWorkspacePath(workspaceRoot, path)
      if (!existsSync(abs)) return { ok: false, error: { code: 'ide-tools/not-found', message: 'the entry no longer exists on disk' } }
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
        return { ok: false, error: { code: 'ide-tools/reveal-failed', message: 'the OS opener could not start' } }
      }
      const outcome = await handle.done
      // Windows explorer.exe exits 1 even when it successfully opened a window.
      const benign = outcome.exitCode === 0 || (platform === 'win32' && outcome.exitCode === 1)
      if (!benign) {
        const stderrText = handle.collected.stderr?.readFrom(0)?.text ?? ''
        return { ok: false, error: { code: 'ide-tools/reveal-failed', message: `opener exited with code ${outcome.exitCode}: ${stderrText.trim()}` } }
      }
      return { ok: true, value: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'ide-tools/reveal-failed', message } }
    }
  }

  /** The host OS family, so the client can label the reveal action like VS Code
   *  (Reveal in Finder / Reveal in File Explorer / Open Containing Folder). */
  async hostPlatform(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<{ ok: true; value: string } | { ok: false; error: { code: string; message: string } }> {
    return { ok: true, value: process.platform }
  }

  /** Stage all changes and commit with a message (git add -A && git commit -m). */
  async gitCommit(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    message: string,
    signal: AbortSignal | undefined,
  ): Promise<{ ok: true; value: { committed: boolean; hash?: string } } | { ok: false; error: { code: string; message: string } }> {
    const { workspaceRoot: cwd } = workspaceFileScope
    try {
      // Stage all changes first.
      await this.runGit(cwd, ['add', '-A'], signal)
      // Commit with the message. Use -m to avoid editor launch.
      const out = await this.runGit(cwd, ['commit', '-m', message], signal)
      // Extract the commit hash from the commit output (line like "[main abc1234] ...").
      const hashMatch = out.match(/\[\S+ ([0-9a-f]{7,})\]/)
      return { ok: true, value: { committed: true, hash: hashMatch?.[1] } }
    } catch (err) {
      const message2 = err instanceof Error ? err.message : String(err)
      // "nothing to commit" is not a hard error — report it as ok but not committed.
      if (message2.includes('nothing to commit') || message2.includes('no changes')) {
        return { ok: true, value: { committed: false } }
      }
      return { ok: false, error: { code: 'ide-tools/git-commit-failed', message: message2 } }
    }
  }

  /**
   * Generate a git-conventional commit message from the workspace's unstaged
   * + untracked changes, using the currently configured LLM (agentDefaultModel).
   *
   * The method collects a unified diff of all changes (capped at 32 KiB to
   * fit a one-shot prompt), asks the model for a Conventional Commits format
   * message (type(scope): subject + optional body), and returns the raw text.
   */
  async gitGenerateCommitMessage(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<{ ok: true; value: { message: string } } | { ok: false; error: { code: string; message: string } }> {
    const { workspaceRoot: cwd } = workspaceFileScope
    try {
      if (!cwd) return { ok: false, error: { code: 'ide-tools/no-workspace', message: 'workspace root is not set' } }

      let diff = ''
      try {
        const statusRaw = await this.runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], signal)
        const untracked: string[] = []
        for (const part of statusRaw.split('\u0000')) {
          if (part.startsWith('?? ')) untracked.push(part.slice(3))
        }
        if (untracked.length > 0) {
          try { await this.runGit(cwd, ['add', '-N', '--', ...untracked], signal) } catch { /* ignore */ }
        }
        diff = await this.runGit(cwd, ['diff', 'HEAD', '--no-color'], signal)
        if (diff.trim().length === 0) {
          diff = await this.runGit(cwd, ['diff', '--cached', '--no-color'], signal)
          if (diff.trim().length === 0) {
            diff = await this.runGit(cwd, ['diff', '--no-color'], signal)
          }
        }
      } catch (err) {
        if (err instanceof RemoteError && err.code === 'ide-tools/not-a-repo') {
          return { ok: false, error: { code: 'ide-tools/not-a-repo', message: 'workspace is not a git repository' } }
        }
        throw err
      }

      if (diff.trim().length === 0) {
        return { ok: false, error: { code: 'ide-tools/no-changes', message: 'no uncommitted changes to generate a message from' } }
      }

      const MAX_DIFF = 32 * 1024
      const trimmed = diff.length > MAX_DIFF ? diff.slice(0, MAX_DIFF) + '\n... (diff truncated)' : diff

      const ctx = this.ctx as Context & { llm?: { stream(options: never): AsyncIterable<{ type: string; text?: string }> }; agentDefaultModel?: { currentSelection(): { provider: string; model: string; reasoningEffort?: string } } }
      if (!ctx.llm) {
        return { ok: false, error: { code: 'ide-tools/llm-unavailable', message: 'LLM service is not available' } }
      }
      const selection = ctx.agentDefaultModel?.currentSelection()
      if (!selection || !selection.provider || !selection.model) {
        return { ok: false, error: { code: 'ide-tools/no-model', message: 'no model is configured' } }
      }

      const systemPrompt = [
        'You are an expert software engineer who writes git commit messages.',
        'Analyze the provided git diff and generate a commit message following the Conventional Commits specification:',
        '  <type>(<optional scope>): <subject>',
        '  <optional body>',
        '',
        'Rules:',
        '- type: one of feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert',
        '- subject: imperative mood, lowercase, no period, max 50 chars',
        '- body (optional): wrap at 72 chars, explain what and why (not how)',
        '- Output ONLY the commit message, no markdown fences, no explanations.',
        '- If the diff is in Chinese or the repo appears Chinese, write the message in Chinese.',
      ].join('\n')

      const userText = 'Generate a commit message for this git diff:\n\n```\n' + trimmed + '\n```'

      // Build a properly identified + frozen user message using the dsh-llm
      // helper (hand-built messages missing the id field crash the adapter).
      const messages = [createUserMessage({
        content: [{ type: 'text', text: userText }],
        source: { kind: 'plugin', plugin: 'dsh-client-ui-ide' },
      })]

      const options = deepFreeze({
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort as never,
        system: systemPrompt,
        messages,
        maxTokens: 512,
        signal,
      } as never)

      // Use BlockAssembler to robustly collect all text from the stream.
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream(options)) {
        if (signal?.aborted) break
        assembler.push(chunk as never)
      }

      const blocks = assembler.blocks()
      const message = blocks
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text?: string }) => b.text ?? '')
        .join('')
        .trim()

      if (message.length === 0) {
        return { ok: false, error: { code: 'ide-tools/llm-empty', message: 'the model returned an empty message' } }
      }

      return { ok: true, value: { message } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'ide-tools/llm-failed', message } }
    }
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
