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
// Fix: route ONLY the worker labels the embedded bundle actually provides —
// the editor worker and the TypeScript language service — to the real worker.
// Every OTHER language label (json, css, html, markdown, …) gets the no-op
// worker, so $loadForeignModule is never issued for a module that is not
// there. Monarch tokenization (syntax highlighting) runs on the main thread
// and is unaffected.
//
// The TypeScript entry is load-bearing for Go-to-Definition: without a real
// ts.worker the language service never answers, and every .ts/.tsx/.mjs/.jsx
// jump silently degraded to the grep index (declaration-level, unable to
// follow imports). See src/client/monaco-worker.ts.
const SUPPORTED_WORKER_LABELS = new Set(['editorWorkerService', 'typescript'])

export function installMonacoWorker(): void {
  if (installed) return
  installed = true
  const host = self as unknown as { MonacoEnvironment?: MonacoEnv }
  try {
    const url = URL.createObjectURL(new Blob([monacoWorkerSource], { type: 'text/javascript' }))
    const env: MonacoEnv = host.MonacoEnvironment ?? {}
    env.getWorker = (_workerId: string, label: string) => {
      if (!SUPPORTED_WORKER_LABELS.has(label)) return createNoopWorker()
      try {
        return new Worker(url, { name: 'monaco-editor-worker' })
      } catch {
        return createNoopWorker()
      }
    }
    env.getWorkerUrl = (workerId: string, label: string) => {
      if (!SUPPORTED_WORKER_LABELS.has(label)) return noopWorkerUrl ?? (noopWorkerUrl = URL.createObjectURL(new Blob(['self.onmessage = () => {}'], { type: 'application/javascript' })))
      return url
    }
    host.MonacoEnvironment = env
  } catch {
    // Blob/URL unavailable (extremely old embedders): leave any existing
    // MonacoEnvironment untouched; later call sites still install the no-op.
    installed = false
  }
}
