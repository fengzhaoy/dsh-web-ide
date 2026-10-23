/**
 * Extensions view (VS Code Extensions parity, read-only): explains that
 * extensions here are DSH-managed plugins, and lists the IDE's own built-in
 * feature modules as "built-in" entries. No marketplace.
 */
type T = (key: string, params?: Record<string, string | number>) => string

const BUILT_IN = [
  { id: 'explorer', needs: 'explorer.title' },
  { id: 'search', needs: 'search.title' },
  { id: 'git', needs: 'git.title' },
  { id: 'terminal', needs: 'terminal.title' },
  { id: 'problems', needs: 'problems.title' },
  { id: 'settings', needs: 'settings.title' },
]

export function ExtensionsView({ t }: { t: T }) {
  return (
    <div className="ide-extensions" data-testid="ide-extensions">
      <div className="ide-extensions-note">
        {t('extensions.note')}
      </div>
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
