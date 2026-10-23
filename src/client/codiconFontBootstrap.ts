/**
 * Runtime injection of the Monaco codicon webfont.
 *
 * The main tsdown config neutralizes Monaco's codicon .ttf/.css imports to
 * empty modules (the IDE shell ships its own SVG icons), but Monaco's internal
 * UI — the find widget's case/word/regex toggles, prev/next match arrows,
 * close button, suggest widget, folding chevrons — still renders those icons
 * through the codicon font: the standalone theme service dynamically injects
 * codepoint rules (`.codicon-<id>:before { content: '\\eXXX' }`), and those
 * codepoints only draw when an actual "codicon" @font-face + base class exist.
 *
 * This module injects exactly that, with the font inlined as a base64 data URI
 * (src/client/generated/codicon-font-source.js, embedded at build time by
 * scripts/build-monaco-worker.mjs). Idempotent: the style element is tagged and
 * only created once.
 */
import codiconFontBase64 from './generated/codicon-font-source.js'

let injected = false

export function installCodiconFont(): void {
  if (injected) return
  injected = true
  const doc = document
  const style = doc.createElement('style')
  style.setAttribute('data-dsh-ide-codicon', '')
  // Mirror of monaco-editor's codicon.css: @font-face + the .codicon base
  // class rules the dynamic codepoint selectors rely on.
  style.textContent =
    '@font-face{font-family:"codicon";font-display:block;' +
    'src:url(data:font/ttf;base64,' + codiconFontBase64 + ') format("truetype")}' +
    '.codicon[class*=codicon-]{font:normal normal normal 16px/1 codicon;display:inline-block;' +
    'text-decoration:none;text-rendering:auto;text-align:center;text-transform:none;' +
    '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;' +
    'user-select:none;-webkit-user-select:none}'
  ;(doc.head ?? doc.documentElement).appendChild(style)
}
