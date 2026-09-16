/**
 * Right-sidebar ↔ IDE bridge (intra-plugin DOM bridge).
 *
 * Direction A (sidebar file click → open in IDE): a capture-phase document
 * listener diverts primary clicks on the right sidebar's file-tree rows away
 * from the built-in preview and into the IDE view, via the conversation
 * view ring's one-shot focus request (openView('ide', path)).
 *
 * Direction B (IDE active file → sidebar highlight): the IDE publishes its
 * active absolute path; a MutationObserver re-marks tree rows as the sidebar
 * lazily loads levels. Both the built-in files tree (li[data-files-entry])
 * and dsh-better-sidebar's explorer (div[role=button][title]) are marked;
 * whichever tree is mounted lights up.
 */

/** Session-scoped handoff into the live IdeView mount. */
interface IdeBridge {
  openView: ((view: string, focus: string) => void) | undefined
  openFile: ((path: string) => void) | undefined
  activeSessionId: string | undefined
  activePath: string | undefined
}

const bridge: IdeBridge = { openView: undefined, openFile: undefined, activeSessionId: undefined, activePath: undefined }

const ACTIVE_ATTR = 'data-ide-active'

function normalizePath(p: string | null | undefined): string | undefined {
  if (!p) return undefined
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** The IdeView registers its live handlers on every mount. */
export function registerIdeMount(handlers: {
  sessionId: string
  openView: (view: string, focus: string) => void
  openFile: (path: string) => void
}): void {
  bridge.openView = handlers.openView
  bridge.openFile = handlers.openFile
  bridge.activeSessionId = handlers.sessionId
}

export function unregisterIdeMount(): void {
  bridge.openView = undefined
  bridge.openFile = undefined
  bridge.activeSessionId = undefined
}

/** The IDE publishes its active file so the sidebar can highlight it. */
export function publishActiveFile(sessionId: string | undefined, path: string | undefined): void {
  bridge.activeSessionId = sessionId
  bridge.activePath = path
  syncSidebarHighlight()
}

function matchesRow(rowPath: string | null, activePath: string | undefined): boolean {
  const row = normalizePath(rowPath)
  const active = normalizePath(activePath)
  return row !== undefined && active !== undefined && row === active
}

/** Re-mark sidebar tree rows for the IDE's active file. Degrades to a no-op
 * when no tree (or a different tree shape) is mounted. */
export function syncSidebarHighlight(): void {
  const scope = document.querySelector('[data-slot="rightbar.session"]')
  const activePath = bridge.activePath
  // Built-in files tree rows.
  for (const li of scope ? scope.querySelectorAll<HTMLLIElement>('li[data-files-entry][data-files-path]') : []) {
    if (matchesRow(li.getAttribute('data-files-path'), activePath)) li.setAttribute(ACTIVE_ATTR, '')
    else li.removeAttribute(ACTIVE_ATTR)
  }
  // dsh-better-sidebar explorer rows (absolute path in the title attribute).
  for (const row of scope ? scope.querySelectorAll<HTMLDivElement>('div[role="button"][title]') : []) {
    if (matchesRow(row.getAttribute('title'), activePath)) row.setAttribute(ACTIVE_ATTR, '')
    else row.removeAttribute(ACTIVE_ATTR)
  }
}

/** Divert a sidebar file click into the IDE view. */
function onSidebarClick(event: Event): void {
  if (!(event.target instanceof Element)) return
  if (event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
  // Built-in tree row: file entry inside the right sidebar.
  let row: Element | null = event.target.closest('li[data-files-entry="file"][data-files-path]')
  let path: string | null | undefined = row?.getAttribute('data-files-path')
  if (!row) {
    // better-sidebar explorer row: role=button with an absolute path title.
    const candidate = event.target.closest('div[role="button"][title]')
    const title = candidate?.getAttribute('title')
    if (candidate && title && title.startsWith('/')) { row = candidate; path = title }
  }
  if (!row || !path) return
  if (!row.closest('[data-slot="rightbar.session"]')) return
  event.preventDefault()
  event.stopPropagation()
  requestIdeOpen(path)
}

/** Route one file open into the IDE: prefer the live view's openView; before
 * the first IDE activation (no live mount yet) fall back to clicking the view
 * ring's IDE tab button and stash the path for the mount to open. */
export function requestIdeOpen(path: string): void {
  if (bridge.openView) {
    bridge.openView('ide', path)
    return
  }
  pendingOpenPath = path
  const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'IDE')
  tab?.click()
}

/** Path parked for the next IdeView mount (pre-activation sidebar clicks). */
let pendingOpenPath: string | undefined

/** Take and clear the pending open path (consumed by the view on mount). */
export function takePendingOpenPath(): string | undefined {
  const p = pendingOpenPath
  pendingOpenPath = undefined
  return p
}

let bridgeInstalled = false
let observer: MutationObserver | null = null

/** Install the document-capture listener and highlight observer once. */
export function installSidebarBridge(): void {
  if (bridgeInstalled) return
  bridgeInstalled = true
  document.addEventListener('click', onSidebarClick, { capture: true })
  observer = new MutationObserver(() => { syncSidebarHighlight() })
  observer.observe(document.body, { childList: true, subtree: true })
}

/** Remove the bridge (plugin unload). */
export function uninstallSidebarBridge(): void {
  if (!bridgeInstalled) return
  bridgeInstalled = false
  document.removeEventListener('click', onSidebarClick, { capture: true })
  observer?.disconnect()
  observer = null
}
