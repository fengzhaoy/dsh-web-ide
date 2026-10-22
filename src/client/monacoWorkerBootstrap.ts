/**
 * Install a REAL Monaco editor worker for the standalone editor.
 *
 * Monaco's diff editor computes its changes inside the EditorWorkerService web
 * worker. With the previous no-op worker (a worker that never answers) the
 * computation never finished: both panes rendered text — Monarch tokenization
 * runs on the main thread — but NO diff was produced, so added/removed regions
 * got no line/char decorations and no green/red highlighting.
 *
 * DSH serves this plugin as a single /plugins/<id>/client.js, so the worker
 * script cannot live at its own URL: the worker build (see
 * scripts/build-monaco-worker.mjs and src/client/monaco-worker.ts) is embedded
 * into the client bundle as source text and instantiated here from a Blob URL.
 *
 * Idempotent; safe to call from every Monaco entry point.
 */
import monacoWorkerSource from './generated/monaco-worker-source.js'

type MonacoEnv = {
  getWorker?: (workerId: string, label: string) => Worker
  getWorkerUrl?: (workerId: string, label: string) => string
}

let installed = false
let noopWorkerUrl: string | undefined

function createNoopWorker(): Worker {
  // Last-resort fallback (e.g. an environment where Worker creation from a
  // blob: URL is refused): the inert worker the editor shipped with before —
  // text renders, diff highlighting does not, but nothing crashes.
  if (noopWorkerUrl === undefined) {
    noopWorkerUrl = URL.createObjectURL(
      new Blob(['self.onmessage = () => {}'], { type: 'application/javascript' }),
    )
  }
  return new Worker(noopWorkerUrl, { type: 'classic' })
}

// The embedded worker bundle contains ONLY the generic editor worker
// (editor.worker.js) — it powers diff computation and link detection but has
// NO language-service modules (json.worker, ts.worker, ...). Monaco still asks
// the worker to $loadForeignModule for language services when a model's
// language is json/typescript/etc.; the generic worker has no AMD require.toUrl
// for those, so it throws "Cannot read properties of undefined (reading
// 'toUrl')" back to the main thread. That uncaught error can interrupt a
// concurrent React render and leave the editor blank.
//
// Fix: route ONLY the editor worker (label 'editorWorkerService') to the real
// embedded worker; every language-service worker request gets the no-op worker,
// so $loadForeignModule is never issued against a worker that cannot satisfy it.
// Monarch tokenization (syntax highlighting) runs on the main thread and is
// unaffected; only language IntelliSense (completion, diagnostics) is absent —
// which was already the case since no language worker was ever bundled.
const EDITOR_WORKER_LABEL = 'editorWorkerService'

export function installMonacoWorker(): void {
  if (installed) return
  installed = true
  const host = self as unknown as { MonacoEnvironment?: MonacoEnv }
  try {
    const url = URL.createObjectURL(new Blob([monacoWorkerSource], { type: 'text/javascript' }))
    const env: MonacoEnv = host.MonacoEnvironment ?? {}
    env.getWorker = (_workerId: string, label: string) => {
      if (label !== EDITOR_WORKER_LABEL) return createNoopWorker()
      try {
        return new Worker(url, { name: 'monaco-editor-worker' })
      } catch {
        return createNoopWorker()
      }
    }
    env.getWorkerUrl = (workerId: string, label: string) => {
      if (label !== EDITOR_WORKER_LABEL) return noopWorkerUrl ?? (noopWorkerUrl = URL.createObjectURL(new Blob(['self.onmessage = () => {}'], { type: 'application/javascript' })))
      return url
    }
    host.MonacoEnvironment = env
  } catch {
    // Blob/URL unavailable (extremely old embedders): leave any existing
    // MonacoEnvironment untouched; later call sites still install the no-op.
    installed = false
  }
}
