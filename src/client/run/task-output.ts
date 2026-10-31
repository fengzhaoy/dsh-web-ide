/**
 * Task output analysis: turn the raw terminal stream of a run into
 *   - a lifecycle state (running / succeeded / failed), and
 *   - clickable problems parsed from compiler / test-runner output.
 *
 * Pure logic, unit-tested without a browser.
 */

/** Lifecycle of one task run. */
export type TaskState =
  | { status: 'running' }
  | { status: 'succeeded'; durationMs: number }
  | { status: 'failed'; exitCode: number | null; durationMs: number }
  | { status: 'cancelled' }

export interface TaskProblem {
  /** File the diagnostic points at, as printed by the tool. */
  path: string
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
}

/** Strip ANSI escape sequences so the parsers see plain text. */
export function stripAnsi(text: string): string {
  // CSI sequences (`\u001b[...m`), OSC (`\u001b]...`), and single-char escapes.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*(\u0007|$)/g, '')
}

/**
 * Diagnostic shapes across the toolchains this IDE runs:
 *   tsc / go / rustc : `src/a.ts(12,5): error TS2322: message`
 *   tsc (pretty)     : `src/a.ts:12:5 - error TS2322: message`
 *   python / ruff    : `src/a.py:12:5: error message`
 *   gcc / clang      : `src/a.c:12:5: error: message`
 *   go plain         : `./src/a.go:12:5: undefined: x`
 */
const DIAGNOSTIC_PATTERNS: Array<{ re: RegExp; file: number; line: number; col: number; sev: number; msg: number }> = [
  // src/a.ts(12,5): error TS2322: msg
  { re: /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*(?:[A-Z]+\d+)?:?\s*(.*)$/, file: 1, line: 2, col: 3, sev: 4, msg: 5 },
  // src/a.ts:12:5 - error TS2322: msg
  { re: /^(.+?):(\d+):(\d+)\s*-\s*(error|warning)\s*(?:[A-Z]+\d+)?:?\s*(.*)$/, file: 1, line: 2, col: 3, sev: 4, msg: 5 },
  // src/a.py:12:5: error msg   |   src/a.c:12:5: error: msg
  { re: /^(.+?):(\d+):(\d+):?\s*(error|warning):?\s+(.*)$/i, file: 1, line: 2, col: 3, sev: 4, msg: 5 },
  // src/a.go:12: msg
  { re: /^(.+?\.\w+):(\d+):\s*(.*)$/, file: 1, line: 2, col: 0, sev: 0, msg: 3 },
]

/** Parse clickable problems out of one chunk of tool output. */
export function parseProblems(output: string): TaskProblem[] {
  const out: TaskProblem[] = []
  for (const raw of stripAnsi(output).split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.trim() === '') continue
    for (const pat of DIAGNOSTIC_PATTERNS) {
      const m = pat.re.exec(line)
      if (m === null) continue
      const file = m[pat.file].trim()
      // A bare 'file:12: msg' is only a diagnostic when the message looks like
      // one; otherwise every 'http://x:80: y' line would become a problem.
      if (pat.sev === 0 && !/\b(undefined|cannot|unexpected|expected|invalid|no such|not found)\b/i.test(m[pat.msg])) continue
      const severity = pat.sev === 0 ? 'error' : (m[pat.sev] === 'warning' ? 'warning' : 'error')
      out.push({
        path: file,
        line: Number(m[pat.line]) || 1,
        column: pat.col > 0 ? Number(m[pat.col]) || 1 : 1,
        severity,
        message: m[pat.msg].trim(),
      })
      break
    }
  }
  return out
}

/** Did this output chunk contain an obvious failure marker? Used to label a
 *  run that ended with an unknown exit code. */
export function looksLikeFailure(output: string): boolean {
  const text = stripAnsi(output)
  return /(^|\n)\s*(error|Error|ERROR)\b/.test(text) || /\b(FAILED|failed with|Traceback \(most recent call last\))/.test(text)
}

/** Translates a dictionary key, optionally interpolating parameters. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/**
 * Localized label for a run's lifecycle, e.g. '1.2s 完成' / 'Succeeded in 1.2s'.
 *
 * The text lives in locales.ts under `run.state.*` (the package is bilingual —
 * README「中/英双语界面」), so this function takes the translator instead of
 * returning English. Returning a ready-made English string here was a visible
 * regression: the panel showed English inside a Chinese UI.
 */
export function describeState(state: TaskState, t: Translate): string {
  switch (state.status) {
    case 'running': return t('run.state.running')
    case 'succeeded': return t('run.state.succeeded', { duration: formatDuration(state.durationMs) })
    case 'failed': return state.exitCode === null
      ? t('run.state.failedNoCode', { duration: formatDuration(state.durationMs) })
      : t('run.state.failed', { code: state.exitCode, duration: formatDuration(state.durationMs) })
    case 'cancelled': return t('run.state.cancelled')
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return String(Math.max(0, Math.round(ms))) + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(1).replace(/\.0$/, '') + 's'
  const min = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return String(min) + 'm' + String(sec) + 's'
}

/**
 * Classify a finished run from the final frame. `exitCode` is null when the
 * host did not report one (a killed shell), in which case the output text is
 * the only signal available.
 */
export function classifyExit(exitCode: number | null | undefined, output: string, durationMs: number): TaskState {
  if (exitCode === null || exitCode === undefined) {
    return looksLikeFailure(output) ? { status: 'failed', exitCode: null, durationMs } : { status: 'succeeded', durationMs }
  }
  if (exitCode === 0) return { status: 'succeeded', durationMs }
  return { status: 'failed', exitCode, durationMs }
}
