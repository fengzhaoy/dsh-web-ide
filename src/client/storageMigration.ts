/**
 * One-shot migration from the old `dsh-ide.*` storage prefix.
 *
 * The plugin used to brand its persisted state as `dsh-ide.*`; it is now
 * `dsh-web-ide.*` (the package is @zhaoyang10/dsh-web-ide). Renaming the keys
 * without moving the values would silently wipe every stored preference —
 * settings, keybindings, snippets, run history, panel toggles — so this runs
 * once, before anything reads them.
 *
 * Rules:
 *  - An existing NEW value always wins (the user may have run this build first).
 *  - Migration is idempotent: a second call finds only new keys and does nothing.
 *  - Failures are swallowed: private mode / disabled storage must not break boot.
 */

/** Every key the plugin persists, old name -> new name. */
const KEY_MAP: ReadonlyArray<readonly [string, string]> = [
  ['dsh-ide.settings', 'dsh-web-ide.settings'],
  ['dsh-ide.settingsVersion', 'dsh-web-ide.settingsVersion'],
  ['dsh-ide.keybindings', 'dsh-web-ide.keybindings'],
  ['dsh-ide.snippets', 'dsh-web-ide.snippets'],
  ['dsh-ide.run-recents', 'dsh-web-ide.run-recents'],
  ['dsh-ide.run-debug', 'dsh-web-ide.run-debug'],
  ['dsh-ide.sidebarViewByProject', 'dsh-web-ide.sidebarViewByProject'],
  ['dsh-ide.sidebar-width', 'dsh-web-ide.sidebar-width'],
  ['dsh-ide.outlineOpen', 'dsh-web-ide.outlineOpen'],
  ['dsh-ide.timelineOpen', 'dsh-web-ide.timelineOpen'],
  // Pre-per-project single value; IdeView folds it into the new map on mount.
  ['dsh-ide.sidebarView', 'dsh-web-ide.sidebarView'],
]

let migrated = false

/** Move every legacy key once per page load. Safe to call from anywhere. */
export function migrateLegacyStorage(): void {
  if (migrated) return
  migrated = true
  try {
    for (const [oldKey, newKey] of KEY_MAP) {
      const value = localStorage.getItem(oldKey)
      if (value === null) continue
      if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, value)
      localStorage.removeItem(oldKey)
    }
  } catch {
    // Storage denied (private mode): nothing was persisted before either.
  }
}
