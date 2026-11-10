/**
 * Explorer's Outline section, mirroring VS Code's Outline view
 * (src/vs/workbench/contrib/outline/browser/outlinePane.ts): a nested symbol
 * tree of the ACTIVE editor, one row per document symbol, click reveals.
 *
 * Symbols come from the registered DocumentSymbolProviders (the TS/JS worker
 * powers them for the bundled languages) through the same internal service
 * lookup the Go-to-Definition bridge uses — Monaco exposes no public API.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { ILanguageFeaturesService } from 'monaco-editor/esm/vs/editor/common/services/languageFeatures.js'
import { Icons } from '../icons.js'

export interface OutlineItem {
  readonly name: string
  readonly detail: string
  readonly kind: number
  readonly range: { readonly startLine: number; readonly startCol: number }
  readonly children: readonly OutlineItem[]
}

interface RawSymbol {
  name: string
  detail?: string
  kind: number
  range: { startLineNumber: number; startColumn: number }
  children?: RawSymbol[]
}

interface Services { get(service: unknown): unknown }
interface Instantiation { invokeFunction<T>(fn: (services: Services) => T): T }
type Provider = { provideDocumentSymbols(model: unknown, token: unknown): Promise<RawSymbol[]> }
type Registry = { ordered(model: unknown): readonly Provider[] }

/** Collect document symbols exactly like VS Code's outline does: ask every
 *  registered provider (first non-empty wins — that is the provider ordering
 *  the outline model service relies on). */
async function collectSymbols(editor: object, model: unknown): Promise<readonly RawSymbol[]> {
  const instantiation = (editor as { _instantiationService?: Instantiation })._instantiationService
  if (instantiation === undefined || typeof instantiation.invokeFunction !== 'function') return []
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  }
  return instantiation.invokeFunction((services) => {
    const registry = services.get(ILanguageFeaturesService) as { documentSymbolProvider?: Registry } | undefined
    if (registry?.documentSymbolProvider === undefined) return Promise.resolve([] as readonly RawSymbol[])
    for (const provider of registry.documentSymbolProvider.ordered(model)) {
      try {
        const symbols = provider.provideDocumentSymbols(model, token)
        if (symbols !== undefined && symbols !== null) {
          return Promise.resolve(symbols).then((s) => (s.length > 0 ? s : []))
        }
      } catch { /* provider failed; try the next one */ }
    }
    return Promise.resolve([] as readonly RawSymbol[])
  })
}

/** VS Code outline sorts siblings by position (outlinePane tree sorter). */
function toTree(symbols: readonly RawSymbol[]): OutlineItem[] {
  const items = symbols.map((s) => ({
    name: s.name,
    detail: s.detail ?? '',
    kind: s.kind,
    range: { startLine: s.range.startLineNumber, startCol: s.range.startColumn },
    children: s.children !== undefined && s.children.length > 0 ? toTree(s.children) : [],
  }))
  items.sort((a, b) => a.range.startLine - b.range.startLine || a.range.startCol - b.range.startCol)
  return items
}

/** The seti/codicon glyph VS Code shows for a symbol kind (symbolIcons). */
function symbolIcon(kind: number): React.ReactNode {
  // SymbolKind enum: 1 File, 2 Module, 3 Namespace, 4 Package, 5 Class,
  // 6 Method, 7 Property, 8 Field, 9 Constructor, 10 Enum, 11 Interface,
  // 12 Function, 13 Variable, 14 Constant, 15 String, 16 Number, 17 Boolean,
  // 18 Array, 19 Object, 20 Key, 21 Null, 22 EnumMember, 23 Struct, 24 Event,
  // 25 Operator, 26 TypeParameter.
  const letterMap: Record<number, string> = {
    2: '{ }', 3: '{ }', 4: '{ }',
    5: 'C', 23: 'S',
    6: 'M', 9: 'C', 12: 'F',
    7: 'P', 8: 'P', 20: 'K',
    13: 'V', 14: 'C',
    10: 'E', 22: 'E',
    11: 'I',
    24: 'E',
    25: 'O',
    26: 'T',
  }
  const letter = letterMap[kind]
  if (letter === undefined) return null
  return <span className="ide-outline-symbol ide-outline-symbol-k" data-kind={kind}>{letter}</span>
}

export function OutlinePanel({ editor, model, activePath, onReveal, t }: {
  editor: Monaco.editor.IStandaloneCodeEditor | null
  model: Monaco.editor.ITextModel | null
  activePath: string | undefined
  onReveal: (path: string, line: number, col: number) => void
  t: (key: string, params?: Record<string, string | number>) => string
}): React.ReactElement {
  const [items, setItems] = useState<readonly OutlineItem[]>([])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // Re-collect when the model changes or its content changes (VS Code's
  // outline refreshes on edits too, via the outline model service).
  const versionRef = useRef<number>(-1)
  useEffect(() => {
    if (editor === null || model === null) { setItems([]); return }
    let cancelled = false
    const refresh = () => {
      void collectSymbols(editor, model).then((symbols) => {
        if (!cancelled) setItems(toTree(symbols))
      })
    }
    refresh()
    versionRef.current = model.getVersionId()
    const disposable = model.onDidChangeContent(() => {
      // Debounce: the TS worker re-parses asynchronously.
      const v = model.getVersionId()
      if (v === versionRef.current) return
      versionRef.current = v
      window.clearTimeout((refresh as unknown as { t?: number }).t)
      ;(refresh as unknown as { t?: number }).t = window.setTimeout(refresh, 400)
    })
    return () => { cancelled = true; disposable.dispose() }
  }, [editor, model])

  const rows = useMemo(() => {
    const out: Array<{ item: OutlineItem; depth: number; path: string }> = []
    const walk = (list: readonly OutlineItem[], depth: number, prefix: string) => {
      for (const item of list) {
        const path = prefix.length === 0 ? item.name : prefix + '\u0000' + item.name
        out.push({ item, depth, path })
        if (expanded.has(path) && item.children.length > 0) walk(item.children, depth + 1, path)
      }
    }
    walk(items, 0, '')
    return out
  }, [items, expanded])

  if (items.length === 0) {
    return <div className="ide-panel-empty" data-testid="ide-outline-empty">{activePath ? t('outline.noSymbols') : t('outline.noEditor')}</div>
  }
  return (
    <div className="ide-outline-tree" role="tree" data-testid="ide-outline-tree">
      {rows.map(({ item, depth, path }) => {
        const open = expanded.has(path)
        return (
          <div
            key={path}
            className="ide-tree-row"
            role="treeitem"
            aria-expanded={item.children.length > 0 ? open : undefined}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => {
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(path)) next.delete(path); else next.add(path)
                return next
              })
              if (activePath !== undefined) onReveal(activePath, item.range.startLine, item.range.startCol)
            }}
          >
            <span className="ide-tree-chevron" data-expanded={open || undefined}>
              {item.children.length > 0 ? Icons.chevronRight : null}
            </span>
            <span className="ide-tree-icon">{symbolIcon(item.kind)}</span>
            <span className="ide-tree-name" title={item.detail.length > 0 ? item.detail : item.name}>{item.name}</span>
          </div>
        )
      })}
    </div>
  )
}
