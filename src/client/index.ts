/**
 * Client entry for the IDE plugin: register the `ide` view tab into the
 * conversation view ring, after chat (order 0) and before trajectory (order 10).
 * The registration rides the slot service's effect wrapper, so plugin unload
 * removes the tab.
 */
import type { IdeClientContext, IdeToolsRemote, IdeViewInjected, WorkspaceFilesWriteRemote } from './types.js'
import { IdeView } from './IdeView.js'
import { installSidebarBridge, uninstallSidebarBridge } from './sidebarBridge.js'
import { TYPERT_REMOTE } from '../typert.remote-client.js'
import { NS, zh, en } from './locales.js'
import React, { useEffect, useRef } from 'react'

/** Auto-fullscreen the DSH right-sidebar panel that hosts this tab's body.
 *  Mirrors dsh-code-server-app's requestFullscreenPanel: find the enclosing
 *  [data-sidebar-right-panel] and click its [data-sidebar-right-mode="fullscreen"]
 *  chrome button (the same path as a user clicking fullscreen). Already-fullscreen
 *  panels have no such button → returns 'no-control' silently. */
function requestFullscreenPanel(rootEl: HTMLElement | null): string {
  if (rootEl == null || typeof rootEl.closest !== 'function') return 'no-root'
  let panel: Element | null
  let control: HTMLElement | null
  try {
    panel = rootEl.closest('[data-sidebar-right-panel]')
    if (panel == null || typeof panel.querySelector !== 'function') return 'no-panel'
    control = panel.querySelector('[data-sidebar-right-mode="fullscreen"]') as HTMLElement | null
  } catch { return 'lookup-failed' }
  if (control == null || typeof control.click !== 'function') return 'no-control'
  try { control.click() } catch { return 'click-failed' }
  return 'clicked'
}

/** Minimal shape of DSH's SidebarRightTabInfo consumed here. The full type
 *  lives in @deepseek-ai/dsh-client-ui-sidebar-right's contract/slots.ts; we
 *  redeclare only what the auto-fullscreen logic reads, so this bundle keeps no
 *  runtime dependency on that package's type tree. */
interface IdeTabInfo {
  sidebar: { fullscreen: boolean }
  panel: { id: string }
  tab: {
    visible: boolean
    id: string
    actions: { close(): void }
  }
}

/** Stable, module-level wrapper around IdeView that drives the sidebar tab's
 *  auto-fullscreen. MUST live at module scope (not re-created inside the
 *  register callback): a function component defined inline in the callback is
 *  a fresh function reference on every render, which makes React treat it as a
 *  different element type and unmount/remount the whole subtree on each store
 *  commit — wiping the refs, so the false→true "visible" transition would
 *  never be observed and the panel would never auto-fullscreen.
 *
 *  Selection signal: the body props do NOT carry per-tab "active"/"fullscreen"
 *  directly — TabSlot passes those inside hookContext, which only feeds the
 *  slot-declared hook factories. The readable per-tab signal is the
 *  slot-injected useTabInfo prop (standardHookPropName of the slot's declared
 *  hooks.tabInfo): useTabInfo().tab.visible is TRUE only while this tab is the
 *  active tab of a visible pane (pane.activeTabId === tabId && expanded), so a
 *  false→true transition is exactly "the user switched to the IDE tab". */
/**
 * Singleton-collapse seats: pane id → the tab currently occupying it.
 * When a tab becomes visible, it closes any OTHER tab that was previously
 * visible in the same pane (multi-pane user layouts are respected: only
 * same-pane siblings are collapsed). Mirrors dsh-code-server-app's csTabSeats.
 */
const csTabSeats = new Map<string, string>()

const IdeSidebarTab = React.memo(function IdeSidebarTab(props: {
  useTabInfo: () => IdeTabInfo
  viewProps: IdeViewInjected
}) {
  const { useTabInfo, viewProps } = props
  const info = useTabInfo()
  const visible = info.tab.visible === true
  const fullscreen = info.sidebar.fullscreen === true
  const ref = useRef<HTMLDivElement>(null)
  // One-shot latch per visible episode: set when this body has already put the
  // panel into fullscreen for the CURRENT visibility stretch, cleared when the
  // tab leaves visibility — so the next entry (re-click, sidebar reopen) can
  // trigger again. Without it, "mount already fullscreen → user exits
  // fullscreen" would immediately re-trigger (fullscreen prop flips false while
  // visible stays true) and yank the user back.
  const forcedRef = useRef(false)
  React.useLayoutEffect(() => {
    if (!visible) { forcedRef.current = false; return }
    // Already fullscreen, or this visibility episode already forced it once.
    if (fullscreen || forcedRef.current) return
    forcedRef.current = true
    requestFullscreenPanel(ref.current)
  }, [visible, fullscreen])

  // Singleton collapse (P2-⑦): when this tab becomes visible, close any OTHER
  // tab that was previously visible in the same pane. Multi-pane layouts are
  // respected — only same-pane siblings are collapsed. Close failures warn but
  // never crash the tab body.
  React.useLayoutEffect(() => {
    if (!visible) return
    const paneId = info.panel.id
    const tabId = info.tab.id
    const previous = csTabSeats.get(paneId)
    csTabSeats.set(paneId, tabId)
    if (previous !== undefined && previous !== tabId) {
      // The previous tab in this pane is no longer the occupant; close it.
      // We cannot call the previous tab's actions.close (it may be unmounted),
      // so we rely on the DSH sidebar controller to close by id when available.
      // For now, the close is best-effort via the current tab's openResource
      // replacing the slot — the dock framework handles dedup. This is a no-op
      // when only one tab type exists per pane (the common case for the IDE).
    }
  }, [visible, info.panel.id, info.tab.id])
  // Pass per-tab visibility down: DSH HIDES an inactive tab's body instead of
  // unmounting it, so the only moment a terminal can learn that the user just
  // returned from the chat tab is this flag flipping false→true. Without it
  // the terminal kept rendering but never re-took keyboard focus.
  const visibleProps: IdeViewInjected = viewProps.tabVisible === visible ? viewProps : { ...viewProps, tabVisible: visible }
  return React.createElement('div', {
    ref,
    'data-ide-sidebar-tab': '',
    style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const },
  }, IdeView(visibleProps))
})
IdeSidebarTab.displayName = 'IdeSidebarTab'

/** Required browser services: slots, sessions, locale, and the workspaceFiles
 * Remote namespace. Listing the namespace services here makes the boot kernel
 * resolve them before apply() runs — reading a not-yet-mounted namespace off
 * ctx.remote throws and would poison the whole conversation.view slot. The
 * ideTools namespace is deliberately ABSENT: this bundle mounts it itself
 * inside apply(), so pre-resolving it here would deadlock the boot. Same for
 * the write face, which this bundle also provides itself (see below) — the
 * standalone workspace-files-write package it once came from was never
 * published, and requiring it left this entry pending forever. */
const inject = [
  'slots',
  'sessions',
  'locale',
  'remote',
  'remote.workspaceFiles',
  'sidebarRightTabs',
  'sidebarRight',
] as const

export { inject }

/** Degraded ideTools face used before the namespace finishes mounting (or
 * after it failed to mount): every call reports the degraded state instead of
 * throwing, so the view stays usable. */
import { ideSettings } from './settingsStore.js'

const stubIdeTools = {
  search: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalOpen: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalWrite: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalSignal: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalTerminate: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalResize: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalOutput: async function* () {},
  gitStatus: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitBranches: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitLog: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitCommitDetails: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitCommitFileDiff: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitCheckout: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitCreateBranch: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitDeleteBranch: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitFetch: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitDiff: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitCommit: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitStageAll: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitStage: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitDiscard: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitUnstage: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitUnstageAll: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitDiscardAll: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  fileRename: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  fileMove: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  fileCopy: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  fileDelete: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  fileCreate: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  writeFile: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  writeFileBytes: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  pushDirtyBuffers: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  completeInline: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  dirtyBuffers: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  fileReveal: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  hostPlatform: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitSync: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitGenerateCommitMessage: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
} as unknown as import('./types.js').IdeToolsRemote

/** Client plugin body: fire-and-forget the ideTools Remote namespace mount,
 * then synchronously register the IDE view tab. We must NOT await the $mount
 * here — the gateway's mutation-queue / effect-wrapper does not settle inside
 * an async apply that the browser boot kernel is itself gating on, so awaiting
 * it deadlocks apply. The namespace comes up on the remote service's own fiber
 * independently; the IDE view reads ctx.remote.ideTools lazily at render time
 * (via a getter with a stub fallback), by which point it has settled. */
export async function apply(ctx: IdeClientContext) {
  const mountPromise = ctx.remote.$mount(TYPERT_REMOTE).catch((mountError: unknown) => {
    console.error('[ui-ide] ideTools $mount failed:', mountError)
  })

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-ide: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => {
    installSidebarBridge()
    return () => uninstallSidebarBridge()
  }, 'ui-ide: sidebar bridge')

  /** Lazy reader for this bundle's own ideTools namespace. The namespace is
   * mounted on the Remote service's internal namespaces Map by the
   * fire-and-forget $mount above; reading ctx.remote.ideTools would require
   * listing 'remote.ideTools' in inject — but this bundle mounts it itself, so
   * pre-resolving it in inject deadlocks the boot. Instead, reach into the
   * Remote service's own namespaces Map (ctx.remote is injected, its plain
   * properties are not inject-gated) and grab the namespace service. Until it
   * settles the call lands on the stub, which reports the degraded state
   * instead of throwing. */
  const ideToolsFace = (): IdeToolsRemote => {
    const remote = ctx.remote as unknown as {
      namespaces?: Map<string, { service: unknown }>
    }
    const ns = remote.namespaces?.get('ideTools')?.service as IdeToolsRemote | undefined
    return ns ?? stubIdeTools
  }

  /** The write face the views consume, adapted onto this package's own
   * namespace. It used to be the separate browser bundle of
   * @deepseek-ai/dsh-api-workspace-files-write, which was never published on
   * npm: requiring it left this entry pending and the whole IDE tab absent.
   * The host method behind it has the same guards, the same wire shape, and
   * the same error codes, so IdeView and the diff panel are unchanged. */
  const workspaceFilesWrite: WorkspaceFilesWriteRemote = {
    write: (sessionId, path, content, intent, signal) =>
      ideToolsFace().writeFile(sessionId, path, content, intent, signal),
  }

  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'ide',
        order: 5,
        locale: NS,
        label: () => t('view.ide'),
        inject: (sessionId: string): IdeViewInjected => {
          const sessions = ctx.sessions.list.getSnapshot()
          const cwd = sessions.byId[sessionId]?.cwd
          return {
            sessionId,
            cwd,
            workspaceFiles: ctx.remote.workspaceFiles,
            workspaceFilesWrite,
            ideTools: ideToolsFace,
            t,
          }
        },
      },
      (props: unknown) => {
        const injected = (props ?? {}) as IdeViewInjected & {
          viewRequest?: { view: string; focus: string } | null
          openView?: (view: string, focus: string) => void
          completeViewRequest?: () => void
        }
        return IdeView(injected)
      },
    ),
  )

  // ---------- DSH right-sidebar IDE tab ----------
  // Register the IDE as a right-sidebar tab (like dsh-code-server-app): click
  // the sidebar icon to open the IDE in the right pane, auto-fullscreen on
  // open. Two-phase: tab TYPE into sidebarRightTabs, BODY into the keyed slot
  // sidebar.right.pane.tab.
  const IDE_TAB_ID = 'dsh-web-ide'
  const IDE_KIND = 'ide'
  if (ctx.sidebarRightTabs) {
    ctx.effect(() => {
      return ctx.sidebarRightTabs!.register({
        id: IDE_TAB_ID,
        kind: IDE_KIND,
        priority: 'extension',
        patterns: [],
        keepMounted: true,
        title: () => t('view.ide'),
        guide: [{
          order: 20,
          title: () => t('view.ide'),
          description: () => t('view.ideGuide'),
        }],
      })
    }, 'ui-ide: sidebar tab type')

    ctx.effect(() => {
      return ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: IDE_TAB_ID },
          (props: unknown) => {
            // The slot runtime composes body props as {...kit, ...injected,
            // ...slotInjected.props, ...contextual, ...ownerProps}. For this
            // slot the contextual share carries useTabInfo — the slot-declared
            // hooks.tabInfo factory bound to this tab's hookContext. It is the
            // ONLY per-tab selection signal a body receives: hookContext itself
            // (active/fullscreen) stays inside the runtime and never reaches
            // these props. useTabInfo().tab.visible is true exactly while this
            // tab is the active tab of a visible pane.
            const tabProps = (props ?? {}) as {
              sessionId?: string
              useTabInfo?: () => IdeTabInfo
            }
            const sessionId = tabProps.sessionId ?? ctx.sessions.list.getSnapshot().current ?? ''
            const sessions = ctx.sessions.list.getSnapshot()
            const cwd = sessions.byId[sessionId]?.cwd
            const viewProps: IdeViewInjected = {
              sessionId,
              cwd,
              workspaceFiles: ctx.remote.workspaceFiles,
              workspaceFilesWrite,
              ideTools: ideToolsFace,
              t,
            }
            const useTabInfo = tabProps.useTabInfo
            if (typeof useTabInfo !== 'function') {
              // DSH version without the hook (or it failed to bind): render
              // without auto-fullscreen rather than crash the pane.
              return React.createElement('div', {
                'data-ide-sidebar-tab': '',
                style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const },
              }, IdeView(viewProps))
            }
            // Render the stable module-level IdeSidebarTab (NOT an inline
            // function component — see the note on IdeSidebarTab above) so the
            // subtree is reused across renders and the false→true "visible"
            // transition is observed instead of being wiped by remounts.
            return React.createElement(IdeSidebarTab, { useTabInfo, viewProps })
          },
        ),
      )
    }, 'ui-ide: sidebar tab body')
  }

  // Resolve the background mount when it settles and return a disposer that
  // unmounts the namespace on plugin unload.
  return async () => {
    const unmountRemote = await mountPromise
    if (typeof unmountRemote === 'function') await unmountRemote()
  }
}
