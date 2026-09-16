/**
 * Client entry for the IDE plugin: register the `ide` view tab into the
 * conversation view ring, after chat (order 0) and trajectory (order 10).
 * The registration rides the slot service's effect wrapper, so plugin unload
 * removes the tab.
 */
import type { IdeClientContext, IdeViewInjected } from './types.js'
import { IdeView } from './IdeView.js'
import { installSidebarBridge, uninstallSidebarBridge } from './sidebarBridge.js'
import { TYPERT_REMOTE } from '../typert.remote-client.js'
import { NS, zh, en } from './locales.js'

/** Required browser services: slots, sessions, locale, and the workspaceFiles
 * Remote namespaces. Listing the namespace services here makes the boot kernel
 * resolve them before apply() runs — reading a not-yet-mounted namespace off
 * ctx.remote throws and would poison the whole conversation.view slot. The
 * ideTools namespace is deliberately ABSENT: this bundle mounts it itself
 * inside apply(), so pre-resolving it here would deadlock the boot. */
const inject = [
  'slots',
  'sessions',
  'locale',
  'remote',
  'remote.workspaceFiles',
  'remote.workspaceFilesWrite',
] as const

export { inject }

/** Degraded ideTools face used before the namespace finishes mounting (or
 * after it failed to mount): every call reports the degraded state instead of
 * throwing, so the view stays usable. */
const stubIdeTools = {
  search: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalOpen: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalWrite: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalSignal: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalTerminate: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  terminalOutput: async function* () {},
  gitStatus: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitBranches: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitDiff: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitCommit: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
  gitStageAll: async () => ({ ok: false as const, error: { code: 'ide-tools/unavailable', message: 'ideTools namespace is not mounted yet' } }),
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

  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'ide',
        order: 20,
        locale: NS,
        label: () => t('view.ide'),
        inject: (sessionId: string): IdeViewInjected => {
          const sessions = ctx.sessions.list.getSnapshot()
          const cwd = sessions.byId[sessionId]?.cwd
          return {
            sessionId,
            cwd,
            workspaceFiles: ctx.remote.workspaceFiles,
            workspaceFilesWrite: ctx.remote.workspaceFilesWrite,
            ideTools: () => {
              // The namespace is mounted on the Remote service's internal
              // namespaces Map by our fire-and-forget $mount. Reading
              // ctx.remote.ideTools would require listing 'remote.ideTools' in
              // inject — but this bundle mounts it itself, so pre-resolving it
              // in inject deadlocks the boot. Instead, reach into the Remote
              // service's own namespaces Map (ctx.remote is injected, its plain
              // properties are not inject-gated) and grab the namespace service.
              const remote = ctx.remote as unknown as {
                namespaces?: Map<string, { service: unknown }>
              }
              const ns = remote.namespaces?.get('ideTools')?.service as IdeViewInjected['ideTools'] | undefined
              return ns ?? stubIdeTools
            },
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

  // Resolve the background mount when it settles and return a disposer that
  // unmounts the namespace on plugin unload.
  return async () => {
    const unmountRemote = await mountPromise
    if (typeof unmountRemote === 'function') await unmountRemote()
  }
}
