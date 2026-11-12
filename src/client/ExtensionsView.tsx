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
import { CollapsibleNote } from './CollapsibleNote.js'

type T = (key: string, params?: Record<string, string | number>) => string

const BUILT_IN = [
  { id: 'explorer', needs: 'explorer.title' },
  { id: 'search', needs: 'search.title' },
  { id: 'git', needs: 'git.title' },
  { id: 'terminal', needs: 'terminal.title' },
  { id: 'problems', needs: 'problems.title' },
  { id: 'settings', needs: 'settings.title' },
]

export function ExtensionsView({ t }: {
  t: T
}) {
  return (
    <div className="ide-extensions" data-testid="ide-extensions">
      {/* The one thing a user needs to know before trying to install here:
          this pane has no extension host. Two textual routes instead of a
          button, because both paths leave this pane. */}
      <CollapsibleNote title={t('extensions.market.title')} testId="ide-extensions-marketplace-note">
        <p>{t('extensions.market.body')}</p>
        {/* Same body shape as the run/debug note: plain paragraphs, one per
            route, with the package name inline in <code>. */}
        <p data-testid="ide-extensions-option-vscode-icon">
          <strong>{t('extensions.market.choice1')}</strong>
          {' ' + t('extensions.market.choice1Body')}
        </p>
        <p data-testid="ide-extensions-option-plugin">
          <strong>{t('extensions.market.choice2')}</strong>
          {' ' + t('extensions.market.choice2Body')}<code>@zhaoyang10/dsh-web-vscode</code>
        </p>
      </CollapsibleNote>

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
