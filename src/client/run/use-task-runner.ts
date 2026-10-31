/**
 * The task runner: starts a command in a terminal, watches its output and
 * publishes the lifecycle to runDebug (P0-2 exit-code echo, P1-7 problem
 * extraction).
 *
 * It subscribes to `terminalOutput` itself rather than piggy-backing on the
 * terminal panel: the host broadcasts frames to every subscriber, and a task
 * must still be tracked while the bottom panel is closed or showing Problems.
 */
import { useCallback, useEffect, useRef } from 'react'
import { notifications } from '../notifications.js'
import type { IdeToolsRemote, SessionId } from '../types.js'
import { runDebug } from './run-debug-store.js'
import { parseProblems, classifyExit } from './task-output.js'
import type { TaskProblem } from './task-output.js'
import type { RunTask } from './run-config.js'

type T = (key: string, params?: Record<string, string | number>) => string

/** Cap on retained output used for problem parsing (the terminal keeps more). */
const MAX_ANALYSIS_CHARS = 400_000

export interface TaskRunnerOptions {
  sessionId: SessionId
  ideTools: Pick<IdeToolsRemote, 'terminalOpen' | 'terminalWrite' | 'terminalOutput'>
  /** Called with the new terminal id so the panel can adopt the tab. */
  onTerminalOpened: (id: string) => void
  /** Reveal the bottom terminal tab. */
  onRevealTerminal: () => void
  t: T
}

export interface TaskRunner {
  /** Run a task: opens a terminal, writes the command, tracks the result. */
  run: (task: RunTask) => void
}

export function useTaskRunner(options: TaskRunnerOptions): TaskRunner {
  const { sessionId, ideTools, onTerminalOpened, onRevealTerminal, t } = options
  // Live abort controllers per run, so unmount stops every stream.
  const controllers = useRef(new Set<AbortController>())

  useEffect(() => () => {
    for (const ctrl of controllers.current) ctrl.abort()
    controllers.current.clear()
  }, [])

  const run = useCallback((task: RunTask) => {
    const ctrl = new AbortController()
    controllers.current.add(ctrl)
    const startedAt = Date.now()

    void ideTools.terminalOpen(sessionId, {
      cols: 120,
      rows: 30,
      // The command is typed into the shell prompt rather than used as the
      // shell argv, so the user keeps an interactive prompt afterwards — the
      // same behaviour as a VS Code task terminal.
      cwd: task.cwd === undefined || task.cwd === '' ? undefined : task.cwd,
    }).then(async (res) => {
      if (!res.ok) {
        controllers.current.delete(ctrl)
        notifications.error(res.error.message ?? res.error.code)
        return
      }
      const terminalId = res.value.terminalId
      onTerminalOpened(terminalId)
      onRevealTerminal()

      const runId = task.id + ':' + String(startedAt)
      runDebug.startRun({ id: runId, label: task.label, terminalId, startedAt, state: { status: 'running' } })

      // Write after the shell is ready to accept input.
      await sleep(400)
      if (ctrl.signal.aborted) return
      void ideTools.terminalWrite(sessionId, terminalId, task.command + '\r')

      let text = ''
      try {
        for await (const frame of ideTools.terminalOutput(sessionId, terminalId, ctrl.signal)) {
          if (frame.data.length > 0) {
            text += Buffer.from(frame.data, 'base64').toString('utf8')
            if (text.length > MAX_ANALYSIS_CHARS) text = text.slice(-MAX_ANALYSIS_CHARS)
            const found = parseProblems(text)
            if (found.length > 0) runDebug.setRunProblems(found)
          }
          if (frame.exit) {
            const state = ctrl.signal.aborted
              ? { status: 'cancelled' as const }
              : classifyExit(frame.exitCode, text, Date.now() - startedAt)
            runDebug.finishRun(runId, state)
            if (state.status === 'failed') {
              const problems = parseProblems(text)
              notifications.error(t('task.failed', {
                label: task.label,
                code: state.exitCode === null ? '?' : String(state.exitCode),
                count: problems.length,
              }))
            }
            return
          }
        }
      } catch (err) {
        // A transport error ends the run; it must not leave 'running' forever.
        if (!ctrl.signal.aborted) {
          runDebug.finishRun(runId, { status: 'failed', exitCode: null, durationMs: Date.now() - startedAt })
          notifications.error(err instanceof Error ? err.message : String(err))
        }
      } finally {
        controllers.current.delete(ctrl)
      }
    }).catch((err: unknown) => {
      controllers.current.delete(ctrl)
      notifications.error(err instanceof Error ? err.message : String(err))
    })
  }, [sessionId, ideTools, onTerminalOpened, onRevealTerminal, t])

  return { run }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** The problem shape the panel renders — a superset of a run diagnostic,
 *  because Monaco markers also carry 'info'. */
export interface MergedProblem {
  path: string
  line: number
  column: number
  severity: 'error' | 'warning' | 'info'
  message: string
}

/** Merge compiler problems (from a run) with Monaco markers for the panel.
 *  Run diagnostics come first: a fresh build is the more actionable signal. */
export function mergeProblems(
  runProblems: readonly MergedProblem[],
  markerProblems: readonly MergedProblem[],
): MergedProblem[] {
  const out: MergedProblem[] = []
  const seen = new Set<string>()
  for (const p of [...runProblems, ...markerProblems]) {
    const key = p.path + ':' + String(p.line) + ':' + p.message
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}
