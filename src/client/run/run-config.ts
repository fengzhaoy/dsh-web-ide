/**
 * Run/debug command derivation for the IDE.
 *
 * Pure logic (no React, no DOM) so it can be unit-tested with
 * `node --experimental-strip-types`. Everything the UI needs to turn "the
 * active file" or "this workspace" into a shell command lives here.
 */

/** One runnable thing: a script, a make target, a single source file. */
export interface RunTask {
  /** Stable id (also the menu id). */
  id: string
  /** Menu label, already human readable. */
  label: string
  /** Command written into the terminal. */
  command: string
  /** Where the command runs, relative to the workspace root ('' = root). */
  cwd?: string
  /** What produced this task, for grouping in the UI. */
  source: 'script' | 'file' | 'make' | 'cargo' | 'go' | 'python' | 'maven' | 'gradle'
}

/** Languages the runner can turn into a command, keyed by file extension. */
const FILE_RUNNERS: Record<string, (rel: string, base: string) => string> = {
  '.ts': (rel) => 'npx tsx ' + quote(rel),
  '.mts': (rel) => 'npx tsx ' + quote(rel),
  '.cts': (rel) => 'npx tsx ' + quote(rel),
  '.js': (rel) => 'node ' + quote(rel),
  '.mjs': (rel) => 'node ' + quote(rel),
  '.cjs': (rel) => 'node ' + quote(rel),
  '.py': (rel) => 'python3 ' + quote(rel),
  '.rb': (rel) => 'ruby ' + quote(rel),
  '.php': (rel) => 'php ' + quote(rel),
  '.sh': (rel) => 'bash ' + quote(rel),
  '.go': (rel) => 'go run ' + quote(rel),
  '.rs': (rel) => 'rustc ' + quote(rel) + ' -o /tmp/dsh-run && /tmp/dsh-run',
  '.java': (rel, base) => 'java ' + quote(base.replace(/\.java$/, '')),
  '.kt': (rel) => 'kotlin ' + quote(rel),
  '.c': (rel) => 'cc ' + quote(rel) + ' -o /tmp/dsh-run && /tmp/dsh-run',
  '.cpp': (rel) => 'c++ ' + quote(rel) + ' -o /tmp/dsh-run && /tmp/dsh-run',
}

/** Shell-quote a path: single quotes, escaping embedded ones. */
export function quote(path: string): string {
  if (path === '') return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(path)) return path
  return "'" + path.replace(/'/g, "'\\''") + "'"
}

/** File extensions that `runCurrentFile` understands. */
export function isRunnable(path: string): boolean {
  return runnerFor(path) !== null
}

function runnerFor(path: string): ((rel: string, base: string) => string) | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  return FILE_RUNNERS[path.slice(dot).toLowerCase()] ?? null
}

/** The command that runs ONE source file, or null when the file type is not
 *  runnable. `path` may be absolute (what the IDE holds) or workspace-relative:
 *  `root` converts the absolute form, because the command and the terminal's
 *  cwd are both resolved against the workspace root, not the filesystem root. */
export function runCommandForFile(path: string, root?: string): RunTask | null {
  const rel = workspaceRelativePath(path, root)
  const runner = runnerFor(rel)
  if (runner === null) return null
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  // Run from the file's own directory so relative reads of data files resolve
  // locally, exactly like VS Code's "Run Python File in Terminal".
  const slash = rel.lastIndexOf('/')
  const dir = slash >= 0 ? rel.slice(0, slash) : ''
  return {
    id: 'file:' + rel,
    label: rel,
    command: runner(base, base),
    cwd: dir,
    source: 'file',
  }
}

/** Parse `scripts` out of a package.json body. Never throws. */
export function packageScripts(files: Record<string, string>): RunTask[] {
  const body = files['package.json']
  if (body === undefined) return []
  try {
    const pkg = JSON.parse(body) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    return Object.keys(scripts).map((name) => ({
      id: 'script:' + name,
      label: 'npm run ' + name,
      command: 'npm run ' + name,
      source: 'script' as const,
    }))
  } catch {
    return []
  }
}

/** Parse `[targets]`-style phony targets out of a Makefile. */
export function makeTargets(makefile: string): RunTask[] {
  const out: RunTask[] = []
  const seen = new Set<string>()
  for (const raw of makefile.split('\n')) {
    // 'name:' at column 0 is a rule; skip comments, variables, .PHONY itself.
    const m = /^([A-Za-z0-9_.-]+)\s*:(?!=)/.exec(raw)
    if (m === null) continue
    const name = m[1]
    if (name === '.PHONY' || name.startsWith('.') || seen.has(name)) continue
    seen.add(name)
    out.push({ id: 'make:' + name, label: 'make ' + name, command: 'make ' + name, source: 'make' })
  }
  return out
}

/** Named `[bin]` entries plus the package name from Cargo.toml. Returns []
 *  when the file is absent or is not a crate manifest — an empty workspace
 *  must not sprout 'cargo run' out of nothing. */
export function cargoTargets(cargoToml: string): RunTask[] {
  if (!/^\s*\[(package|workspace)\]/m.test(cargoToml)) return []
  const out: RunTask[] = []
  if (/\[\[bin\]\]/.test(cargoToml)) {
    for (const m of cargoToml.matchAll(/\[\[bin\]\][\s\S]*?name\s*=\s*"([^"]+)"/g)) {
      out.push({ id: 'cargo:bin:' + m[1], label: 'cargo run --bin ' + m[1], command: 'cargo run --bin ' + m[1], source: 'cargo' })
    }
  }
  // A lib/bin crate always runs through plain 'cargo run'.
  if (out.length === 0) out.push({ id: 'cargo:run', label: 'cargo run', command: 'cargo run', source: 'cargo' })
  out.push({ id: 'cargo:test', label: 'cargo test', command: 'cargo test', source: 'cargo' })
  return out
}

/** `main` packages declared by go.mod: run the module root, plus test. */
export function goTargets(goMod: string): RunTask[] {
  if (!/^module\s+\S+/m.test(goMod)) return []
  return [
    { id: 'go:run', label: 'go run .', command: 'go run .', source: 'go' },
    { id: 'go:test', label: 'go test ./...', command: 'go test ./...', source: 'go' },
  ]
}

/** Named scripts from [project.scripts] / the pyproject build backend. */
export function pythonTargets(pyproject: string): RunTask[] {
  const out: RunTask[] = []
  for (const m of pyproject.matchAll(/\[project\.scripts\]\s*\n((?:[A-Za-z0-9_.-]+\s*=\s*"[^"]+"\n?)+)/g)) {
    for (const line of m[1].split('\n')) {
      const entry = /^([A-Za-z0-9_.-]+)\s*=/.exec(line)
      if (entry !== null) {
        out.push({ id: 'py:' + entry[1], label: 'python3 -m ' + entry[1], command: 'python3 -m ' + entry[1], source: 'python' })
      }
    }
  }
  if (out.length === 0 && /\[project\]/.test(pyproject)) {
    out.push({ id: 'py:main', label: 'python3 main.py', command: 'python3 main.py', source: 'python' })
  }
  return out
}

/** Maven lifecycle goals worth surfacing (skip the rarely used ones). */
export function mavenTargets(pom: string): RunTask[] {
  if (!/<project/.test(pom)) return []
  return ['test', 'package', 'install'].map((goal) => ({
    id: 'mvn:' + goal,
    label: 'mvn ' + goal,
    command: 'mvn ' + goal,
    source: 'maven' as const,
  }))
}

/** Gradle tasks: the common ones, plus the wrapper when present. */
export function gradleTargets(buildScript: string, hasWrapper: boolean): RunTask[] {
  if (!/plugins\s*\{|apply plugin/.test(buildScript)) return []
  const bin = hasWrapper ? './gradlew' : 'gradle'
  return ['test', 'build', 'run'].map((task) => ({
    id: 'gradle:' + task,
    label: bin + ' ' + task,
    command: bin + ' ' + task,
    source: 'gradle' as const,
  }))
}

/**
 * Discover every task in the workspace from the manifests the caller
 * managed to read. Missing files are simply absent from `files`.
 */
export function discoverTasks(files: Record<string, string>): RunTask[] {
  const tasks: RunTask[] = [
    ...packageScripts(files),
    ...makeTargets(files['Makefile'] ?? files['makefile'] ?? ''),
    ...cargoTargets(files['Cargo.toml'] ?? ''),
    ...goTargets(files['go.mod'] ?? ''),
    ...pythonTargets(files['pyproject.toml'] ?? ''),
    ...mavenTargets(files['pom.xml'] ?? ''),
    ...gradleTargets(files['build.gradle'] ?? files['build.gradle.kts'] ?? '', files['gradlew'] !== undefined),
  ]
  // Deduplicate by id so two manifests cannot offer the same entry twice.
  const seen = new Set<string>()
  return tasks.filter((task) => (seen.has(task.id) ? false : (seen.add(task.id), true)))
}

/* ------------------------------------------------------------- path units -- */

/**
 * The IDE and the host disagree about file units, and every cross-boundary hop
 * has to convert:
 *
 *   - IDE tabs, the file tree and Monaco models use ABSOLUTE paths
 *     (FileTree builds 'childPath = joinPath(dirPath, entry.name)' from the
 *     absolute workspace root);
 *   - every ideTools method takes a WORKSPACE-RELATIVE path and runs it
 *     through the host's resolveWorkspacePath(), which rejects anything that
 *     lands outside the root — including an absolute path inside it.
 *
 * Handing an absolute path straight to the host therefore fails as
 * 'ide-tools/bad-path' even though the file is right there. These two helpers
 * are the only sanctioned conversions.
 */

/** Normalise a path for comparison: forward slashes, collapsed runs of '/',
 *  no trailing slash. `/a//b/` and `/a/b` must compare equal, otherwise a root
 *  pasted with a trailing slash silently stops matching its own files. */
function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed
}

/** Workspace-relative form of an IDE path, for calls that cross to the host.
 *
 *  An absolute path under `root` loses the prefix; an already-relative path is
 *  returned unchanged; a path outside `root` is returned unchanged too, so the
 *  host's own fence reports it instead of this function silently rewriting it
 *  into something that happens to exist inside the workspace. */
export function workspaceRelativePath(path: string, root: string | undefined): string {
  const target = normalizePath(path)
  if (root === undefined || root === '') return target
  const base = normalizePath(root)
  if (target === base) return ''
  return target.startsWith(base + '/') ? target.slice(base.length + 1) : target
}

/**
 * The CDP `url` a script is addressed by, for breakpoints.
 *
 * Breakpoints are stored in the IDE's absolute-path unit, so this turns an
 * absolute path into the `file://` URL node reports — which is also exactly
 * what Debugger.setBreakpointByUrl wants once the script has parsed. A
 * relative path (an older stored breakpoint) is left alone: guessing a root
 * would bind a breakpoint to the wrong file.
 */
export function scriptUrlFor(path: string, root: string | undefined): string {
  // An already-formed URL is the answer; joining root onto it produced
  // 'file:///root/file:///tmp/a.mjs' — a URL that binds to nothing.
  if (path.startsWith('file://')) return path
  const absolute = root !== undefined && root !== '' ? workspaceAbsolutePath(path, root) : path
  return 'file://' + (absolute.startsWith('/') ? absolute : '/' + absolute)
}

/** Absolute form of a workspace-relative path (the inverse conversion). */
export function workspaceAbsolutePath(path: string, root: string): string {
  const target = normalizePath(path)
  if (target.startsWith('/') || /^[A-Za-z]:\//.test(target)) return target
  const base = normalizePath(root)
  return target === '' ? base : base + '/' + target
}

/* ---------------------------------------------------------------- storage -- */

const STORAGE_KEY = 'dsh-ide.run-recents'

/** Remember a task the user ran (P0-3), newest first, capped. */
export function rememberTask(task: RunTask, workspaceKey: string): void {
  try {
    const all = readRecents()
    const list = (all[workspaceKey] ?? []).filter((t) => t.id !== task.id)
    list.unshift({ id: task.id, label: task.label, command: task.command, cwd: task.cwd, source: task.source })
    all[workspaceKey] = list.slice(0, 12)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Storage denied: recents simply stay empty.
  }
}

/** Recent tasks for one workspace, newest first. */
export function recentTasks(workspaceKey: string): RunTask[] {
  try {
    return readRecents()[workspaceKey] ?? []
  } catch {
    return []
  }
}

function readRecents(): Record<string, RunTask[]> {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return {}
  const parsed = JSON.parse(raw) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  return parsed as Record<string, RunTask[]>
}
