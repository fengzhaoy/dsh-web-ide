/**
 * Typings for the two Monaco internals the definition bridge imports.
 *
 * Monaco ships no .d.ts for its ESM internals (only the public
 * `editor.api.d.ts`), so these modules are declared here with the minimal
 * shape the bridge actually uses. Keep this narrow: widening it would invite
 * dependants on Monaco internals that a 0.52 upgrade could break silently.
 */
declare module 'monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToSymbol.js' {
  export interface DefinitionRegistry {
    ordered(model: unknown, recursive?: boolean): readonly unknown[]
  }
  export function getDefinitionsAtPosition(
    registry: DefinitionRegistry,
    model: unknown,
    position: unknown,
    recursive: boolean,
    token: unknown,
  ): Promise<readonly unknown[]>
}

declare module 'monaco-editor/esm/vs/editor/common/services/languageFeatures.js' {
  /** DI token; the container resolves it to the language-feature registry. */
  export const ILanguageFeaturesService: unknown
}