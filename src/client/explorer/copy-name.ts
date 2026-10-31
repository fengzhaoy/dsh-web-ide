/**
 * Name derivation for explorer copy/paste.
 *
 * Lives in its own module (no React imports) so the rules can be unit-tested
 * with `node --experimental-strip-types`, which cannot load .tsx.
 */

/** Derive a non-colliding name ("name - copy", "name - copy 2", ...) from the
 *  siblings the caller passes; VS Code's copySuffix pattern. */
export function nonCollidingName(baseName: string, siblings: ReadonlySet<string>): string {
  if (!siblings.has(baseName)) return baseName
  const dot = baseName.lastIndexOf('.')
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName
  const ext = dot > 0 ? baseName.slice(dot) : ''
  // n counts copies: the first attempt is the bare suffix, then ' 2', ' 3', …
  // Starting at 2 while only appending for n > 2 made the first pass produce
  // the bare suffix anyway, so a tree holding 'a.ts' and 'a - copy.ts' jumped
  // straight to 'a - copy 3' and never offered ' 2'.
  for (let n = 1; n < 1000; n += 1) {
    const candidate = stem + ' - copy' + (n > 1 ? ' ' + String(n) : '') + ext
    if (!siblings.has(candidate)) return candidate
  }
  return stem + ' - copy ' + String(Date.now()) + ext
}

/** Normalise a path for prefix comparisons: forward slashes, no trailing
 *  separator. A bare "/" normalises to "", which relPathOf treats as the
 *  filesystem root. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Path of `absPath` relative to `rootDir`. Returns `absPath` unchanged when it
 *  is not inside the root.
 *
 *  Callers used to do `childPath.replace(rootDir + '/', '')`, which is NOT
 *  anchored: a root string appearing later in the path was stripped too
 *  ('/x/Users/me/proj/a.ts' with root '/Users/me/proj' became '/xa.ts'). */
export function relPathOf(rootDir: string, absPath: string): string {
  const root = normalizePath(rootDir)
  const abs = normalizePath(absPath)
  if (abs === root) return ''
  if (root === '') return abs.replace(/^\/+/, '')
  const prefix = root + '/'
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs
}
