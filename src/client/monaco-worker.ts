/**
 * Monaco worker entry — built SEPARATELY by `scripts/build-monaco-worker.mjs`
 * into a self-contained IIFE whose source is embedded into the client bundle
 * (`src/client/generated/monaco-worker-source.js`).
 *
 * Two services live here, and the distinction matters:
 *
 *  - editor.worker.js — diff computation and link detection.
 *  - ts.worker.js     — the TypeScript/JavaScript language service. This is
 *    what makes Go-to-Definition, hover and completion work for .ts/.tsx/
 *    .mts/.cts/.js/.jsx/.mjs/.cjs WITHOUT grepping: it resolves imports, path
 *    aliases, barrels, JSX components and node_modules the way a compiler does.
 *
 * Before ts.worker.js was added here, every language-service worker request
 * was answered by an inert worker, so `getDefinitionsAtPosition` never
 * resolved and TypeScript silently fell back to the grep index — declaration
 * level only, and unable to follow imports.
 *
 * Why embedded: DSH serves this plugin as a single /plugins/<id>/client.js —
 * there is no second URL to host a worker script, so the built source travels
 * inside the bundle and is instantiated from a Blob URL at runtime (see
 * monacoWorkerBootstrap.ts).
 *
 * This module is NOT part of the client bundle graph; it is only read by the
 * worker build. Keep its imports limited to worker entries.
 */
import 'monaco-editor/esm/vs/editor/editor.worker.js'
import 'monaco-editor/esm/vs/language/typescript/ts.worker.js'