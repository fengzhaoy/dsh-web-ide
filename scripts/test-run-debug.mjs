import { readFileSync } from 'node:fs'
import { runCommandForFile, isRunnable, discoverTasks, quote } from '../src/client/run/run-config.ts'
import { parseProblems, classifyExit, stripAnsi, formatDuration, describeState } from '../src/client/run/task-output.ts'
let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }

// --- run current file ---
const run = (p) => runCommandForFile(p)
check('ts file runs through tsx', run('src/a.ts')?.command === 'npx tsx a.ts')
check('ts file runs from its own dir', run('src/a.ts')?.cwd === 'src')
check('root-level file has no cwd', run('a.ts')?.cwd === '')
check('python file uses python3', run('pkg/m.py')?.command === 'python3 m.py')
check('go file uses go run', run('cmd/m.go')?.command === 'go run m.go')
check('js file uses node', run('a.mjs')?.command === 'node a.mjs')
check('unknown extension is not runnable', run('a.md') === null)
check('isRunnable agrees', isRunnable('a.py') && !isRunnable('a.txt'))
check('simple paths are left unquoted', quote('src/a.ts') === 'src/a.ts')
check('paths with spaces are quoted', quote('a b/c.ts') === "'a b/c.ts'")

// --- task discovery ---
const files = {
  'package.json': JSON.stringify({ scripts: { dev: 'vite', build: 'tsc' } }),
  'Makefile': '# comment\n.PHONY: all\nall: build\nbuild:\n\ttsc\n',
  'Cargo.toml': '[package]\nname = "demo"\n\n[[bin]]\nname = "app"\n',
  'go.mod': 'module example.com/x\n',
  'pom.xml': '<project></project>',
}
const tasks = discoverTasks(files)
const ids = tasks.map((t) => t.id)
check('package scripts discovered', ids.includes('script:dev') && ids.includes('script:build'))
check('make targets discovered, .PHONY skipped', ids.includes('make:all') && ids.includes('make:build') && !ids.includes('make:.PHONY'), JSON.stringify(ids.filter(i=>i.startsWith('make:'))))
check('cargo bin discovered', ids.includes('cargo:bin:app'))
check('go targets discovered', ids.includes('go:run') && ids.includes('go:test'))
check('maven targets discovered', ids.includes('mvn:test'))
check('no duplicates', new Set(ids).size === ids.length)
check('broken package.json does not throw', discoverTasks({ 'package.json': '{oops' }).length === 0)
check('empty workspace yields nothing', discoverTasks({}).length === 0)

// --- output parsing ---
const p1 = parseProblems('src/a.ts(12,5): error TS2322: Type string is not assignable')
check('tsc paren form parsed', p1.length === 1 && p1[0].path === 'src/a.ts' && p1[0].line === 12 && p1[0].column === 5 && p1[0].severity === 'error')
const p2 = parseProblems('src/a.py:3:1: error: name not defined')
check('python form parsed', p2.length === 1 && p2[0].line === 3)
const p3 = parseProblems('src/a.c:7:9: warning: unused variable')
check('gcc warning parsed', p3.length === 1 && p3[0].severity === 'warning')
check('ansi codes are stripped', stripAnsi('\u001b[31merror\u001b[0m') === 'error')
check('plain noise is ignored', parseProblems('Compiling foo v0.1.0').length === 0)

// --- lifecycle ---
check('exit 0 succeeds', classifyExit(0, '', 1500).status === 'succeeded')
const f = classifyExit(2, '', 900)
check('non-zero fails with the code', f.status === 'failed' && f.exitCode === 2)
check('unknown exit + error text fails', classifyExit(null, 'Error: boom', 10).status === 'failed')
check('unknown exit + clean text succeeds', classifyExit(null, 'all good', 10).status === 'succeeded')
check('duration formatting', formatDuration(900) === '900ms' && formatDuration(1500) === '1.5s')

// --- localized state labels (README: 中/英双语界面) ---
{
  // A stand-in translator that echoes the key and its params, so the test
  // proves describeState goes THROUGH t() instead of returning English text.
  const fake = (key, params = {}) => key + JSON.stringify(params)
  check('succeeded is translated',
    describeState({ status: 'succeeded', durationMs: 1500 }, fake) === 'run.state.succeeded{"duration":"1.5s"}',
    describeState({ status: 'succeeded', durationMs: 1500 }, fake))
  const failed = describeState({ status: 'failed', exitCode: 2, durationMs: 900 }, fake)
  check('failed carries the exit code and duration', failed === 'run.state.failed{"code":2,"duration":"900ms"}', failed)
  check('failed without an exit code uses its own key',
    describeState({ status: 'failed', exitCode: null, durationMs: 900 }, fake) === 'run.state.failedNoCode{"duration":"900ms"}')
  check('cancelled is translated', describeState({ status: 'cancelled' }, fake) === 'run.state.cancelled{}')
  // No hard-coded English may leak out of the pure module.
  check('describeState returns nothing without t()',
    describeState({ status: 'succeeded', durationMs: 1500 }, () => '') === '')
}


// --- UI wiring: the features must actually be reachable from the IDE ---
{
  const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
  const ide = src('src/client/IdeView.tsx')
  const runView = src('src/client/run/RunView.tsx')
  const runner = src('src/client/run/use-task-runner.ts')
  const term = src('src/client/terminal/TerminalPanel.tsx')
  const loc = src('src/client/locales.ts')

  check('P0-1 run-current-file command is registered', /ide\.runFile/.test(ide))
  check('P0-1 editor context menu offers Run', /id: 'run-file', label: t\('command\.runFile'\)/.test(ide))
  check('P0-2 the runner tracks exit codes', /classifyExit/.test(runner))
  check('P0-2 failures surface as notifications', /notifications\.error\(t\('task\.failed'/.test(runner))
  check('P0-3 recents are recorded and listed', /rememberTask/.test(ide) && /recentTasks/.test(ide))
  check('P1-4 manifests are scanned', /MANIFEST_FILES/.test(ide) && /discoverTasks/.test(ide))
  check('P1-5 run problems merge into the panel', /mergeProblems/.test(ide) && /allProblems/.test(ide))
  check('P1-6 problem rows open the file', /onOpen=\{\(path, line\)/.test(ide))
  check('P1-7 terminal menu can copy a selection', /term\.getSelection\(\)/.test(term))
  check('P2-8 run view is mounted', /<RunView/.test(ide) && /ide-runview/.test(runView))
  check('P2-8 activity bar opens the run view', /data-testid="ide-activitybar-run"/.test(ide))
  check('P2-9 breakpoints paint glyph decorations', /ide-breakpoint-glyph/.test(ide))
  check('P2-9 clicking the gutter toggles a breakpoint', /toggleBreakpoint/.test(ide))
  check('P2-10 output panel shows the run log', /runview-run/.test(runView))
  for (const key of ['run.sectionTasks', 'run.sectionBreakpoints', 'task.failed', 'terminal.copy', 'terminal.paste', 'command.runFile',
    'run.state.running', 'run.state.succeeded', 'run.state.failed', 'run.state.failedNoCode', 'run.state.cancelled']) {
    check('locale ' + key + ' has zh + en', loc.split("'" + key + "'").length - 1 === 2)
  }
  // Labels may not promise keys that no command registers (F5/F9 were advertised
  // in tooltips before any keybinding existed).
  check('debug tooltips do not advertise an unbound key',
    !/'debug\.(resume|stepOver)': '[^']*F5/.test(loc) || /ideKeybindings|F5/.test(ide))
  // The run panel's file path and cwd cross to the host: both must be relative.
  check('run-current-file converts the tab path', /runCommandForFile\(target, cwd\)/.test(ide))
  check('run-current-file does not pass a bare absolute path', !/runCommandForFile\(target\)/.test(ide))
}
console.log(failed === 0 ? '\nall run-debug checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)