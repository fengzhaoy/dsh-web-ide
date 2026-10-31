/**
 * Directory-load bookkeeping for "Reveal in Explorer".
 *
 * The tree lists each directory lazily: a row only exists after its parent's
 * listing has ARRIVED, and expansions cascade one level at a time. Polling the
 * DOM for the final row therefore fails whenever a level is slow, deep, or
 * errors — the classic "collapsed folder did not open" symptom. Instead the
 * tree records which directories have finished loading and notifies waiters,
 * so reveal can await each level in turn.
 */

/** A pending wait. Called with true when the directory loaded, false when the
 *  wait was cancelled (refresh/unmount) or timed out. */
type Waiter = (loaded: boolean) => void

/** Directories whose listing has been received (or permanently failed). */
export class DirLoadRegistry {
  private readonly loaded = new Set<string>()
  private readonly waiters = new Map<string, Waiter[]>()

  isLoaded(dir: string): boolean {
    return this.loaded.has(dir)
  }

  /** Pending waiters for a directory. Exposed for tests. */
  waiterCount(dir: string): number {
    return this.waiters.get(dir)?.length ?? 0
  }

  /** Record a finished load and wake everyone waiting on this directory. */
  markLoaded(dir: string): void {
    this.loaded.add(dir)
    const list = this.waiters.get(dir)
    if (list === undefined) return
    this.waiters.delete(dir)
    for (const fn of list) fn(true)
  }

  /** A directory collapsing invalidates its cached listing. */
  markUnloaded(dir: string): void {
    this.loaded.delete(dir)
  }

  /** Forget every mark and RELEASE pending waiters as cancelled. Reporting
   *  them as loaded would tell a reveal that a level finished when it did not,
   *  and the reveal would then scroll a tree that was just blanked. */
  clear(): void {
    this.loaded.clear()
    const all = [...this.waiters.values()]
    this.waiters.clear()
    for (const list of all) for (const fn of list) fn(false)
  }

  /** Resolve true once `dir` has loaded, false on timeout or cancellation.
   *  Never rejects: one broken directory must not strand the caller, which
   *  simply stops descending. */
  waitFor(dir: string, timeoutMs: number): Promise<boolean> {
    if (this.loaded.has(dir)) return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      const finish = (value: boolean): void => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        // Always drop our own entry, including after a timeout, so a directory
        // that never loads cannot leak an empty array for the tree's lifetime.
        const list = this.waiters.get(dir)
        if (list !== undefined) {
          const i = list.indexOf(finish)
          if (i >= 0) list.splice(i, 1)
          if (list.length === 0) this.waiters.delete(dir)
        }
        resolve(value)
      }
      const timer = window.setTimeout(() => { finish(false) }, timeoutMs)
      const list = this.waiters.get(dir) ?? []
      list.push(finish)
      this.waiters.set(dir, list)
    })
  }
}
