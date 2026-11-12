/**
 * VS Code Server host (Scheme C): run a code-server process and hand the page
 * an iframe URL.
 *
 * Deliberately isolated in one module so the whole feature can be deleted by
 * removing this file and its three method registrations — nothing here is
 * referenced by the Monaco editor path.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/** One managed code-server process. */
export interface VscodeServerEntry {
  /** Per-server credential the iframe URL carries. */
  readonly grant: string
  readonly port: number
  readonly origin: string
  readonly handle: import('@deepseek-ai/dsh-subprocess').SubprocessHandle
  readonly startedAt: number
  /** Last resolved state, refreshed by status(). */
  ready: boolean
}

/** Public shape returned to the client. */
export interface VscodeServerInfo {
  readonly url: string
  readonly port: number
  readonly ready: boolean
}

/**
 * Where a code-server binary may live, in preference order.
 *
 * `env.HOME` wins over `homedir()`: when a caller passes an env it means it,
 * and os.homedir() ignores the env entirely (it reads the passwd entry), which
 * made a sandboxed HOME silently fall back to the real user's install.
 *
 * `env.PATH` is searched too: a version manager (nvm, fnm, volta, asdf) puts
 * npm globals in a node-version-specific bin dir such as
 * `~/.nvm/versions/node/v24.14.0/bin`, which no fixed path list can predict.
 */
export function codeServerCandidates(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = []
  const explicit = env.DSH_IDE_VSCODE_BIN
  if (explicit !== undefined && explicit !== '') out.push(explicit)
  const home = env.HOME !== undefined && env.HOME !== '' ? env.HOME : homedir()
  out.push(join(home, '.npm-global', 'bin', 'code-server'))
  out.push('/opt/homebrew/bin/code-server')
  out.push('/usr/local/bin/code-server')
  out.push(join(home, '.local', 'bin', 'code-server'))
  out.push(join(home, 'Library', 'pnpm', 'code-server'))
  // Windows: npm/volta/pnpm globals live outside the usual PATH list.
  out.push(join(home, 'AppData', 'Roaming', 'npm', 'code-server.cmd'))
  out.push(join(home, 'AppData', 'Local', 'pnpm', 'code-server.cmd'))
  out.push(join(home, 'AppData', 'Local', 'Volta', 'bin', 'code-server.exe'))
  const path = env.PATH
  if (path !== undefined && path !== '') {
    for (const dir of path.split(delimiter)) {
      if (dir !== '') out.push(join(dir, 'code-server'))
    }
  }
  return out
}

/** First existing code-server binary, or null. */
export function findCodeServer(env: Record<string, string | undefined> = process.env): string | null {
  for (const candidate of codeServerCandidates(env)) {
    try {
      if (existsSync(candidate)) return candidate
    } catch { /* unreadable path: keep looking */ }
  }
  return null
}

/**
 * Args for a headless, locally trusted server.
 *
 * `--disable-workspace-trust` is required for extensions to activate at all:
 * a fresh workspace opens in Restricted Mode, where extension hosts are
 * launched but every extension is disabled. The user accepted that trade-off.
 */
export function codeServerArgs(options: {
  port: number
  userDataDir: string
  extensionsDir: string
}): string[] {
  return [
    '--bind-addr', '127.0.0.1:' + String(options.port),
    // code-server default ('*') reads the password from CODE_SERVER_PASSWORD.
    // `--auth none` trusted the loopback interface, which is NOT a boundary:
    // any other page or process on this machine can reach 127.0.0.1 and would
    // have driven a workbench with full filesystem and process access.
    '--auth', '*',
    '--user-data-dir', options.userDataDir,
    '--extensions-dir', options.extensionsDir,
    '--disable-workspace-trust',
    '--disable-telemetry',
    '--disable-update-check',
  ]
}

/** Child env carrying the per-server password. It must travel through the
 *  environment, never argv: `ps` shows argv to every user on the machine. */
export function codeServerEnv(password: string): Record<string, string> {
  return { CODE_SERVER_PASSWORD: password }
}

/** Build the iframe URL that opens `folder`, authenticated with the
 *  per-server password code-server accepts as `?tkn=`. */
export function workspaceUrl(origin: string, folder: string, password: string): string {
  return origin + '/?tkn=' + encodeURIComponent(password) + '&folder=' + encodeURIComponent(folder)
}

/** Pick a free-ish port deterministically from a base, avoiding a range the
 *  caller already holds. */
export function nextFreePort(base: number, inUse: Iterable<number>): number {
  const taken = new Set<number>()
  for (const p of inUse) taken.add(p)
  let port = base
  while (taken.has(port) && port < base + 100) port += 1
  return port
}
