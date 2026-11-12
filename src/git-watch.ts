/**
 * Workspace file-system watcher that drives git status refreshes.
 *
 * WHY: the webview used to poll git status every 15s. VS Code does not poll —
 * its git extension rescans when FILE EVENTS arrive, when the window regains
 * focus, and after git operations. The focus/visibility half lives in the
 * client; this module supplies the file-event half, which is the only way to
 * notice git commands run in the integrated terminal.
 *
 * Design notes:
 *  - One watcher per workspace root, shared by every pending long-poll.
 *  - `fs.watch(..., { recursive: true })` covers the repo AND its .git dir on
 *    macOS/Windows. Verified: `git add` emits .git/index + .git/objects.
 *  - `.git/index.lock` is filtered out: even a read-only `git status` creates
 *    and removes it, and reacting to it would feed the refetch back into
 *    itself.
 *  - Events are debounced (300ms) and throttled (1s) so a branch switch, which
 *    rewrites hundreds of files, produces ONE refresh instead of hundreds.
 */

import { watch, type FSWatcher } from 'node:fs'

/** Low-volume change counter handed to the client; it only ever increases. */
interface GitWatchState {
  watcher: FSWatcher
  /** Bumped once per debounced batch. */
  version: number
  /** Resolvers of long-polls waiting for the next bump. */
  waiters: Set<() => void>
  debounce: ReturnType<typeof setTimeout> | undefined
  /** >0 while a git command WE started is running. */
  paused: number
  /** Timestamp of the last accepted bump, for throttling. */
  lastBump: number
}

const DEBOUNCE_MS = 300
const THROTTLE_MS = 1000

const states = new Map<string, GitWatchState>()

/**
 * Paths whose churn is meaningless for git status. node_modules/.pnpm-store
 * are ignored by git anyway, but the watcher still sees every write there.
 */
const IGNORED_SEGMENTS = ['node_modules', '.pnpm-store', '.yarn', '.next', '.turbo', 'dist', 'lib', '.cache']

function isNoise(rel: string): boolean {
  // The lock file appears for READ-ONLY git commands too (git status creates
  // and removes .git/index.lock), so reacting to it would loop.
  if (rel.endsWith('.lock')) return true
  return rel.split('/').some((seg) => IGNORED_SEGMENTS.includes(seg))
}

function bump(root: string): void {
  const state = states.get(root)
  // A paused window means WE are running git: its index churn is our own.
  if (state === undefined || state.paused > 0) return
  const now = Date.now()
  if (now - state.lastBump < THROTTLE_MS) {
    // Inside the throttle window: schedule one trailing bump so the last
    // event of a burst is never lost.
    if (state.debounce === undefined) {
      state.debounce = setTimeout(() => {
        state.debounce = undefined
        // Re-check: the pause may have started while this was queued.
        if (states.get(root) === state && state.paused === 0) {
          state.lastBump = Date.now()
          state.version += 1
          wakeAll(state)
        }
      }, THROTTLE_MS)
    }
    return
  }
  state.lastBump = now
  state.version += 1
  wakeAll(state)
}

function wakeAll(state: GitWatchState): void {
  const pending = [...state.waiters]
  state.waiters.clear()
  for (const wake of pending) wake()
}

function ensureWatcher(root: string): GitWatchState | undefined {
  const existing = states.get(root)
  if (existing !== undefined) return existing
  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true, persistent: true }, (_event, filename) => {
      if (filename === null) { bump(root); return }
      const rel = String(filename).split('\\').join('/')
      if (isNoise(rel)) return
      const state = states.get(root)
      if (state === undefined) return
      if (state.debounce !== undefined) clearTimeout(state.debounce)
      state.debounce = setTimeout(() => {
        state.debounce = undefined
        bump(root)
      }, DEBOUNCE_MS)
    })
  } catch {
    // A root we cannot watch (permissions, vanished directory) simply falls
    // back to the client's 60s net.
    return undefined
  }
  watcher.on('error', () => { closeWatcher(root) })
  const state: GitWatchState = { watcher, version: 0, waiters: new Set(), debounce: undefined, lastBump: 0, paused: 0 }
  states.set(root, state)
  return state
}

function closeWatcher(root: string): void {
  const state = states.get(root)
  if (state === undefined) return
  if (state.debounce !== undefined) clearTimeout(state.debounce)
  try { state.watcher.close() } catch { /* already closed */ }
  states.delete(root)
}

/**
 * Wait until the workspace changes since `since`, or until `timeoutMs` elapses.
 * Returns the current version; a value greater than `since` means "something
 * changed, refetch git status". The long-poll shape lets this ride on the
 * existing request/response RPC without a new transport.
 */
export async function waitForGitChange(
  root: string,
  since: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  const state = ensureWatcher(root)
  if (state === undefined) return since
  if (state.version > since) return state.version
  if (signal?.aborted === true) return state.version
  await new Promise<void>((resolve) => {
    const done = (): void => {
      state.waiters.delete(done)
      clearTimeout(timer)
      // Detach the abort listener too: `once` only removes it when the abort
      // ACTUALLY fires, so every timeout-completed long poll used to leave one
      // listener behind on the request signal.
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    state.waiters.add(done)
    signal?.addEventListener('abort', done, { once: true })
  })
  return state.version
}

/** Current version without waiting (priming call after a full fetch). */
export function currentGitVersion(root: string): number {
  const state = ensureWatcher(root)
  return state?.version ?? 0
}

/**
 * Suspend event handling while WE run git. A git command touches .git/index
 * even when nothing changed (stat-cache flush), so without this window every
 * status fetch would schedule the next one.
 */
export function pauseGitWatch(root: string): void {
  const state = states.get(root)
  if (state === undefined) return
  state.paused += 1
  if (state.debounce !== undefined) { clearTimeout(state.debounce); state.debounce = undefined }
}

/** Resume after our git command; changes that landed during the pause are dropped. */
export function resumeGitWatch(root: string): void {
  const state = states.get(root)
  if (state === undefined) return
  state.paused = Math.max(0, state.paused - 1)
}

/** Diagnostics for tests: the internal state of every watched root. */
export function debugGitWatch(): Array<{ root: string; version: number; paused: number; waiters: number }> {
  return [...states.entries()].map(([root, st]) => ({ root, version: st.version, paused: st.paused, waiters: st.waiters.size }))
}

/** Drop the watcher for a root (session teardown). */
export function closeGitWatch(root: string): void {
  closeWatcher(root)
}
