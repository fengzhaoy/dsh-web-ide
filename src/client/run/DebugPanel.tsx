/**
 * Debugger UI (Scheme B): the control bar, the call stack and the debug
 * console. Rendered inside the Run and Debug sidebar below the task lists.
 */
import { useState } from 'react'
import { Icons } from '../icons.js'
import type { DebugController, DebugState } from './use-debugger.js'
import { inspectHint } from './use-debugger.js'

type T = (key: string, params?: Record<string, string | number>) => string

export interface DebugPanelProps {
  debug: DebugController
  state: DebugState
  /** True when the active file can be debugged (JS/TS). */
  debuggable: boolean
  /** Debug the active file (Scheme B). */
  onStart: () => void
  /** Jump the editor to a stack frame. */
  onOpenFrame: (path: string, line: number) => void
  t: T
}

export function DebugPanel({ debug, state, debuggable, onStart, onOpenFrame, t }: DebugPanelProps) {
  const [expression, setExpression] = useState('')
  const { status } = state
  const paused = status.kind === 'paused'
  const active = status.kind !== 'idle'

  return (
    <div className="ide-debug" data-testid="ide-debug">
      <div className="ide-debug-toolbar">
        {!active ? (
          <button
            className="ide-debug-action"
            disabled={!debuggable}
            title={debuggable ? t('debug.start') : t('debug.notDebuggable')}
            onClick={onStart}
            data-testid="ide-debug-start"
          >{Icons.debug}</button>
        ) : (
          <>
            <button className="ide-debug-action" title={t('debug.resume')} disabled={!paused} onClick={() => { void debug.resume() }} data-testid="ide-debug-resume">{Icons.chevronRight}</button>
            <button className="ide-debug-action" title={t('debug.pause')} disabled={paused} onClick={() => { void debug.pause() }} data-testid="ide-debug-pause">{Icons.dash}</button>
            <button className="ide-debug-action" title={t('debug.stepOver')} disabled={!paused} onClick={() => { void debug.stepOver() }} data-testid="ide-debug-step-over">{Icons.arrowDown}</button>
            <button className="ide-debug-action" title={t('debug.stepInto')} disabled={!paused} onClick={() => { void debug.stepInto() }} data-testid="ide-debug-step-into">{Icons.arrowUp}</button>
            <button className="ide-debug-action" title={t('debug.stepOut')} disabled={!paused} onClick={() => { void debug.stepOut() }} data-testid="ide-debug-step-out">{Icons.chevronUp}</button>
            <button className="ide-debug-action" title={t('debug.stop')} onClick={() => { void debug.stop() }} data-testid="ide-debug-stop">{Icons.close}</button>
          </>
        )}
        <span className="ide-debug-status" data-status={status.kind} data-testid="ide-debug-status">
          {status.kind === 'idle' ? t('debug.idle')
            : status.kind === 'starting' ? t('debug.starting')
            : status.kind === 'running' ? t('debug.running')
            : t('debug.pausedAt', { reason: status.reason })}
        </span>
      </div>

      {/* Scheme A: the same WS URL works from Chrome DevTools. */}
      {state.wsUrl !== undefined && (
        <div className="ide-debug-hint" title={inspectHint(state.wsUrl)} data-testid="ide-debug-hint">
          {t('debug.openInDevTools')}: <code>{state.wsUrl}</code>
        </div>
      )}

      {state.frames.length > 0 && (
        <div className="ide-debug-section" data-testid="ide-debug-callstack">
          <div className="ide-runview-header"><span>{t('debug.callStack')}</span></div>
          {state.frames.map((frame, i) => (
            <div
              key={frame.callFrameId}
              className="ide-debug-frame"
              data-active={i === 0 || undefined}
              data-testid="ide-debug-frame"
              title={frame.url}
              onClick={() => {
                // CDP frame URLs are file:// — the IDE wants a workspace path.
                const path = frame.url.startsWith('file://') ? decodeURIComponent(frame.url.slice(7)) : frame.url
                onOpenFrame(path, frame.lineNumber)
              }}
            >
              <span className="ide-debug-frame-fn">{frame.functionName}</span>
              <span className="ide-debug-frame-loc">
                {frame.url.split('/').pop()}:{frame.lineNumber}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="ide-debug-section">
        <div className="ide-runview-header"><span>{t('debug.console')}</span></div>
        <div className="ide-debug-console" data-testid="ide-debug-console">
          {state.console.length === 0 && <div className="ide-runview-empty">{t('debug.consoleEmpty')}</div>}
          {state.console.map((line, i) => (
            <div key={i} className="ide-debug-console-line" data-kind={line.startsWith('>') ? 'input' : line.startsWith('[debug]') ? 'system' : 'output'}>{line}</div>
          ))}
        </div>
        <form
          className="ide-debug-input-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (expression.trim() === '') return
            void debug.evaluate(expression)
            setExpression('')
          }}
        >
          <input
            className="ide-debug-input"
            value={expression}
            placeholder={paused ? t('debug.evaluatePlaceholder') : t('debug.evaluateDisabled')}
            disabled={!paused}
            onChange={(e) => setExpression(e.target.value)}
            data-testid="ide-debug-input"
          />
        </form>
      </div>
    </div>
  )
}
