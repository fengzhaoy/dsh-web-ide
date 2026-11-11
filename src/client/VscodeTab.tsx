/**
 * VS Code Server tab (Scheme C): a real code-server driven through a
 * PERSISTENT iframe overlay.
 *
 * WHY the overlay: this tab body is conditional React markup, so switching to
 * the chat tab removed it — and an iframe leaving the document is destroyed by
 * the browser, which reloaded the whole workbench on every switch back (the
 * user saw a blank pane while it reloaded). The frame now lives in a
 * body-level container owned by vscodeFrameHost: this component renders only
 * the toolbar plus an empty anchor div, and the overlay is positioned over
 * that anchor. Unmounting the tab therefore HIDES the frame
 * (display:none, verified not to reload) instead of destroying it.
 */
import { useEffect, useRef, useState } from 'react'
import { hasVscodeFrame, parkVscodeFrame, showVscodeFrame } from './vscodeFrameHost.js'
import type { IdeVscodeInfo } from './types.js'

type T = (key: string, params?: Record<string, string | number>) => string

/** Why the pane has no workbench; mirrors the host's error shapes. */
export type VscodePaneError =
  | { kind: 'missing'; searchedPaths: string[]; platform: string }
  | { kind: 'start'; message: string }

export interface VscodeTabProps {
  info: IdeVscodeInfo | undefined
  error: VscodePaneError | null
  loading: boolean
  onRetry: () => void
  onStop: () => void
  t: T
}

/** Copy helper that works without the async clipboard permission (http origins). */
function copyText(text: string): void {
  try {
    void navigator.clipboard.writeText(text)
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    try { document.execCommand('copy') } catch { /* best effort */ }
    document.body.removeChild(el)
  }
}

/** One install command with a copy button. */
function InstallRow({ command, note, t }: { command: string; note?: string; t: T }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="ide-vscode-install-row">
      <code className="ide-vscode-install-cmd">{command}</code>
      <button
        className="ide-vscode-action"
        onClick={() => {
          copyText(command)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        data-testid="ide-vscode-copy-command"
      >
        {copied ? t('vscode.copied') : t('vscode.copy')}
      </button>
      {note !== undefined && <span className="ide-vscode-install-note">{note}</span>}
    </div>
  )
}

/** Install guide shown when code-server is not on this machine. */
function MissingPanel({ error, onRetry, t }: {
  error: { searchedPaths: string[]; platform: string }
  onRetry: () => void
  t: T
}) {
  const isMac = error.platform === 'darwin'
  const isWin = error.platform === 'win32'
  return (
    <div className="ide-vscode-guide" data-testid="ide-vscode-missing-guide">
      <div className="ide-vscode-guide-title">{t('vscode.missing.title')}</div>
      <p className="ide-vscode-guide-reason">{t('vscode.missing.reason')}</p>
      {error.searchedPaths.length > 0 && (
        <details className="ide-vscode-guide-paths">
          <summary>{t('vscode.missing.searchedPaths')}</summary>
          <ul>
            {error.searchedPaths.slice(0, 12).map((p) => <li key={p}><code>{p}</code></li>)}
          </ul>
        </details>
      )}
      <div className="ide-vscode-guide-subtitle">{t('vscode.missing.install')}</div>
      {isMac && <InstallRow command="brew install code-server" note={t('vscode.missing.recommended')} t={t} />}
      {!isWin && <InstallRow command="npm install -g code-server" note="https://github.com/coder/code-server" t={t} />}
      {isWin && <InstallRow command="npm install -g code-server" t={t} />}
      <p className="ide-vscode-guide-hint">{t('vscode.missing.afterInstall')}</p>
      <p className="ide-vscode-guide-hint">
        {t('vscode.missing.pathHint')} <code>DSH_IDE_VSCODE_BIN=/path/to/code-server</code>
      </p>
      <button className="ide-vscode-action ide-vscode-guide-retry" onClick={onRetry} data-testid="ide-vscode-retry">
        {t('vscode.retry')}
      </button>
    </div>
  )
}

export function VscodeTab({ info, error, loading, onRetry, onStop, t }: VscodeTabProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null)

  // Re-run whenever the pane may have become visible again: the host hides the
  // inactive view with display:none instead of unmounting it, so without this a
  // tab switch back would leave the overlay parked (blank) until a reload.
  useEffect(() => {
    const anchor = anchorRef.current
    if (anchor === null || info === undefined || error !== null) return
    // showVscodeFrame keeps a rAF loop that watches the anchor: DSH hides the
    // inactive view with display:none and never unmounts it, so the loop parks
    // the overlay while hidden and paints it again by itself once the pane is
    // back. That is why a tab switch no longer needs a reload.
    showVscodeFrame(info.url, anchor)
  })

  const alreadyLoaded = info !== undefined && hasVscodeFrame(info.url)

  return (
    <div className="ide-vscode" data-testid="ide-vscode">
      <div className="ide-vscode-bar">
        <span className="ide-vscode-title">{t('vscode.title')}</span>
        {info !== undefined && (
          <span className="ide-vscode-origin" title={info.url}>{info.url}</span>
        )}
        <span className="ide-vscode-actions">
          <button className="ide-vscode-action" onClick={onRetry} data-testid="ide-vscode-reload">{t('vscode.reload')}</button>
          <button className="ide-vscode-action" onClick={onStop} data-testid="ide-vscode-stop">{t('vscode.stop')}</button>
        </span>
      </div>
      {error !== null && error.kind === 'missing' && (
        <MissingPanel error={error} onRetry={onRetry} t={t} />
      )}
      {error !== null && error.kind === 'start' && (
        <div className="ide-vscode-error" data-testid="ide-vscode-error">
          <div>{error.message}</div>
          <button className="ide-vscode-action" onClick={onRetry}>{t('vscode.retry')}</button>
        </div>
      )}
      {/* Only the "starting" pill is shown for a FIRST load; a frame that is
          already alive is re-shown instantly and must not flash a spinner. */}
      {loading && !alreadyLoaded && error === null && <div className="ide-vscode-loading">{t('vscode.starting')}</div>}
      {/* The overlay is positioned over this anchor; it holds no children. */}
      <div className="ide-vscode-anchor" ref={anchorRef} data-testid="ide-vscode-anchor" />
    </div>
  )
}
