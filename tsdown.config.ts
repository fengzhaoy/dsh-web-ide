import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'

const empty = fileURLToPath(new URL('./empty-module.js', import.meta.url))
const shim = fileURLToPath(new URL('./browser-crypto-shim.js', import.meta.url))
const vendoredSanitizeUrl = fileURLToPath(new URL('./vendor/sanitize-url.mjs', import.meta.url))
const mermaidIife = fileURLToPath(new URL('./vendor/mermaid-iife.js', import.meta.url))

/**
 * Rolldown plugin: Monaco imports codicon .ttf/.woff font assets and a few
 * CSS files the bundler cannot inline. We ship our own SVG icons, so every
 * font/asset import resolves to an empty module; the editor core (monarch
 * tokenizers, view, commands, find widget) bundles cleanly.
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

/** Rolldown plugin: mermaid's dependency tree (uuid) requires node:crypto for
 * random UUIDs, but the client runs inside the DSH ModuleLoader whose require
 * shim has no Node builtins. Redirect the specifier to a WebCrypto shim.
 * sanitize-url is redirected to a vendored single-file ESM copy because its
 * upstream CJS wrapper pair trips a rolldown __commonJS ordering bug in this
 * bundle (the index wrapper executes before the constants wrapper registers). */
function shimNodeCrypto() {
  return {
    name: 'dsh-ide-shim-node-crypto',
    resolveId(source: string) {
      if (source === 'node:crypto' || source === 'crypto') return { id: shim, external: false }
      if (source === '@braintree/sanitize-url') return { id: vendoredSanitizeUrl, external: false }
      return null
    },
  }
}

/** Rolldown plugin: expose the vendored mermaid browser IIFE as the string
 * constant MERMAID_IIFE. Bundling mermaid as modules trips rolldown-beta CJS
 * ordering bugs (UMD wrappers boot before their deps register), so the md
 * preview instead evaluates this prebuilt single-file IIFE on demand. */
function embedMermaidIife() {
  const virtualId = 'virtual:dsh-ide-mermaid-iife'
  return {
    name: 'dsh-ide-embed-mermaid-iife',
    resolveId(source: string) {
      if (source === virtualId) return { id: virtualId, external: false }
      return null
    },
    load(id: string) {
      if (id === virtualId) {
        const iife = readFileSync(mermaidIife, 'utf8')
        return 'export const MERMAID_IIFE = ' + JSON.stringify(iife)
      }
      return null
    },
  }
}

/**
 * Rolldown plugin: DSH serves only /plugins/<id>/client.js, so the emitted
 * client.css must ride inside the JS. At generateBundle we read the CSS asset
 * and prepend a runtime <style> injector to the client chunk.
 */
function inlineCss() {
  return {
    name: 'dsh-ide-inline-css',
    generateBundle(_opts: unknown, bundle: Record<string, { type: string; code?: string; source?: string | Uint8Array }>) {
      let clientKey: string | undefined
      let cssKey: string | undefined
      let cssText = ''
      for (const [k, b] of Object.entries(bundle)) {
        if (b.type === 'chunk' && /client/.test(k) && !clientKey) clientKey = k
        if (b.type === 'asset' && /\.css$/.test(k)) { cssKey = k; cssText = typeof b.source === 'string' ? b.source : Buffer.from(b.source as Uint8Array).toString('utf8') }
      }
      if (clientKey && cssKey && cssText) {
        const chunk = bundle[clientKey]
        const injector = `;(function(){var d=document;var s=d.createElement('style');s.setAttribute('data-dsh-ide','');s.textContent=${JSON.stringify(cssText)};(d.head||d.documentElement).appendChild(s);})();`
        ;(chunk as { code: string }).code = injector + (chunk.code ?? '')
        delete bundle[cssKey]
      }
    },
  }
}

/** Wrap client.js in the DSH module-loader factory form:
 * window.__ModuleLoader__.load({ id, factory: (require) => { ...body...; return module.exports } }).
 * The CJS body already uses 'require' and assigns onto 'exports', so wrapping
 * it inside the factory provides the require shim and module.exports carrier.
 * The index (host) entry is left untouched. */
function wrapModuleLoader() {
  return {
    name: 'dsh-ide-wrap-module-loader',
    renderChunk(code: string, info: { fileName: string }) {
      if (!/client\.js$/.test(info.fileName)) return null
      const wrapped = [
        'window.__ModuleLoader__.load({',
        '\tid: "@zhaoyang10/dsh-web-ide",',
        '\tfactory: (require) => {',
        '\t\tvar module = { exports: {} };',
        '\t\tvar exports = module.exports;',
        '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
        code,
        '\t\treturn module.exports;',
        '\t}',
        '});',
        '',
      ].join('\n')
      return { code: wrapped, map: undefined }
    },
  }
}

export default defineConfig([
  // E2E harness entry (never shipped; package.json files only includes lib/
  // subpaths that the profile loads — e2e.js is excluded via .npmignore-free
  // "files" allowlist because only index/typert/client are listed).
  {
    entry: { e2e: 'src/client/e2e-entry.ts' },
    format: 'iife',
    outDir: 'lib',
    globalName: '__DSH_IDE_E2E__',
    noExternal: [/^react/, 'monaco-editor', 'zod', 'xterm', '@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search', '@xterm/addon-web-links'],
    plugins: [neutralizeMonacoAssets(), shimNodeCrypto(), embedMermaidIife()],
  },
  // Host entries: plain ESM (the profile is type:module; the loader imports
  // lib/index.js as an ES module). index.js is the IdeTools Remote service;
  // typert.host.js is the strict typert manifest the typert-loader reads via
  // the package's './typert' export. DSH host packages stay external (the
  // host resolves them through its own node_modules).
  {
    entry: { index: 'src/index.ts', 'typert.host': 'src/typert.host.ts' },
    format: 'esm',
    outDir: 'lib',
    dts: { compile: true },
    outExtensions: () => ({ js: '.js' }),
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      /^@deepseek-ai\//,
      'zod',
    ],
  },
  // Client entry: CJS wrapped in the window.__ModuleLoader__ factory form.
  // Monaco is bundled (noExternal) with dynamic imports inlined (DSH serves
  // only /plugins/<id>/client.js), its font assets neutralized, and its CSS
  // injected at runtime from inside the JS.
  {
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    outDir: 'lib',
    outExtensions: () => ({ js: '.js' }),
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      /^@deepseek-ai\//,
    ],
    noExternal: ['monaco-editor', 'zod', 'xterm', '@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search', '@xterm/addon-web-links'],
    plugins: [neutralizeMonacoAssets(), shimNodeCrypto(), embedMermaidIife(), inlineCss(), wrapModuleLoader()],
    outputOptions: {
      inlineDynamicImports: true,
    },
  },
])
