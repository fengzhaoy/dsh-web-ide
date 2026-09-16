import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const empty = fileURLToPath(new URL('../empty-module.js', import.meta.url))

/**
 * Same neutralization as the main tsdown.config.ts: Monaco imports codicon
 * font assets and a codicon CSS file the bundler cannot inline; the worker
 * bundle needs neither (pure common/editor-worker code, no UI chrome).
 */
function neutralizeMonacoAssets() {
  return {
    name: 'dsh-ide-neutralize-monaco-assets',
    resolveId(source: string) {
      if (/\.(?:ttf|woff2?|eot)$/.test(source)) return { id: empty, external: false }
      if (/vs\/base\/browser\/ui\/codicons\/codicon\/codicon\.css$/.test(source)) return { id: empty, external: false }
      return null
    },
  }
}

/**
 * Worker bundle config, driven by scripts/build-monaco-worker.mjs. Produces ONE
 * self-contained IIFE chunk (classic-worker safe, no import statements) from
 * src/client/monaco-worker.ts into a temp dir the driver script then embeds
 * into src/client/generated/monaco-worker-source.js.
 */
export default defineConfig({
  entry: { 'monaco-worker': here('../src/client/monaco-worker.ts') },
  outDir: here('../lib/.monaco-worker-tmp'),
  format: 'iife',
  platform: 'browser',
  minify: true,
  dts: false,
  plugins: [neutralizeMonacoAssets()],
  noExternal: [/monaco-editor/],
  outputOptions: {
    inlineDynamicImports: true,
  },
})
