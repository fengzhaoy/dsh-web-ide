/**
 * VS Code Server tab (Scheme C): a real code-server in an iframe.
 *
 * Monaco is never touched — this component only occupies the editor pane while
 * its tab is active. Closing the tab leaves the server running so reopening is
 * instant; "Stop Server" shuts it down.
 */
import type { IdeVscodeInfo } from './types.js'

type T = (key: string, params?: Record<string, string | number>) => string

export interface VscodeTabProps {
  info: IdeVscodeInfo | undefined
  error: string | null
  loading: boolean
  onRetry: () => void
  onStop: () => void
  t: T
}

export function VscodeTab({ info, error, loading, onRetry, onStop, t }: VscodeTabProps) {
  return (
    <div className="ide-vscode" data-testid="ide-vscode">
      <div className="ide-vscode-bar">
        <span className="ide-vscode-title">{t('vscode.title')}</span>
        {info !== undefined && (
          <span className="ide-vscode-origin" title={info.url}>{info.url}</span>
        )}
        <span className="ide-vscode-actions">
          <button className="ide-vscode-action" onClick={onRetry} data-testid="ide-vscode-retry">{t('vscode.reload')}</button>
          <button className="ide-vscode-action" onClick={onStop} data-testid="ide-vscode-stop">{t('vscode.stop')}</button>
        </span>
      </div>
      {error !== null && (
        <div className="ide-vscode-error" data-testid="ide-vscode-error">
          <div>{error}</div>
          <button className="ide-vscode-action" onClick={onRetry}>{t('vscode.retry')}</button>
        </div>
      )}
      {loading && <div className="ide-vscode-loading">{t('vscode.starting')}</div>}
      {info !== undefined && error === null && (
        <iframe
          className="ide-vscode-frame"
          src={info.url}
          title={t('vscode.title')}
          data-testid="ide-vscode-frame"
          // The workbench needs its own storage/cookies; the host already binds
          // to loopback, so no sandbox token is required beyond same-origin.
          allow="clipboard-read; clipboard-write"
        />
      )}
    </div>
  )
}
