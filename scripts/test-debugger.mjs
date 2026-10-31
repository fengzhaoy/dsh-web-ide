/**
 * Scheme B debugger checks: pure helpers plus a real end-to-end run against a
 * spawned node --inspect-brk target. The e2e part is skipped when the protocol
 * is unavailable (no WebSocket in this runtime), never silently passing.
 */
import { urlRegexFor, toProtocolLine, fromProtocolLine, InspectorSession } from '../src/client/run/inspector.ts'
import { inspectHint } from '../src/client/run/inspect-hint.ts'
import { scriptUrlFor, workspaceRelativePath, workspaceAbsolutePath } from '../src/client/run/run-config.ts'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }

// --- line mapping ---
check('1-based line maps to 0-based', toProtocolLine(1) === 0 && toProtocolLine(2) === 1)
check('never negative', toProtocolLine(0) === 0)
check('0-based line maps back', fromProtocolLine(0) === 1 && fromProtocolLine(4) === 5)

// --- URL matching ---
const re = urlRegexFor('file:///tmp/a.mjs')
check('regex keeps only the path tail', re === 'tmp/a\\.mjs$', re)
check('matches the symlinked real URL', new RegExp(re).test('file:///private/tmp/a.mjs'))
check('rejects a different file', !new RegExp(re).test('file:///private/tmp/b.mjs'))
check('windows separators normalise', urlRegexFor('file:///C:\\w\\a.mjs') === 'w/a\\.mjs$', urlRegexFor('file:///C:\\w\\a.mjs'))

// --- Scheme A hint ---
check('hint names chrome://inspect', inspectHint('ws://127.0.0.1:9/x').includes('chrome://inspect'))
check('hint shows the ws url', inspectHint('ws://127.0.0.1:9/x').includes('ws://127.0.0.1:9/x'))
check('hint works without a url', inspectHint(undefined).includes('--inspect-brk'))

// --- path units crossing the IDE/host boundary ---
{
  const root = '/Users/me/proj'
  check('absolute file under root becomes relative', workspaceRelativePath(root + '/src/a.ts', root) === 'src/a.ts')
  check('trailing slash on the root is ignored', workspaceRelativePath(root + '//src/a.ts', root + '/') === 'src/a.ts')
  check('already-relative path is untouched', workspaceRelativePath('src/a.ts', root) === 'src/a.ts')
  check('a path outside the root is left for the host to reject',
    workspaceRelativePath('/elsewhere/a.ts', root) === '/elsewhere/a.ts')
  check('the root itself yields the empty path', workspaceRelativePath(root, root) === '')
  check('relative converts back to absolute', workspaceAbsolutePath('src/a.ts', root) === root + '/src/a.ts')
  check('absolute stays absolute', workspaceAbsolutePath(root + '/src/a.ts', root) === root + '/src/a.ts')
  // Breakpoints are addressed by file:// URL, built from the ABSOLUTE path.
  check('script url is built from the absolute path', scriptUrlFor(root + '/src/a.ts', root) === 'file://' + root + '/src/a.ts')
  check('script url from a relative path uses the root', scriptUrlFor('src/a.ts', root) === 'file://' + root + '/src/a.ts')
  check('an existing file:// url is left alone', scriptUrlFor('file:///tmp/a.mjs', root) === 'file:///tmp/a.mjs')
}

// --- source wiring ---
{
  const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
  const insp = src('src/client/run/inspector.ts')
  const hook = src('src/client/run/use-debugger.ts')
  const panel = src('src/client/run/DebugPanel.tsx')
  const host = src('src/index.ts')
  const view = src('src/client/run/RunView.tsx')
  // Behavioural ordering, not a bare substring search: the index of the FIRST
  // setBreakpoint call must precede the release, or a --inspect-brk target has
  // already parsed past the breakpoint lines.
  const firstSet = hook.indexOf('setBreakpoint')
  check('breakpoints register before release', firstSet >= 0 && firstSet < hook.indexOf('releaseForStart'))
  check('waiting target is released', insp.includes('runIfWaitingForDebugger'))
  check('frame evaluation uses evaluateOnCallFrame', insp.includes('Debugger.evaluateOnCallFrame'))
  // The host must pipe stderr (the address is read off it) rather than collect
  // it: a collect mode leaves handle.stderr undefined and the URL never arrives.
  check('host spawns node with --inspect-brk', /--inspect-brk=/.test(host))
  check("host pipes stderr for the inspector address", /stderr:\s*'pipe'/.test(host))
  check('empty ws url is rejected clearly', insp.includes('did not report an inspector address'))
  check('debug panel is mounted', view.includes('<DebugPanel') && panel.includes('ide-debug-console'))
  check('call stack frames are clickable', panel.includes('onOpenFrame'))
  // Session ownership: a foreign target id must be rejected, not terminated.
  check('debug targets record their owning session', /ownerSessionId/.test(host) && /ownedDebugTarget/.test(host))
  check('foreign targets are rejected', /no-such-debug-target/.test(host))
  check('plugin teardown kills debug targets', /debugTargets\.values\(\)/.test(host))
  // Path units: the IDE holds absolute paths, every host call wants relative.
  check('debug start converts to a workspace-relative path', /workspaceRelativePath\(path, cwd\)/.test(hook))
}

// --- live protocol run ---
{
  const file = '/tmp/dsh-debug-e2e.mjs'
  writeFileSync(file, 'function add(a,b){\n  const s = a + b\n  return s\n}\nsetInterval(()=>add(1,2), 700)\n')
  const port = 9700 + Math.floor(Math.random() * 100)
  const child = spawn(process.execPath, ['--inspect-brk=127.0.0.1:' + port, file], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d.toString() })
  let wsUrl
  for (let i = 0; i < 60 && !wsUrl; i += 1) {
    await new Promise((r) => setTimeout(r, 100))
    const m = /ws:\/\/\S+/.exec(stderr)
    if (m) wsUrl = m[0]
  }
  check('e2e: node reported an inspector url', wsUrl !== undefined)
  if (wsUrl !== undefined) {
    const pauses = []
    const session = await InspectorSession.connect(wsUrl)
    session.on({ paused: (e) => pauses.push(e.frames[0]) })
    await session.start()
    await session.setBreakpoint('file:///tmp/dsh-debug-e2e.mjs', 2)
    await session.releaseForStart()
    await new Promise((r) => setTimeout(r, 400))
    check('e2e: --inspect-brk pauses on start', pauses.length === 1)
    await session.resume()
    await new Promise((r) => setTimeout(r, 1400))
    const hit = pauses.at(-1)
    check('e2e: breakpoint hits the function', hit?.functionName === 'add', hit?.functionName)
    check('e2e: breakpoint hits line 2', hit?.lineNumber === 2, String(hit?.lineNumber))
    check('e2e: frame locals evaluate', (await session.evaluate('a + b', hit)) === '3')
    await session.stepOver()
    await new Promise((r) => setTimeout(r, 400))
    const stepped = pauses.at(-1)
    check('e2e: stepOver advances the line', stepped?.lineNumber === 3, String(stepped?.lineNumber))
    check('e2e: locals survive the step', (await session.evaluate('s', stepped)) === '3')
    await session.resume()
    await new Promise((r) => setTimeout(r, 1200))
    check('e2e: the loop re-hits the breakpoint', pauses.length >= 3, String(pauses.length))
    await session.removeBreakpoint('file:///tmp/dsh-debug-e2e.mjs', 2)
    session.close()
  }
  child.kill()
}

// --- host-side spawn: the IDE->host hop the CDP-only e2e above skips ---
//
// The e2e above connects straight to a node it started itself, so it never
// exercised debugOpen(): the absolute-path bug (the host resolves relative
// paths only) stayed green behind it. This block reproduces debugOpen's spawn
// shape against a REAL workspace and asserts the path + stderr contracts.
{
  const wsRoot = mkdtempSync(join(tmpdir(), 'dsh-debug-host-'))
  const scriptAbs = join(wsRoot, 'app.mjs')
  writeFileSync(scriptAbs, 'setInterval(() => {}, 1000)\n')

  // What the IDE holds (absolute) -> what the host receives (relative).
  const relPath = workspaceRelativePath(scriptAbs, wsRoot)
  check('host receives a relative path, not the tab path', relPath === 'app.mjs', relPath)
  // The host resolves workspace-relative paths against the root, so the
  // converted path must land on exactly the file the tab opened.
  check('the relative path resolves back to the same file', join(wsRoot, relPath) === scriptAbs)

  const port = 9800 + Math.floor(Math.random() * 100)
  const child = spawn(process.execPath, ['--inspect-brk=127.0.0.1:' + port, join(wsRoot, relPath)], {
    cwd: wsRoot,
    // Mirrors the host spec: stdin ignored, stderr PIPED (not collected), so
    // handle.stderr is a Readable the address can be parsed from.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d.toString() })
  let wsUrl
  for (let i = 0; i < 60 && !wsUrl; i += 1) {
    await new Promise((r) => setTimeout(r, 100))
    const m = /ws:\/\/\S+/.exec(stderr)
    if (m) wsUrl = m[0]
  }
  check('host spawn: the debuggee reports its inspector url', wsUrl !== undefined, stderr.slice(0, 200))
  if (wsUrl !== undefined) {
    const session = await InspectorSession.connect(wsUrl)
    await session.start()
    // Breakpoints travel as the file:// URL built from the absolute tab path.
    await session.setBreakpoint(scriptUrlFor(scriptAbs, wsRoot), 1)
    await session.releaseForStart()
    child.kill()
    session.close()
  } else {
    child.kill()
  }
  rmSync(wsRoot, { recursive: true, force: true })
}
console.log(failed === 0 ? '\nall debugger checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)