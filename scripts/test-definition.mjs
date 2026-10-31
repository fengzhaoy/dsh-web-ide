/**
 * Declaration-grammar tests for Go-to-Definition.
 * Run: node --experimental-strip-types scripts/test-definition.mjs
 */
import { symbolAt, definitionsFromHits, supportsDefinition, hasLanguageService } from '../src/client/editor/definition.ts'

let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed += 1
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -> ' + detail))
}

const hit = (line, lineNumber = 1, path = '/w/a.ts') => ({ path, lineNumber, line })
const declares = (language, line, name) => definitionsFromHits([hit(line)], name, language, '/w').length > 0

// ── symbol extraction ───────────────────────────────────────────────────
{
  const s = symbolAt('const x = foo.bar(1)', 12)
  check('picks the identifier under the caret', s?.name === 'bar', JSON.stringify(s))
  check('keeps the member chain', s?.chain === 'foo.bar', JSON.stringify(s))
  check('caret right after an identifier belongs to it', symbolAt('call()', 5)?.name === 'call')
  check('whitespace yields no symbol', symbolAt('a  b', 3) === null)
}

// ── TypeScript ──────────────────────────────────────────────────────────
check('ts: function decl', declares('typescript', 'export function runTask(a: number) {', 'runTask'))
check('ts: const arrow', declares('typescript', 'const runTask = async (a) => {', 'runTask'))
check('ts: class', declares('typescript', 'export class Runner {', 'Runner'))
check('ts: interface', declares('typescript', 'interface Options {', 'Options'))
check('ts: type alias', declares('typescript', 'type Id = string', 'Id'))
check('ts: method', declares('typescript', '  private async load(x: string) {', 'load'))
check('ts: call is NOT a decl', !declares('typescript', '  await runTask(1)', 'runTask'))
check('ts: member call is NOT a decl', !declares('typescript', '  this.load(x)', 'load'))
check('ts: assignment is NOT a decl', !declares('typescript', 'value = runTask', 'runTask'))

// ── Python ──────────────────────────────────────────────────────────────
check('py: def', declares('python', 'def run_task(a):', 'run_task'))
check('py: async def', declares('python', 'async def run_task(a):', 'run_task'))
check('py: class', declares('python', 'class Runner(Base):', 'Runner'))
check('py: call is NOT a decl', !declares('python', '    run_task(1)', 'run_task'))

// ── Go ──────────────────────────────────────────────────────────────────
check('go: func', declares('go', 'func RunTask(a int) error {', 'RunTask'))
check('go: method with receiver', declares('go', 'func (s *Server) RunTask(a int) error {', 'RunTask'))
check('go: type struct', declares('go', 'type Server struct {', 'Server'))
check('go: call is NOT a decl', !declares('go', '\terr := RunTask(1)', 'RunTask'))

// ── Rust ────────────────────────────────────────────────────────────────
check('rs: fn', declares('rust', 'pub fn run_task(a: u32) -> Result<()> {', 'run_task'))
check('rs: struct', declares('rust', 'pub struct Server {', 'Server'))
check('rs: impl block', declares('rust', 'impl Server {', 'Server'))
check('rs: call is NOT a decl', !declares('rust', '    run_task(1)?;', 'run_task'))

// ── Java ────────────────────────────────────────────────────────────────
check('java: class', declares('java', 'public class Server {', 'Server'))
check('java: method', declares('java', '    public void runTask(int a) {', 'runTask'))
check('java: call is NOT a decl', !declares('java', '        runTask(1);', 'runTask'))

// ── other languages ─────────────────────────────────────────────────────
check('kt: fun', declares('kotlin', 'fun runTask(a: Int) {', 'runTask'))
check('swift: func', declares('swift', 'func runTask(_ a: Int) {', 'runTask'))
check('rb: def', declares('ruby', 'def run_task(a)', 'run_task'))
check('php: function', declares('php', 'function runTask($a) {', 'runTask'))
check('c: struct', declares('c', 'struct Server {', 'Server'))
check('cpp: class', declares('cpp', 'class Server {', 'Server'))
check('cs: class', declares('csharp', 'public class Server {', 'Server'))

// ── ranking & support ───────────────────────────────────────────────────
{
  const hits = [
    hit('  runTask(1)', 5, '/w/src/a.test.ts'),
    hit('export function runTask() {', 3, '/w/src/a.ts'),
  ]
  const r = definitionsFromHits(hits, 'runTask', 'typescript', '/w')
  check('drops the call site', r.length === 1, JSON.stringify(r))
  check('keeps the declaration', r[0]?.path === '/w/src/a.ts')
  check('column points at the name', r[0]?.column === 17, JSON.stringify(r[0]))
}
{
  const hits = [
    hit('export function runTask() {', 3, '/w/src/a.test.ts'),
    hit('export function runTask() {', 3, '/w/src/a.ts'),
  ]
  const r = definitionsFromHits(hits, 'runTask', 'typescript', '/w')
  check('prefers non-test files', r[0]?.path === '/w/src/a.ts', JSON.stringify(r))
}
check('supports the requested languages', ['typescript','javascript','python','go','rust','java'].every(supportsDefinition))
check('does not claim plaintext', !supportsDefinition('plaintext'))
check('typescript has a language service', hasLanguageService('typescript') && hasLanguageService('javascript'))
check('go has no language service', !hasLanguageService('go'))


// ── search glob shape ──────────────────────────────────────────────────
// Regression: ripgrep applies --glob entries in order and a trailing
// '!pattern' turns the whole list into an exclusion, so the include union
// must come LAST. Getting this wrong silently produced zero hits everywhere.
import { searchIncludeFor } from '../src/client/editor/definition.ts'
{
  const inc = searchIncludeFor('go')
  check('include ends with the positive glob', inc.endsWith('{**/*.go}'), inc)
  check('excludes precede the include', inc.startsWith('!**/node_modules/**'), inc)
  const positives = inc.split(',').filter((g) => !g.startsWith('!'))
  check('exactly one positive glob entry', positives.length === 1, JSON.stringify(positives))
  check('single extension is still braced', inc.includes('{**/*.go}'))
  const ts = searchIncludeFor('typescript')
  check('multi-extension include is one brace group', ts.includes('{**/*.ts,**/*.tsx'), ts)
  check('no lone negation inside braces', !ts.includes(',!') || ts.indexOf('},!') !== -1 || !/\{,[^}]*!/.test(ts))
  check('plaintext has no include', searchIncludeFor('plaintext') === undefined)
}

// ── Java regressions found on a real project (fms-account-info, 1241 files)
// `return new X();` is an instance expression, not a declaration of X.
{
  const hits = [{ path: '/w/NewRedisConfig.java', lineNumber: 182, line: '        return new RedisService();' }]
  const defs = definitionsFromHits(hits, 'RedisService', 'java', '/w')
  check('java: `return new X();` is not a declaration', defs.length === 0, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/A.java', lineNumber: 1, line: '        Foo f = new Foo();' }]
  const defs = definitionsFromHits(hits, 'Foo', 'java', '/w')
  check('java: `X x = new X();` is not a declaration', defs.length === 0, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/R.java', lineNumber: 31, line: 'public class RedisService {' }]
  const defs = definitionsFromHits(hits, 'RedisService', 'java', '/w')
  check('java: real class declaration still resolves', defs.length === 1 && defs[0].line === 31, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/R.java', lineNumber: 88, line: '//        return new RedisService();' },
                { path: '/w/S.java', lineNumber: 31, line: 'public class RedisService {' }]
  const defs = definitionsFromHits(hits, 'RedisService', 'java', '/w')
  check('java: commented-out line is skipped', defs.length === 1 && defs[0].line === 31, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/Retryer.java', lineNumber: 101, line: '/*String result = retryer.execute(() -> test("test"), null, e -> {' }]
  const defs = definitionsFromHits(hits, 'test', 'java', '/w')
  check('java: commented-out call is not a definition', defs.length === 0, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/S.java', lineNumber: 19, line: '    void advertiserRefund(AdContractRefundReqDTO dto);' }]
  const defs = definitionsFromHits(hits, 'advertiserRefund', 'java', '/w')
  check('java: interface method declaration resolves', defs.length === 1 && defs[0].column === 10, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/C.java', lineNumber: 57, line: '    public ApiResult<String> advertiserRefund(@RequestBody @Valid AdContractRefundReqDTO dto) {' }]
  const defs = definitionsFromHits(hits, 'advertiserRefund', 'java', '/w')
  check('java: annotated public method resolves', defs.length === 1, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/M.java', lineNumber: 18, line: '    String getAdvertiserUid(@Param("dto") AdvertiserConsumeReqDTO dto);' }]
  const defs = definitionsFromHits(hits, 'getAdvertiserUid', 'java', '/w')
  check('java: mapper method resolves', defs.length === 1, JSON.stringify(defs))
}

// ── Go regressions found on a real project (ginadmin, 71 files)
{
  const hits = [{ path: '/w/pkg/uploader/default.go', lineNumber: 6, line: '\tSave(file *multipart.FileHeader, dst string) (string, error)' }]
  const defs = definitionsFromHits(hits, 'Save', 'go', '/w')
  check('go: interface method declaration resolves', defs.length === 1, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/main.go', lineNumber: 36, line: '\tshowLogo()' }]
  const defs = definitionsFromHits(hits, 'showLogo', 'go', '/w')
  check('go: bare no-arg call is not a declaration', defs.length === 0, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/a.go', lineNumber: 1, line: '\tfoo(1)' }]
  const defs = definitionsFromHits(hits, 'foo', 'go', '/w')
  check('go: untyped-arg call is not a declaration', defs.length === 0, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/i.go', lineNumber: 6, line: '\tClose() error' }]
  const defs = definitionsFromHits(hits, 'Close', 'go', '/w')
  check('go: no-arg interface method with result resolves', defs.length === 1, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/m.go', lineNumber: 48, line: 'func (user *User) TableName() string {' }]
  const defs = definitionsFromHits(hits, 'TableName', 'go', '/w')
  check('go: receiver method resolves', defs.length === 1 && defs[0].column === 19, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/s.go', lineNumber: 20, line: 'type AdminTestSuite struct {' }]
  const defs = definitionsFromHits(hits, 'AdminTestSuite', 'go', '/w')
  check('go: struct type resolves', defs.length === 1, JSON.stringify(defs))
}
// ── Python regressions found on a real project (MaxKB, 1005 files)
{
  const hits = [{ path: '/w/tool.py', lineNumber: 89, line: '    def find_class(self, folder, name):' }]
  const defs = definitionsFromHits(hits, 'find_class', 'python', '/w')
  check('python: indented method resolves with exact column', defs.length === 1 && defs[0].column === 9, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/stt.py', lineNumber: 125, line: '    async def send_audio(self, ws, audio_file):' }]
  const defs = definitionsFromHits(hits, 'send_audio', 'python', '/w')
  check('python: async def resolves', defs.length === 1 && defs[0].column === 15, JSON.stringify(defs))
}
{
  const hits = [{ path: '/w/m.py', lineNumber: 17, line: 'class ToolWorkflow(AppModelMixin):' }]
  const defs = definitionsFromHits(hits, 'ToolWorkflow', 'python', '/w')
  check('python: class with bases resolves', defs.length === 1 && defs[0].column === 7, JSON.stringify(defs))
}

// ── Defects found by code review, kept as regressions ──
// Rust: `impl Level for X` implements the trait, it does not declare it.
{
  const hits = [{ path: '/w/a.rs', lineNumber: 1, line: 'impl Level for MyStruct {' }]
  check('rust: trait impl is not a declaration', definitionsFromHits(hits, 'Level', 'rust', '/w').length === 0)
}
{
  const hits = [{ path: '/w/a.rs', lineNumber: 1, line: 'impl<T: Clone> Level<T> for X {' }]
  check('rust: generic trait impl is not a declaration', definitionsFromHits(hits, 'Level', 'rust', '/w').length === 0)
}
{
  const hits = [{ path: '/w/a.rs', lineNumber: 1, line: 'impl Default for Level {' }]
  check('rust: `impl Default for X` is not a declaration', definitionsFromHits(hits, 'Level', 'rust', '/w').length === 0)
}
{
  const hits = [{ path: '/w/a.rs', lineNumber: 1, line: 'pub trait Level {' }]
  check('rust: trait declaration still resolves', definitionsFromHits(hits, 'Level', 'rust', '/w').length === 1)
}
// TS: an indented `name(args) {` is an object-literal method, not a call.
{
  const hits = [{ path: '/w/a.ts', lineNumber: 1, line: '  bar(x) {' }]
  check('ts: object-literal method resolves', definitionsFromHits(hits, 'bar', 'typescript', '/w').length === 1)
}
{
  for (const [line, lbl] of [['  bar(x)', 'indented call'], ['foo(1)', 'bare call'], ['  const y = bar(1)', 'assignment call']]) {
    const hits = [{ path: '/w/a.ts', lineNumber: 1, line }]
    check('ts: ' + lbl + ' is not a declaration', definitionsFromHits(hits, 'bar', 'typescript', '/w').length === 0, line)
  }
  const hits = [{ path: '/w/a.ts', lineNumber: 1, line: '  if (bar(1)) {' }]
  check('ts: if-call is not a declaration', definitionsFromHits(hits, 'bar', 'typescript', '/w').length === 0)
}
{
  for (const line of ['  for (;;) {', '  while (x) {']) {
    const name = line.trim().split(' ')[0]
    const hits = [{ path: '/w/a.ts', lineNumber: 1, line }]
    check('ts: control keyword "' + name + '" is not a declaration', definitionsFromHits(hits, name, 'typescript', '/w').length === 0, line)
  }
}
// C/C++: qualified and arrow calls are calls, not declarations.
{
  for (const line of ['  net.test();', '  redis.run();', '  obj->run();']) {
    const name = /(?:net|redis|obj)(?:\.|->)(\w+)/.exec(line)?.[1] ?? ''
    const hits = [{ path: '/w/a.c', lineNumber: 1, line }]
    check('c: "' + name + '" via member access is not a declaration', definitionsFromHits(hits, name, 'c', '/w').length === 0, line)
  }
  const hits = [{ path: '/w/a.c', lineNumber: 1, line: 'void HandleRequest(int fd) {' }]
  check('c: real declaration still resolves', definitionsFromHits(hits, 'HandleRequest', 'c', '/w').length === 1)
}
console.log(failed === 0 ? '\nall definition checks passed' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)