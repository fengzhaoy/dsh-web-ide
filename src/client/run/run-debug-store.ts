/**
 * Run/debug client state: task lifecycle, workspace problems and breakpoints.
 *
 * Window-parked like settingsStore so a client hot-reload keeps live state.
 * Breakpoints persist to localStorage; run state does not (a reload has no
 * running process to resume).
 */
import { useEffect, useState } from 'react'
import type { TaskState, TaskProblem } from './task-output.js'

/** One task the user started. */
export interface RunRecord {
  id: string
  label: string
  /** Terminal the command was written to. */
  terminalId: string
  startedAt: number
  state: TaskState
}

/** A breakpoint marker: workspace-relative path + 1-based line. */
export interface Breakpoint {
  path: string
  line: number
}

const STORAGE_KEY = 'dsh-ide.run-debug'

interface RunDebugWindow { __dshIdeRunDebug?: RunDebugStore }
const win = window as unknown as RunDebugWindow

type Listener = () => void

export interface RunDebugSnapshot {
  /** Newest run first. */
  runs: readonly RunRecord[]
  /** Problems parsed from the most recent run's output. */
  runProblems: readonly TaskProblem[]
  /** Breakpoints by 'path:line'. */
  breakpoints: Readonly<Record<string, Breakpoint>>
  /** The run currently streaming output, if any. */
  activeRunId: string | undefined
}

class RunDebugStore {
  private listeners = new Set<Listener>()
  private runs: RunRecord[] = []
  private runProblems: TaskProblem[] = []
  private breakpoints: Record<string, Breakpoint> = loadBreakpoints()
  private activeRunId: string | undefined = undefined
  private snapshot: RunDebugSnapshot = {
    runs: [],
    runProblems: [],
    breakpoints: this.breakpoints,
    activeRunId: undefined,
  }

  getSnapshot = (): RunDebugSnapshot => this.snapshot

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit(): void {
    this.snapshot = {
      runs: this.runs,
      runProblems: this.runProblems,
      breakpoints: this.breakpoints,
      activeRunId: this.activeRunId,
    }
    for (const fn of this.listeners) fn()
  }

  startRun(record: RunRecord): void {
    this.runs = [record, ...this.runs].slice(0, 20)
    this.runProblems = []
    this.activeRunId = record.id
    this.emit()
  }

  finishRun(id: string, state: TaskState): void {
    this.runs = this.runs.map((r) => (r.id === id ? { ...r, state } : r))
    if (this.activeRunId === id) this.activeRunId = undefined
    this.emit()
  }

  setRunProblems(problems: readonly TaskProblem[]): void {
    // Keep a stable object when nothing changed so React can bail out.
    const next = problems.slice(0, 500)
    const sameLength = next.length === this.runProblems.length
    if (sameLength && next.every((p, i) => {
      const b = this.runProblems[i]
      return b !== undefined && b.path === p.path && b.line === p.line && p.message === b.message
    })) return
    this.runProblems = next
    this.emit()
  }

  /** Drop the finished runs (the panel's "clear" action). */
  clearRuns(): void {
    this.runs = []
    this.runProblems = []
    this.activeRunId = undefined
    this.emit()
  }

  toggleBreakpoint(path: string, line: number): void {
    const key = path + ':' + String(line)
    const next = { ...this.breakpoints }
    if (next[key] !== undefined) delete next[key]
    else next[key] = { path, line }
    this.breakpoints = next
    this.persist()
    this.emit()
  }

  removeBreakpoint(path: string, line: number): void {
    const key = path + ':' + String(line)
    if (this.breakpoints[key] === undefined) return
    const next = { ...this.breakpoints }
    delete next[key]
    this.breakpoints = next
    this.persist()
    this.emit()
  }

  /** Breakpoints of one file, ascending by line. */
  breakpointsFor(path: string): Breakpoint[] {
    return Object.values(this.breakpoints).filter((b) => b.path === path).sort((a, b) => a.line - b.line)
  }

  setBreakpoints(bps: readonly Breakpoint[]): void {
    const next: Record<string, Breakpoint> = {}
    for (const b of bps) next[b.path + ':' + String(b.line)] = b
    this.breakpoints = next
    this.persist()
    this.emit()
  }

  /** Move every breakpoint of `from` to `to` (file rename). */
  moveBreakpoints(from: string, to: string): void {
    const moved = Object.values(this.breakpoints).filter((b) => b.path === from)
    if (moved.length === 0) return
    const next = { ...this.breakpoints }
    for (const b of moved) {
      delete next[b.path + ':' + String(b.line)]
      next[to + ':' + String(b.line)] = { path: to, line: b.line }
    }
    this.breakpoints = next
    this.persist()
    this.emit()
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.values(this.breakpoints)))
    } catch {
      // Storage denied: breakpoints stay in memory for this session only.
    }
  }
}

function loadBreakpoints(): Record<string, Breakpoint> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return {}
    const out: Record<string, Breakpoint> = {}
    for (const item of parsed) {
      const b = item as Partial<Breakpoint>
      if (typeof b.path === 'string' && typeof b.line === 'number' && b.line > 0) {
        out[b.path + ':' + String(b.line)] = { path: b.path, line: b.line }
      }
    }
    return out
  } catch {
    return {}
  }
}

export const runDebug: RunDebugStore = win.__dshIdeRunDebug ??= new RunDebugStore()

/** React-friendly hook: re-renders when run/debug state changes. */
export function useRunDebug(): RunDebugSnapshot {
  const [snapshot, setSnapshot] = useState(() => runDebug.getSnapshot())
  useEffect(() => runDebug.subscribe(() => { setSnapshot(runDebug.getSnapshot()) }), [])
  return snapshot
}
