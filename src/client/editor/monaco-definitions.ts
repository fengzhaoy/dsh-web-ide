/**
 * Bridge to Monaco's definition machinery.
 *
 * Monaco exposes no public "resolve definition at this position" call: the
 * editor's own Go-to-Definition action reaches the internal
 * `getDefinitionsAtPosition(registry, model, position, …)` with an
 * `ILanguageFeaturesService` injected by the services container. Those very
 * modules ship inside this bundle, so importing them directly gives the
 * TypeScript/JavaScript language service exactly the entry point the built-in
 * command uses — same provider ordering, same LocationLink resolution.
 *
 * The internal modules have no typings, hence the narrow local shapes.
 */
import { getDefinitionsAtPosition } from 'monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToSymbol.js'
import { ILanguageFeaturesService } from 'monaco-editor/esm/vs/editor/common/services/languageFeatures.js'

interface TextModel { uri: unknown }
interface MonacoPosition { lineNumber: number; column: number }
interface Range { startLineNumber: number; startColumn: number; endColumn: number }
interface LocationLink { range?: Range; targetUri?: { toString(): string }; uri?: { toString(): string }; targetSelectionRange?: Range }
interface Services { get(service: unknown): unknown }
interface Instantiation { invokeFunction<T>(fn: (services: Services) => T): T }

export interface MonacoDefinitionLocation {
  /** The model URI string, e.g. `dsh-ide:/abs/path.ts`. */
  uri: string
  line: number
  column: number
  endColumn: number
}

/** Resolve definitions for the symbol at `position`, via the language
 *  service bound to `model`. Empty array when no provider knows the symbol. */
export async function lookupDefinitions(
  editor: object,
  model: TextModel,
  position: MonacoPosition,
): Promise<MonacoDefinitionLocation[]> {
  const instantiation = (editor as { _instantiationService?: Instantiation })._instantiationService
  if (instantiation === undefined || typeof instantiation.invokeFunction !== 'function') return []
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  }
  const links = await instantiation.invokeFunction((services) => {
    const registry = services.get(ILanguageFeaturesService) as
      | { definitionProvider: Parameters<typeof getDefinitionsAtPosition>[0] }
      | undefined
    if (registry === undefined || registry === null) return Promise.resolve([])
    return getDefinitionsAtPosition(registry.definitionProvider, model as never, position as never, false, token as never) as Promise<readonly LocationLink[]>
  })
  const out: MonacoDefinitionLocation[] = []
  for (const link of links ?? []) {
    const uri = (link.targetUri ?? link.uri)?.toString()
    const range = link.targetSelectionRange ?? link.range
    if (uri === undefined || range === undefined) continue
    out.push({ uri, line: range.startLineNumber, column: range.startColumn, endColumn: range.endColumn })
  }
  return out
}

/** Map a Monaco model URI back to the absolute path the host uses. Models are
 *  created as `dsh-ide:<absolute path>` (see createOrReuseModel). */
export function pathFromModelUri(uri: string): string | null {
  const prefix = 'dsh-ide:'
  if (!uri.startsWith(prefix)) return null
  const path = uri.slice(prefix.length)
  return path.length > 0 ? path : null
}
/** Configure Monaco's TypeScript/JavaScript language service for this IDE.
 *
 * Without this the worker runs with Monaco's bare defaults, which are wrong
 * for a real project in ways that silently break Go-to-Definition:
 *
 *  - jsx is unset, so a .tsx file is parsed as plain TS and every JSX tag is
 *    a syntax error — imports used only inside markup look unresolved.
 *  - moduleResolution 'classic' cannot follow node_modules or path aliases.
 *  - allowSyntheticDefaultImports/nodeInterop off rejects `import React from
 *    'react'`, so the symbol behind it never resolves.
 *
 * Diagnostics are deliberately disabled: this is a browser editor, not a
 * build, and a wall of red underlines for type-only problems would be noise.
 * Completion, hover and definition still work.
 */
export function configureTypeScriptDefaults(monaco: {
  languages: {
    typescript: {
      typescriptDefaults: { setCompilerOptions(o: Record<string, unknown>): void; setDiagnosticsOptions(o: Record<string, unknown>): void }
      javascriptDefaults: { setCompilerOptions(o: Record<string, unknown>): void; setDiagnosticsOptions(o: Record<string, unknown>): void }
    }
  }
}): void {
  const compilerOptions = {
    target: 99,            // ESNext
    module: 99,            // ESNext
    moduleResolution: 2,   // NodeJs
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
    jsx: 2,                // React
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    strict: false,
    skipLibCheck: true,
    types: [],             // no implicit @types auto-inclusion
  }
  // jsx: React is right for .tsx; .ts files are unaffected by it.
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions)
  // Syntax errors still surface (they break parsing, hence navigation); type
  // errors are switched off for the reason in the doc comment above.
  const diagnostics = {
    noSemanticValidation: true,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: true,
  }
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnostics)
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnostics)
}