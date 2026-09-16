import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS = 'src/client/icons/assets'
const OUT = 'src/client/icons.tsx'

function parseSvg(content) {
  const vb = (content.match(/viewBox="([^"]+)"/) || ['', '0 0 16 16'])[1]
  const paths = [...content.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(m => m[1])
  return { viewBox: vb, paths }
}

const nameMap = {
  files: 'explorer', search: 'search', 'source-control': 'sourceControl',
  'run-all': 'run', extensions: 'extensions', terminal: 'terminal',
  folder: 'folder', 'folder-opened': 'folderOpen', file: 'fileDefault',
  'chevron-right': 'chevronRight', 'chevron-down': 'chevronDown', 'chevron-up': 'chevronUp',
  'go-to-file': 'goToFile', 'new-file': 'newFile', 'new-folder': 'newFolder',
  close: 'close', 'split-horizontal': 'splitEditor', loading: 'loading',
  trash: 'trash', add: 'plus', ellipsis: 'more', eye: 'eye',
  check: 'check', discard: 'discard', sync: 'sync',
  copy: 'copy', edit: 'edit', rename: 'rename',
  sparkle: 'sparkle',
  'open-preview': 'openPreview',
  'arrow-up': 'arrowUp', 'cloud-upload': 'cloudUpload',
  'git-branch': 'branch', 'git-commit': 'commit', 'git-compare': 'compare',
  repo: 'repo', 'git-pull-request': 'pullRequest',
  diff: 'diff', 'diff-added': 'diffAdded', 'diff-modified': 'diffModified',
  'diff-removed': 'diffRemoved', 'diff-renamed': 'diffRenamed', 'diff-ignored': 'diffIgnored',
  refresh: 'refresh',
  'chrome-maximize': 'maximize', 'chrome-restore': 'restore',
  // Symbol / file-type icons
  'symbol-file': 'symbolFile',
  'symbol-array': 'symbolArray',
  'symbol-string': 'symbolString',
  'symbol-keyword': 'symbolKeyword',
  'symbol-numeric': 'symbolNumeric',
  'symbol-interface': 'symbolInterface',
  'symbol-class': 'symbolClass',
  'symbol-method': 'symbolMethod',
}

const files = readdirSync(ASSETS).filter(f => f.endsWith('.svg')).sort()

const entries = []
for (const f of files) {
  const base = f.replace(/\.svg$/, '')
  const exportName = nameMap[base]
  if (!exportName) continue
  const content = readFileSync(join(ASSETS, f), 'utf8')
  const { viewBox, paths } = parseSvg(content)
  if (!paths.length) { console.error('no paths in ' + f); continue }
  const pathsLit = paths.map(p => '    ' + JSON.stringify(p)).join(',\n') + ',\n'
  entries.push('  ' + exportName + ': { viewBox: ' + JSON.stringify(viewBox) + ', paths: [\n' + pathsLit + '  ] }')
}

// Build the ext->icon map entries as strings for the generated code
const extMapEntries = [
  "ts: 'symbolKeyword'", "tsx: 'symbolKeyword'", "js: 'symbolKeyword'", "jsx: 'symbolKeyword'",
  "py: 'symbolKeyword'", "rb: 'symbolKeyword'", "go: 'symbolKeyword'", "rs: 'symbolKeyword'",
  "java: 'symbolKeyword'", "c: 'symbolKeyword'", "cpp: 'symbolKeyword'", "h: 'symbolKeyword'",
  "cs: 'symbolKeyword'", "kt: 'symbolKeyword'", "swift: 'symbolKeyword'", "scala: 'symbolKeyword'",
  "php: 'symbolKeyword'", "pl: 'symbolKeyword'", "sh: 'symbolKeyword'", "bash: 'symbolKeyword'",
  "zsh: 'symbolKeyword'", "fish: 'symbolKeyword'", "ps1: 'symbolKeyword'",
  "json: 'symbolArray'", "jsonc: 'symbolArray'", "yaml: 'symbolArray'", "yml: 'symbolArray'",
  "toml: 'symbolArray'", "csv: 'symbolArray'", "tsv: 'symbolArray'",
  "xml: 'symbolArray'", "html: 'symbolKeyword'", "htm: 'symbolKeyword'",
  "css: 'symbolKeyword'", "scss: 'symbolKeyword'", "less: 'symbolKeyword'",
  "md: 'symbolString'", "markdown: 'symbolString'", "txt: 'symbolString'",
  "log: 'symbolString'", "env: 'symbolNumeric'", "lock: 'symbolNumeric'",
  "dts: 'symbolInterface'",
  "class: 'symbolClass'",
  "fn: 'symbolMethod'", "func: 'symbolMethod'",
].join(',\n    ')

const TPL = `import type { ReactNode } from 'react'

/**
 * Codicon icon set — every path below is extracted VERBATIM from the official
 * Microsoft @vscode/codicons source SVGs (src/icons/<name>.svg), the exact
 * same icon set vscode.dev renders via codicon.ttf. The source SVGs are
 * preserved verbatim under ./icons/assets/ as the single source of truth;
 * this file is a generated projection of their path data into inline SVG,
 * so the bundle needs no webfont asset at runtime. Run \`node gen-icons.mjs\`
 * to regenerate after adding or replacing any asset.
 */

interface IconDef { viewBox: string; paths: string[] }

function render(def: IconDef): ReactNode {
  return (
    <svg viewBox={def.viewBox} fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {def.paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

const ICONS: Record<string, IconDef> = {
${entries.join(',\n')}
}

/** Map a file extension to an icon key. */
function iconForExt(ext: string): keyof typeof ICONS {
  const map: Record<string, keyof typeof ICONS> = {
    ${extMapEntries},
  }
  return map[ext] ?? 'symbolFile'
}

/** Render a file icon based on its name and whether it is a directory. */
export function fileIcon(name: string, isDir: boolean, isOpen?: boolean): ReactNode {
  if (isDir) return isOpen ? render(ICONS.folderOpen) : render(ICONS.folder)
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  return render(ICONS[iconForExt(ext)])
}

/** Render a codicon by export name (verbatim @vscode/codicons path data). */
export const Icons = {
  explorer: render(ICONS.explorer),
  search: render(ICONS.search),
  git: render(ICONS.sourceControl),
  debug: render(ICONS.run),
  extensions: render(ICONS.extensions),
  terminal: render(ICONS.terminal),
  folder: render(ICONS.folder),
  folderOpen: render(ICONS.folderOpen),
  file: render(ICONS.fileDefault),
  chevronRight: render(ICONS.chevronRight),
  chevronDown: render(ICONS.chevronDown),
  goToFile: render(ICONS.goToFile),
  newFile: render(ICONS.newFile),
  newFolder: render(ICONS.newFolder),
  close: render(ICONS.close),
  splitEditor: render(ICONS.splitEditor),
  loading: render(ICONS.loading),
  emptyEditor: (<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.5 2.5h-11a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5zM2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm3 3h6v1H5V6zm0 3h6v1H5V9z"/></svg>),
  trash: render(ICONS.trash),
  plus: render(ICONS.plus),
  branch: render(ICONS.branch),
  commit: render(ICONS.commit),
  compare: render(ICONS.compare),
  repo: render(ICONS.repo),
  sync: render(ICONS.sync),
  cloudUpload: render(ICONS.cloudUpload),
  arrowUp: render(ICONS.arrowUp),
  pullRequest: render(ICONS.pullRequest),
  diff: render(ICONS.diff),
  diffAdded: render(ICONS.diffAdded),
  diffModified: render(ICONS.diffModified),
  diffRemoved: render(ICONS.diffRemoved),
  diffRenamed: render(ICONS.diffRenamed),
  diffIgnored: render(ICONS.diffIgnored),
  refresh: render(ICONS.refresh),
  check: render(ICONS.check),
  discard: render(ICONS.discard),
  copy: render(ICONS.copy),
  edit: render(ICONS.edit),
  rename: render(ICONS.rename),
  sparkle: render(ICONS.sparkle),
  openPreview: render(ICONS.openPreview),
  eye: render(ICONS.eye),
  more: render(ICONS.more),
  chevronUp: render(ICONS.chevronUp),
  maximize: render(ICONS.maximize),
  restore: render(ICONS.restore),
} as const
`

writeFileSync(OUT, TPL)
console.log('generated ' + OUT + ' from ' + files.length + ' official codicon SVGs (' + entries.length + ' entries)')
