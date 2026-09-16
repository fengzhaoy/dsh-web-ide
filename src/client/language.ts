/**
 * Map a file path to a Monaco language id by extension. Monaco's own
 * `getLanguageIdForLanguageName` requires registration; a local extension map
 * is cheaper and self-contained.
 */
const EXT_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown',
  xml: 'xml', svg: 'xml',
  yml: 'yaml', yaml: 'yaml',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  sql: 'sql',
  toml: 'ini', ini: 'ini', conf: 'ini',
  dockerfile: 'dockerfile',
  txt: 'plaintext',
  log: 'plaintext',
}

/** Dockerfile/Makefile-style filename overrides. */
const NAME_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  'gemfile': 'ruby',
}

export function detectLanguage(path: string): string {
  const base = path.split('/').pop() ?? path
  const lower = base.toLowerCase()
  if (NAME_MAP[lower]) return NAME_MAP[lower]
  const dot = lower.lastIndexOf('.')
  if (dot === -1) return 'plaintext'
  const ext = lower.slice(dot + 1)
  return EXT_MAP[ext] ?? 'plaintext'
}

/** Pretty label for the status bar. */
export function languageLabel(lang: string): string {
  const labels: Record<string, string> = {
    typescript: 'TypeScript', javascript: 'JavaScript', json: 'JSON',
    css: 'CSS', scss: 'SCSS', less: 'Less', html: 'HTML',
    markdown: 'Markdown', xml: 'XML', yaml: 'YAML', python: 'Python',
    go: 'Go', rust: 'Rust', java: 'Java', c: 'C', cpp: 'C++',
    csharp: 'C#', ruby: 'Ruby', php: 'PHP', swift: 'Swift',
    kotlin: 'Kotlin', shell: 'Shell', sql: 'SQL', ini: 'Properties',
    dockerfile: 'Docker', makefile: 'Makefile', plaintext: 'Plain Text',
  }
  return labels[lang] ?? lang
}
