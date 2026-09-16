/**
 * Monaco editor worker entry — built SEPARATELY by
 * `scripts/build-monaco-worker.mjs` into a self-contained IIFE whose source
 * text is embedded into the client bundle
 * (`src/client/generated/monaco-worker-source.js`).
 *
 * Why a worker at all: Monaco computes the diff editor's changes through its
 * EditorWorkerService web worker. Without a working worker the computation
 * never completes, and the diff shows two panes of text with NO add/remove
 * region highlighting (line/char decorations are never created).
 *
 * Why embedded: DSH serves this plugin as a single /plugins/<id>/client.js —
 * there is no second URL to host a worker script. monacoWorkerBootstrap.ts
 * turns the embedded source into a Blob URL and instantiates the Worker from
 * it at runtime.
 *
 * This module is NOT part of the client bundle graph; it is only read by the
 * worker build. Keep its imports limited to the worker entry.
 */
import 'monaco-editor/esm/vs/editor/editor.worker.js'
