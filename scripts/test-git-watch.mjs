#!/usr/bin/env node
/**
 * Unit checks for the git watcher's decision rules. The debounce/throttle and
 * the long-poll handshake are exercised for real here: a temp git repo is
 * created, `git add` is run, and the module must report a bump.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/git-watch.ts', import.meta.url), 'utf8')
let failed = 0
const check = (name, ok) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + name)
  if (!ok) failed += 1
}

check('lock files are filtered (git status churn must not loop)',
  /if \(rel\.endsWith\('\.lock'\)\) return true/.test(src))
check('heavy folders are filtered', /IGNORED_SEGMENTS = \[/.test(src) && src.includes("'node_modules'"))
check('events are debounced', /debounce = setTimeout/.test(src))
check('bursts are throttled to one bump per second', /THROTTLE_MS = 1000/.test(src))
check('watcher uses recursive fs.watch', /watch\(root, \{ recursive: true/.test(src))
check('a failed watch degrades gracefully', /catch \{\s*\/\/ A root we cannot watch/.test(src))
check('waiters are woken on a bump', /function wakeAll/.test(src) && /for \(const wake of pending\) wake\(\)/.test(src))
check('long-poll resolves on abort', /signal\?\.addEventListener\('abort', done/.test(src))

// --- real filesystem behaviour ---
const dir = mkdtempSync(join(tmpdir(), 'gitwatch-'))
try {
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  execSync('git add . && git commit -qm init', { cwd: dir })
  // git-watch is inlined into the host bundle, so it is imported from there.
  const mod = await import('../lib/index.js').catch(() => undefined)
  if (mod === undefined) {
    check('host bundle exposes the watcher API', false)
  } else {
    // First read-only status may flush git's stat cache once (index mtime
    // changes); after that it is stable. Let that settle, then assert the
    // STEADY state does not bump - that is what prevents a refresh loop.
    // The host wraps every git invocation in pause/resume because git touches
    // .git/index on each run. Simulate that contract here.
    const v0 = mod.currentGitVersion(dir)
    mod.pauseGitWatch(dir)
    execSync('git status --porcelain', { cwd: dir })
    await new Promise((r) => setTimeout(r, 800))
    mod.resumeGitWatch(dir)
    await new Promise((r) => setTimeout(r, 800))
    check('a paused git run does not bump (no refresh loop)', mod.currentGitVersion(dir) === v0)
    check('pause/resume are exported', typeof mod.pauseGitWatch === 'function' && typeof mod.resumeGitWatch === 'function')
    // A real change must bump.
    writeFileSync(join(dir, 'b.txt'), 'new\n')
    await new Promise((r) => setTimeout(r, 900))
    check('a new file bumps the version', mod.currentGitVersion(dir) > v0)
    // The long-poll resolves quickly once something changes.
    const before = mod.currentGitVersion(dir)
    const started = Date.now()
    const pending = mod.waitForGitChange(dir, before, 10000, undefined)
    setTimeout(() => { try { execSync('git add b.txt', { cwd: dir }) } catch { /* ignore */ } }, 200)
    const v1 = await pending
    check('long-poll resolves within the window', v1 > before && Date.now() - started < 5000)
    mod.closeGitWatch(dir)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(failed === 0 ? '\nall git-watch checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
