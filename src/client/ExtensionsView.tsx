/**
 * Extensions view (VS Code Extensions parity, read-only).
 *
 * This IDE runs its own Monaco shell and has NO extension host, so it cannot
 * load Open VSX / Marketplace extensions (they call require('vscode') and need
 * an extension host process). The VS Code pane does have one — it is a real
 * code-server, which ships the Open VSX marketplace. The view therefore leads
 * with an actionable prompt that takes the user there instead of leaving them
 * to wonder why nothing installs here.
 */
import { Icons } from './icons.js'

type T = (key: string, params?: Record<string, string | number>) => string

const BUILT_IN = [
  { id: 'explorer', needs: 'explorer.title' },
  { id: 'search', needs: 'search.title' },
  { id: 'git', needs: 'git.title' },
  { id: 'terminal', needs: 'terminal.title' },
  { id: 'problems', needs: 'problems.title' },
  { id: 'settings', needs: 'settings.title' },
]

export function ExtensionsView({ t, onOpenVscode }: {
  t: T
  /** Opens (or focuses) the VS Code pane, where the real marketplace lives. */
  onOpenVscode?: () => void
}) {
  return (
    <div className="ide-extensions" data-testid="ide-extensions">
      {/* The one thing a user needs to know before trying to install here. */}
      <div className="ide-extensions-callout" data-testid="ide-extensions-marketplace-note">
        <div className="ide-extensions-callout-title">
          <span className="ide-extensions-callout-icon" aria-hidden="true">i</span>
          {t('extensions.market.title')}
        </div>
        <p className="ide-extensions-callout-body">{t('extensions.market.body')}</p>
        <p className="ide-extensions-callout-body">{t('extensions.market.howto')}</p>
        {onOpenVscode !== undefined && (
          <button
            className="ide-extensions-callout-action"
            onClick={onOpenVscode}
            data-testid="ide-extensions-open-vscode"
          >
            {Icons.vscodeLogo}
            <span>{t('extensions.market.openVscode')}</span>
          </button>
        )}
      </div>

      <div className="ide-extensions-note">{t('extensions.note')}</div>
      <div className="ide-extensions-list">
        {BUILT_IN.map((b) => (
          <div key={b.id} className="ide-extensions-item" data-testid={'ide-extension-' + b.id}>
            <span className="ide-extensions-badge">{t('extensions.builtin')}</span>
            <span className="ide-extensions-name">{t(b.needs)}</span>
            <span className="ide-extensions-enabled">{t('extensions.enabled')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
