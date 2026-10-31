/**
 * Scheme A: the instruction shown when a target was started under
 * `--inspect-brk`, so the user can attach Chrome DevTools to it.
 *
 * Kept free of React so it can be unit-tested outside the browser.
 */
export function inspectHint(wsUrl: string | undefined): string {
  if (wsUrl === undefined) return 'node --inspect-brk <file>'
  // The URL is what DevTools' "Connect to Node.js" target list consumes.
  return 'chrome://inspect  →  ' + wsUrl
}
