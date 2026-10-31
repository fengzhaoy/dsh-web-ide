/**
 * Debug session state (Scheme A + B).
 *
 * Scheme A is intentionally tiny: `inspectHint()` returns the instruction the
 * UI shows so the user can attach Chrome DevTools to a --inspect-brk run.
 * Scheme B drives V8 directly through InspectorSession.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { notifications } from '../notifications.js'
import type { IdeToolsRemote, SessionId } from '../types.js'
import { InspectorSession, type InspectorFrame, type InspectorPaused } from './inspector.js'
import { inspectHint } from './inspect-hint.js'
export { inspectHint }
import { runDebug } from './run-debug-store.js'
import { scriptUrlFor, workspaceRelativePath } from './run-config.js'

type T = (key: string, params?: Record<string, string | number>) => string

export type DebugStatus =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'paused'; reason: string }

export interface DebugState {
  status: DebugStatus
  frames: readonly InspectorFrame[]
  /** The WebSocket URL of the live target (for "open in DevTools"). */
  wsUrl: string | undefined
  /** Console lines produced by the debugger itself. */
  console: readonly string[]
}

const INITIAL: DebugState = { status: { kind: 'idle' }, frames: [], wsUrl: undefined, console: [] }


export interface DebugController {
  state: DebugState
  /** Start debugging a file (Scheme B). */
  start: (path: string, opts?: { breakOnStart?: boolean }) => Promise<void>
  stop: () => Promise<void>
  resume: () => Promise<void>
  pause: () => Promise<void>
  stepOver: () => Promise<void>
  stepInto: () => Promise<void>
  stepOut: () => Promise<void>
  /** Evaluate in the selected frame and append the result to the console. */
  evaluate: (expression: string) => Promise<void>
}

export function useDebugger(options: {
  sessionId: SessionId
  ideTools: Pick<IdeToolsRemote, 'debugOpen' | 'debugTerminate'>
  /** Absolute workspace root: IDE paths are absolute, the host wants
   *  workspace-relative ones (see run-config's path-unit helpers). */
  cwd: string | undefined
  t: T
}): DebugController {
  const { sessionId, ideTools, cwd } = options
  const [state, setState] = useState<DebugState>(INITIAL)
  const sessionRef = useRef<InspectorSession | null>(null)
  const targetRef = useRef<string | null>(null)
  /** The frame the console evaluates in (top of the stack by default). */
  const frameRef = useRef<InspectorFrame | undefined>(undefined)

  const appendConsole = useCallback((line: string) => {
    setState((prev) => ({ ...prev, console: [...prev.console, line].slice(-500) }))
  }, [])

  const teardown = useCallback(async () => {
    sessionRef.current?.close()
    sessionRef.current = null
    const target = targetRef.current
    targetRef.current = null
    if (target !== null) {
      try { await ideTools.debugTerminate(sessionId, target) } catch { /* already gone */ }
    }
    setState(INITIAL)
  }, [sessionId, ideTools])

  // Never leave a debuggee running after the view unmounts.
  useEffect(() => () => {
    sessionRef.current?.close()
    const target = targetRef.current
    if (target !== null) void ideTools.debugTerminate(sessionId, target).catch(() => undefined)
  }, [sessionId, ideTools])

  const start = useCallback(async (path: string, opts?: { breakOnStart?: boolean }) => {
    await teardown()
    // The IDE hands us an absolute path; the host resolves workspace-relative
    // paths only and would refuse this one as escaping the workspace.
    const hostPath = workspaceRelativePath(path, cwd)
    // '' means the path IS the workspace root — a directory, never a script.
    // A path that stayed absolute is outside the root; the host's own fence
    // rejects that one, so it needs no guard here.
    if (hostPath === '') { notifications.error('the debug target is outside the workspace'); return }
    setState({ ...INITIAL, status: { kind: 'starting' }, console: ['Debugging ' + path] })
    let wsUrl: string
    let targetId: string
    try {
      const res = await ideTools.debugOpen(sessionId, { path: hostPath, breakOnStart: opts?.breakOnStart ?? true })
      if (!res.ok) {
        setState(INITIAL)
        notifications.error(res.error.message ?? res.error.code)
        return
      }
      wsUrl = res.value.wsUrl
      targetId = res.value.targetId
      targetRef.current = targetId
    } catch (err) {
      setState(INITIAL)
      notifications.error(err instanceof Error ? err.message : String(err))
      return
    }
    try {
      const session = await InspectorSession.connect(wsUrl)
      sessionRef.current = session
      session.on({
        paused: (event: InspectorPaused) => {
          frameRef.current = event.frames[0]
          setState((prev) => ({ ...prev, status: { kind: 'paused', reason: event.reason }, frames: event.frames }))
          // P2-9 parity: keep the IDE's breakpoint marks in sync with the target.
          void syncBreakpoints(session, path, runDebug.breakpointsFor(path), cwd)
        },
        resumed: () => {
          frameRef.current = undefined
          setState((prev) => ({ ...prev, status: { kind: 'running' }, frames: [] }))
        },
        closed: (reason) => {
          setState((prev) => ({ ...prev, status: { kind: 'idle' }, frames: [] }))
          appendConsole('[debug] ' + reason)
          void ideTools.debugTerminate(sessionId, targetId).catch(() => undefined)
          targetRef.current = null
          sessionRef.current = null
        },
      })
      await session.start()
      // Breakpoints MUST be registered before the target is released: a
      // --inspect-brk process has not parsed the user's script yet, so a
      // breakpoint set afterwards would miss the first lines entirely.
      for (const bp of runDebug.breakpointsFor(path)) {
        await session.setBreakpoint(scriptUrlFor(path, cwd), bp.line).catch(() => undefined)
      }
      // Release the "waiting for debugger" pause; without this the process
      // never starts and no breakpoint can ever be hit.
      await session.releaseForStart()
      setState((prev) => ({ ...prev, wsUrl, status: { kind: 'running' } }))
    } catch (err) {
      notifications.error(err instanceof Error ? err.message : String(err))
      await teardown()
    }
  }, [sessionId, ideTools, cwd, teardown, appendConsole])

  const withSession = useCallback(async (fn: (s: InspectorSession) => Promise<void>) => {
    const session = sessionRef.current
    if (session === null) return
    try { await fn(session) } catch (err) {
      appendConsole('[debug] ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [appendConsole])

  return {
    state,
    start,
    stop: teardown,
    resume: () => withSession((s) => s.resume()),
    pause: () => withSession((s) => s.pause()),
    stepOver: () => withSession((s) => s.stepOver()),
    stepInto: () => withSession((s) => s.stepInto()),
    stepOut: () => withSession((s) => s.stepOut()),
    evaluate: async (expression: string) => {
      const session = sessionRef.current
      if (session === null) return
      appendConsole('> ' + expression)
      try {
        appendConsole(await session.evaluate(expression, frameRef.current))
      } catch (err) {
        appendConsole('[debug] ' + (err instanceof Error ? err.message : String(err)))
      }
    },
  }
}

/** Breakpoints are addressed by file:// URL in CDP (see run-config). */
async function syncBreakpoints(
  session: InspectorSession,
  activePath: string,
  bps: readonly { path: string; line: number }[],
  cwd: string | undefined,
): Promise<void> {
  for (const bp of bps) await session.setBreakpoint(scriptUrlFor(bp.path || activePath, cwd), bp.line).catch(() => undefined)
}
