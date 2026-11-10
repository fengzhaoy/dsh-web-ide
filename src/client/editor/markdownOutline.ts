/**
 * Markdown document symbols for the Explorer's Outline view.
 *
 * Monaco ships no DocumentSymbolProvider for markdown (only the TS/JS worker
 * registers one), so the Outline showed "no symbols" for README files. VS Code
 * gets markdown outlines from its generic symbol machinery over the TextMate
 * grammar; the equivalent here is a small provider that walks the ATX
 * (`# … ######`) and Setext (`===` / `---` underline) headings and nests them by
 * level, which is exactly what VS Code's Outline renders.
 */
import type * as Monaco from 'monaco-editor'

interface Heading {
  readonly level: number
  readonly text: string
  readonly line: number
  readonly startCol: number
  readonly endCol: number
}

/** Collect headings in document order. Fenced code blocks are skipped so a
 *  `# comment` inside a fence is never mistaken for a heading. */
export function collectMarkdownHeadings(lines: readonly string[]): Heading[] {
  const out: Heading[] = []
  let fence: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fenceMatch !== null) {
      const marker = fenceMatch[1][0]
      if (fence === undefined) fence = marker
      else if (fence === marker) fence = undefined
      continue
    }
    if (fence !== undefined) continue
    const atx = /^(\s{0,3})(#{1,6})\s+(.*)$/.exec(line)
    if (atx !== null) {
      const level = atx[2].length
      const text = atx[3].replace(/\s+#+\s*$/, '').trim()
      if (text.length > 0) {
        out.push({ level, text, line: i, startCol: atx[1].length, endCol: line.length })
        continue
      }
    }
    // Setext: the underline belongs to the PREVIOUS non-empty line.
    const setext = /^\s*(=+|-+)\s*$/.exec(line)
    if (setext !== null && i > 0) {
      const prev = lines[i - 1]
      const prevText = prev.trim()
      if (prevText.length > 0 && !/^\s*(=+|-+)\s*$/.test(prev)) {
        out.push({ level: setext[1][0] === '=' ? 1 : 2, text: prevText, line: i - 1, startCol: 0, endCol: prev.length })
      }
    }
  }
  return out
}

/** Nest a flat heading list into the symbol tree (h1 > h2 > h3 …). */
function toSymbols(headings: readonly Heading[]): Monaco.languages.DocumentSymbol[] {
  const roots: Monaco.languages.DocumentSymbol[] = []
  const stack: Monaco.languages.DocumentSymbol[] = []
  for (const h of headings) {
    const range = { startLineNumber: h.line + 1, startColumn: h.startCol + 1, endLineNumber: h.line + 1, endColumn: h.endCol + 1 }
    const sym: Monaco.languages.DocumentSymbol = {
      name: h.text,
      detail: '',
      kind: 2 /* SymbolKind.Module — VS Code shows markdown headings as strings */,
      tags: [],
      range,
      selectionRange: range,
      children: [],
    }
    while (stack.length > 0 && stack[stack.length - 1] !== undefined && (stack[stack.length - 1] as unknown as { lvl: number }).lvl >= h.level) stack.pop()
    ;(sym as unknown as { lvl: number }).lvl = h.level
    if (stack.length === 0) roots.push(sym)
    else (stack[stack.length - 1].children ??= []).push(sym)
    stack.push(sym)
  }
  return roots
}

/** Register the markdown outline provider once per Monaco load. */
export function registerMarkdownOutline(monaco: typeof Monaco): void {
  if (registerMarkdownOutline.done) return
  registerMarkdownOutline.done = true
  monaco.languages.registerDocumentSymbolProvider('markdown', {
    displayName: 'Markdown',
    provideDocumentSymbols(model) {
      const lines: string[] = []
      for (let i = 1; i <= model.getLineCount(); i++) lines.push(model.getLineContent(i))
      return toSymbols(collectMarkdownHeadings(lines))
    },
  })
}
registerMarkdownOutline.done = false
