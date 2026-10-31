/**
 * Pure path helpers shared by the Explorer's reveal logic.
 *
 * Kept out of FileTree.tsx so the splitting rules can be unit-tested without
 * dragging React and the whole tree component into Node.
 */

/** Split an absolute path into the chain of ancestors below `root`, ending
 *  with the path itself. Returns null when `path` lies outside `root` (a file
 *  from another project, or one built with a different separator).
 *
 *  revealChain('/w', '/w/src/a/b.ts')
 *    -> ['/w/src', '/w/src/a', '/w/src/a/b.ts']
 */
export function revealChain(root: string, path: string): string[] | null {
  const normRoot = root.replace(/[/\\]+$/, '')
  const normPath = path.replace(/\\/g, '/').replace(/[/]+$/, '')
  if (normPath === '' || normRoot === '') return null
  if (normPath === normRoot) return []
  if (!normPath.startsWith(normRoot + '/')) return null
  const rel = normPath.slice(normRoot.length + 1)
  if (rel === '') return null
  const out: string[] = []
  let acc = normRoot
  for (const seg of rel.split('/')) {
    if (seg === '') continue
    acc = acc + '/' + seg
    out.push(acc)
  }
  return out.length === 0 ? null : out
}