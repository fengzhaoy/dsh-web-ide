/**
 * Run and Debug sidebar (VS Code parity, P2-8).
 *
 * Deliberately NOT a DAP client — it lists discovered runnable tasks, the runs
 * started this session with their exit status, and the breakpoints the user has
 * set. A click launches through the same task runner the rest of the IDE uses.
 */
import { useMemo } from 'react'
import { Icons } from '../icons.js'
import { runDebug, useRunDebug } from './run-debug-store.js'
import { describeState } from './task-output.js'
import { DebugPanel } from './DebugPanel.js'
import type { DebugController, DebugState } from './use-debugger.js'
import type { RunTask } from './run-config.js'

type T = (key: string, params?: Record<string, string | number>) => string

export interface RunViewProps {
  /** Every task discovered from the workspace manifests. */
  tasks: readonly RunTask[]
  /** True while the manifest scan is in flight. */
  loading: boolean
  /** Recently run tasks for this workspace, newest first (P0-3). */
  recents: readonly RunTask[]
  /** Start one task. */
  onRun: (task: RunTask) => void
  /** Open a breakpoint's file at its line. */
  onOpenBreakpoint: (path: string, line: number) => void
  /** Scheme B debugger (control bar, call stack, console). */
  debug: DebugController
  debugState: DebugState
  debuggable: boolean
  onStartDebug: () => void
  t: T
}

export function RunView({ tasks, loading, recents, onRun, onOpenBreakpoint, debug, debugState, debuggable, onStartDebug, t }: RunViewProps) {
  const state = useRunDebug()
  const breakpoints = useMemo(
    () => Object.values(state.breakpoints).sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path))),
    [state.breakpoints],
  )

  return (
    <div className="ide-runview" data-testid="ide-runview">
      <DebugPanel
        debug={debug}
        state={debugState}
        debuggable={debuggable}
        onStart={onStartDebug}
        onOpenFrame={onOpenBreakpoint}
        t={t}
      />
      <div className="ide-runview-section">
        <div className="ide-runview-header">
          <span>{t('run.sectionTasks')}</span>
          {loading && <span className="ide-runview-badge">…</span>}
        </div>
        {tasks.length === 0 && !loading && (
          <div className="ide-runview-empty" data-testid="ide-runview-empty-tasks">{t('run.noTasks')}</div>
        )}
        {tasks.map((task) => (
          <div
            key={task.id}
            className="ide-runview-task"
            data-testid="ide-runview-task"
            title={task.command}
            onClick={() => onRun(task)}
          >
            <span className="ide-runview-task-icon">{Icons.debug}</span>
            <span className="ide-runview-task-label">{task.label}</span>
            <span className="ide-runview-task-source">{task.source}</span>
          </div>
        ))}
      </div>

      {recents.length > 0 && (
        <div className="ide-runview-section">
          <div className="ide-runview-header"><span>{t('run.sectionRecent')}</span></div>
          {recents.map((task) => (
            <div
              key={'recent:' + task.id}
              className="ide-runview-task"
              data-testid="ide-runview-recent"
              title={task.command}
              onClick={() => onRun(task)}
            >
              <span className="ide-runview-task-icon">{Icons.debug}</span>
              <span className="ide-runview-task-label">{task.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ide-runview-section">
        <div className="ide-runview-header">
          <span>{t('run.sectionRuns')}</span>
          {state.runs.length > 0 && (
            <button className="ide-runview-clear" onClick={() => runDebug.clearRuns()} data-testid="ide-runview-clear">{t('run.clear')}</button>
          )}
        </div>
        {state.runs.length === 0 && (
          <div className="ide-runview-empty" data-testid="ide-runview-empty-runs">{t('run.noRuns')}</div>
        )}
        {state.runs.map((record) => (
          <div key={record.id} className="ide-runview-run" data-testid="ide-runview-run" data-status={record.state.status}>
            <span className={'ide-runview-status ide-runview-status-' + record.state.status}>
              {record.state.status === 'running' ? Icons.loading
                : record.state.status === 'succeeded' ? Icons.check
                : record.state.status === 'failed' ? Icons.close
                : Icons.discard}
            </span>
            <span className="ide-runview-run-label">{record.label}</span>
            <span className="ide-runview-run-state">{describeState(record.state, t)}</span>
          </div>
        ))}
      </div>

      <div className="ide-runview-section">
        <div className="ide-runview-header">
          <span>{t('run.sectionBreakpoints')}</span>
          {breakpoints.length > 0 && (
            <button className="ide-runview-clear" onClick={() => runDebug.setBreakpoints([])} data-testid="ide-runview-clear-breakpoints">{t('run.clear')}</button>
          )}
        </div>
        {breakpoints.length === 0 && (
          <div className="ide-runview-empty" data-testid="ide-runview-empty-breakpoints">{t('run.noBreakpoints')}</div>
        )}
        {breakpoints.map((b) => (
          <div
            key={b.path + ':' + String(b.line)}
            className="ide-runview-breakpoint"
            data-testid="ide-runview-breakpoint"
            onClick={() => onOpenBreakpoint(b.path, b.line)}
            title={b.path + ':' + String(b.line)}
          >
            <span className="ide-runview-breakpoint-dot" aria-hidden="true" />
            <span className="ide-runview-breakpoint-name">{b.path.split('/').pop()}</span>
            <span className="ide-runview-breakpoint-line">{b.line}</span>
            <button
              className="ide-runview-breakpoint-remove"
              title={t('run.removeBreakpoint')}
              onClick={(e) => { e.stopPropagation(); runDebug.removeBreakpoint(b.path, b.line) }}
            >{Icons.close}</button>
          </div>
        ))}
      </div>
    </div>
  )
}
