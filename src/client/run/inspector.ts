/**
 * V8 Inspector client (Scheme B: a focused debugger, not a DAP host).
 *
 * Node's inspector speaks the Chrome DevTools Protocol over a WebSocket. The
 * IDE page and the inspector both live on 127.0.0.1, and the inspector accepts
 * that Origin, so the whole protocol layer runs in the browser — no proxy, no
 * new host transport.
 *
 * Scope is deliberately "P3-lite": breakpoints, pause/resume, stepping, call
 * stacks and scope names. The variables tree (lazy object expansion) is out of
 * scope, because it is the part that needs a real async state machine.
 */

/** One request/response correlation. */
interface PendingCall {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

export interface InspectorFrame {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
  /** Stable id for stepIn/stepOver targeting. */
  callFrameId: string
  /** 'global' | 'local' | 'closure' | ... */
  scopeNames: string[]
}

export interface InspectorBreakpoint {
  /** The id the protocol assigned. */
  id: string
  /** 1-based line in the user-visible file. */
  line: number
  url: string
}

export interface InspectorPaused {
  reason: string
  frames: InspectorFrame[]
}

export type InspectorListener = {
  paused?: (event: InspectorPaused) => void
  resumed?: () => void
  /** Fired when the socket closes or the program ends. */
  closed?: (reason: string) => void
}

/** CDP reports 0-based lines; the editor is 1-based. */
export const toProtocolLine = (line1: number): number => Math.max(0, line1 - 1)
export const fromProtocolLine = (line0: number): number => line0 + 1

/**
 * Regex that matches a script URL by its PATH TAIL.
 *
 * Matching the full path is wrong: on macOS '/tmp' is a symlink to
 * '/private/tmp', so node reports 'file:///private/tmp/a.mjs' while the IDE
 * knows '/tmp/a.mjs'. Anchoring on the final two segments ('/tmp/a.mjs$')
 * resolves both, and still binds breakpoints set before the script parses.
 */
export function urlRegexFor(url: string): string {
  const bare = url.replace(/^file:\/\//, '').replace(/\\/g, '/')
  const segments = bare.split('/').filter((s) => s !== '')
  const tail = segments.slice(-2).join('/')
  return tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'
}

/** A connected inspector session. */
export class InspectorSession {
  private nextId = 1
  private pending = new Map<number, PendingCall>()
  private listeners: InspectorListener = {}
  private closedReason: string | undefined = undefined
  /** Breakpoint ids keyed by 'url#line'. */
  private breakpoints = new Map<string, string>()
  /** Every script URL node reported, in parse order. */
  private readonly scriptUrls = new Map<string, string>()

  private readonly ws: WebSocket

  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener('message', (ev) => { this.onMessage(ev.data) })
    ws.addEventListener('close', () => {
      this.closedReason = 'the debug target disconnected'
      this.failAll(new Error(this.closedReason))
      this.listeners.closed?.(this.closedReason)
    })
    ws.addEventListener('error', () => {
      if (this.closedReason !== undefined) return
      this.closedReason = 'the debug connection failed'
      this.failAll(new Error(this.closedReason))
      this.listeners.closed?.(this.closedReason)
    })
  }

  /** Connect to a ws:// URL, resolving once the socket is open. */
  static connect(wsUrl: string, timeoutMs = 8000): Promise<InspectorSession> {
    return new Promise((resolve, reject) => {
      let settled = false
      // The host reports the address node printed; when that never happened the
      // URL is empty, and constructing a WebSocket from it throws a bare
      // 'Invalid URL' that reads as if the socket were broken. Say what happened.
      if (typeof wsUrl !== 'string' || wsUrl === '') {
        reject(new Error('the debug target did not report an inspector address'))
        return
      }
      let ws: WebSocket
      try {
        ws = new WebSocket(wsUrl)
      } catch (err) {
        reject(new Error('cannot open the debug socket: ' + (err instanceof Error ? err.message : String(err))))
        return
      }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try { ws.close() } catch { /* already closing */ }
        reject(new Error('timed out connecting to the debug target'))
      }, timeoutMs)
      ws.addEventListener('open', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(new InspectorSession(ws))
      }, { once: true })
      ws.addEventListener('error', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error('could not connect to the debug target'))
      }, { once: true })
    })
  }

  on(listeners: InspectorListener): void {
    this.listeners = { ...this.listeners, ...listeners }
  }

  private onMessage(raw: unknown): void {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } }
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as typeof msg
    } catch {
      return
    }
    if (msg.id !== undefined) {
      const call = this.pending.get(msg.id)
      if (call === undefined) return
      this.pending.delete(msg.id)
      if (msg.error !== undefined) call.reject(new Error(msg.error.message ?? 'inspector error'))
      else call.resolve(msg.result)
      return
    }
    if (msg.method === 'Debugger.scriptParsed') {
      const url = (msg.params as { url?: string }).url
      if (typeof url === 'string' && url !== '') this.scriptUrls.set(url, url)
      return
    }
    if (msg.method === 'Debugger.paused') {
      const params = msg.params as { reason?: string; callFrames?: Array<{ functionName: string; url: string; location: { lineNumber: number; columnNumber: number }; callFrameId: string; scopeChain?: Array<{ type: string }> }> }
      this.listeners.paused?.({
        reason: params.reason ?? 'unknown',
        frames: (params.callFrames ?? []).map((f) => ({
          functionName: f.functionName === '' ? '(anonymous)' : f.functionName,
          url: f.url,
          lineNumber: fromProtocolLine(f.location.lineNumber),
          columnNumber: f.location.columnNumber + 1,
          callFrameId: f.callFrameId,
          scopeNames: (f.scopeChain ?? []).map((s) => s.type),
        })),
      })
    } else if (msg.method === 'Debugger.resumed') {
      this.listeners.resumed?.()
    }
  }

  private failAll(error: Error): void {
    for (const [, call] of this.pending) call.reject(error)
    this.pending.clear()
  }

  /** Send one CDP request. */
  call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closedReason !== undefined) return Promise.reject(new Error(this.closedReason))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch (err) {
        this.pending.delete(id)
        reject(new Error('cannot write to the debug socket: ' + (err instanceof Error ? err.message : String(err))))
      }
    })
  }

  /** Enable the domains this debugger uses. */
  async start(): Promise<void> {
    await this.call('Debugger.enable')
    await this.call('Runtime.enable')
    // Keep the target alive while paused so the UI can settle.
    try { await this.call('Debugger.setPauseOnExceptions', { state: 'none' }) } catch { /* optional */ }
  }

  /**
   * Release a `--inspect-brk` target.
   *
   * A break-on-start process does NOT report 'Debugger.paused' to a client that
   * attaches afterwards: it sits in "waiting for debugger" and only starts once
   * `Runtime.runIfWaitingForDebugger` is sent. Calling resume() first fails with
   * "Can only perform operation while paused", and breakpoints silently never
   * fire because the script is never parsed.
   */
  async releaseForStart(): Promise<void> {
    try { await this.call('Runtime.runIfWaitingForDebugger') } catch { /* not waiting */ }
  }

  /**
   * Set a breakpoint by URL and line. Returns the protocol breakpoint id, or
   * null when the URL has no loaded script yet — V8 then parks the breakpoint
   * and applies it when the script parses, which is exactly what we want.
   */
  async setBreakpoint(url: string, line1: number): Promise<string | null> {
    const key = url + '#' + String(line1)
    const existing = this.breakpoints.get(key)
    if (existing !== undefined) return existing
    // Match on the URL node ACTUALLY reported for the script, not the path the
    // IDE guesses: on macOS '/tmp' is a symlink and node reports
    // 'file:///private/tmp/...', so an exact-URL breakpoint would never bind.
    const resolved = this.resolveScriptUrl(url)
    const result = await this.call<{ breakpointId: string }>('Debugger.setBreakpointByUrl', {
      ...(resolved !== null ? { url: resolved } : { urlRegex: urlRegexFor(url) }),
      lineNumber: toProtocolLine(line1),
    })
    this.breakpoints.set(key, result.breakpointId)
    return result.breakpointId
  }

  /** The exact URL node reported for `url`, when the script is already parsed.
   *  Otherwise null and the caller falls back to a path-tail regex. */
  private resolveScriptUrl(url: string): string | null {
    return this.scriptUrls.get(url) ?? null
  }

  async removeBreakpoint(url: string, line1: number): Promise<void> {
    const key = url + '#' + String(line1)
    const id = this.breakpoints.get(key)
    if (id === undefined) return
    this.breakpoints.delete(key)
    try { await this.call('Debugger.removeBreakpoint', { breakpointId: id }) } catch { /* already gone */ }
  }

  async resume(): Promise<void> { await this.call('Debugger.resume') }
  async pause(): Promise<void> { await this.call('Debugger.pause') }
  async stepOver(): Promise<void> { await this.call('Debugger.stepOver') }
  async stepInto(): Promise<void> { await this.call('Debugger.stepInto') }
  async stepOut(): Promise<void> { await this.call('Debugger.stepOut') }

  /** Evaluate an expression in a paused frame (the debug console's one verb).
   *
   *  A thrown expression does NOT set `exceptionDetails` here — CDP returns the
   *  Error object itself as `result` with subtype 'error'. Reading only
   *  `exceptionDetails` reported every ReferenceError as a bare "Uncaught". */
  async evaluate(expression: string, frame?: InspectorFrame): Promise<string> {
    // Evaluating in a paused frame requires Debugger.evaluateOnCallFrame:
    // Runtime.evaluate ignores callFrameId and runs in the global scope, where
    // the function's locals do not exist.
    const result = await this.call<{
      result: { value?: unknown; description?: string; type: string; subtype?: string; className?: string }
      exceptionDetails?: { text?: string; exception?: { description?: string } }
    }>(
      frame === undefined ? 'Runtime.evaluate' : 'Debugger.evaluateOnCallFrame',
      frame === undefined
        ? { expression, returnByValue: false, generatePreview: true }
        : { expression, callFrameId: frame.callFrameId, returnByValue: false, generatePreview: true },
    )
    if (result.exceptionDetails !== undefined) {
      const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'error'
      return 'Uncaught ' + text.split('\n')[0]
    }
    const r = result.result
    if (r.subtype === 'error') {
      // Keep the first line of the stack; the rest is noise in a console line.
      const line = (r.description ?? ('Error: ' + (r.className ?? 'unknown'))).split('\n')[0]
      return 'Uncaught ' + line
    }
    if (r.value !== undefined) return typeof r.value === 'string' ? r.value : String(r.value)
    return r.description ?? ('<' + r.type + '>')
  }

  get isClosed(): boolean { return this.closedReason !== undefined }

  close(): void {
    if (this.closedReason === undefined) this.closedReason = 'the debug session was closed'
    this.failAll(new Error(this.closedReason))
    try { this.ws.close() } catch { /* already closed */ }
  }
}
