/**
 * File Explorer visibility rules, mirroring VS Code.
 *
 * VS Code does NOT hide every dotfile: .gitignore, .github, .env, .vscode and
 * friends are all listed in the explorer. What it hides are exactly the
 * defaults of the `files.exclude` setting —
 * src/vs/workbench/contrib/files/browser/files.contribution.ts:158:
 *
 *   .git, .svn, .hg, .jj, .DS_Store and Thumbs.db, each matched at any depth
 *   (the source writes them as double-star globs).
 *
 * (plus the crswap glob the web build adds, since this is a web build.)
 *
 * Unlike a naive `name.startsWith('.')` filter this keeps ordinary dotfiles
 * visible, which is what VS Code does and what makes .gitignore editable from
 * the tree.
 */

/** Basenames hidden anywhere in the tree (the depth-independent half of the globs). */
const EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.svn',
  '.hg',
  '.jj',
  '.DS_Store',
  'Thumbs.db',
])

/** Suffixes hidden anywhere in the tree (the crswap swap files). */
const EXCLUDED_SUFFIXES: readonly string[] = ['.crswap']

/**
 * True when a directory entry must not be shown in the file explorer.
 *
 * Only the last path segment is examined: every default pattern is depth-agnostic,
 * so a name is excluded at any depth and nowhere else — a directory called
 * `my.git.notes` or a file named `.gitignore` stays visible.
 */
export function isExplorerExcluded(name: string): boolean {
  if (EXCLUDED_NAMES.has(name)) return true
  for (const suffix of EXCLUDED_SUFFIXES) {
    if (name.endsWith(suffix)) return true
  }
  return false
}

/** Apply the explorer rules to one directory listing. */
export function filterExplorerEntries<T extends { readonly name: string }>(entries: readonly T[]): T[] {
  return entries.filter((entry) => !isExplorerExcluded(entry.name))
}
