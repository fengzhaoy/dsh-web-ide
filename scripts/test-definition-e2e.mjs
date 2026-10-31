/**
 * End-to-end check of the declaration index against a real workspace:
 * runs ripgrep exactly the way the host's search Remote does (ONE --glob=
 * argument), then verifies each language resolves to the right file:line:col.
 *
 *   RG_BIN=/path/to/rg node --experimental-strip-types scripts/test-definition-e2e.mjs
 *
 * Skips (exit 0) when ripgrep cannot be found, so it never fails a machine
 * that merely lacks the binary.
 */
import { definitionsFromHits, searchIncludeFor } from '../src/client/editor/definition.ts'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

const RG = process.env.RG_BIN ?? 'rg'
const ROOT = '/tmp/dsh-def-e2e'

const FIXTURES = {
  'src/app.ts': 'export function runTask(a: number): number {\n  return a + 1\n}\n\nconst call = runTask(2)\n',
  'src/server.go': 'package main\n\nfunc (s *Server) HandleRequest(id int) error {\n\treturn nil\n}\n\ntype Server struct {\n\tport int\n}\n',
  'src/util.py': 'def compute_total(items):\n    return sum(items)\n\nclass Calculator:\n    def run(self, items):\n        return compute_total(items)\n',
  'src/Main.java': 'public class Main {\n    public void runTask(int a) {\n    }\n    public static void main(String[] a) {\n        new Main().runTask(1);\n    }\n}\n',
  'src/lib.rs': 'pub fn run_task(a: u32) -> u32 {\n    a + 1\n}\n\npub struct Engine {\n    pub id: u32,\n}\n',
}

rmSync(ROOT, { recursive: true, force: true })
for (const [rel, body] of Object.entries(FIXTURES)) {
  const abs = ROOT + '/' + rel
  mkdirSync(abs.slice(0, abs.lastIndexOf('/')), { recursive: true })
  writeFileSync(abs, body)
}

function grep(pattern, include) {
  const args = ['--json', '--regexp=' + pattern]
  if (include !== undefined) args.push('--glob=' + include)
  args.push('--', '.')
  let out = ''
  try { out = execFileSync(RG, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }) } catch (e) { out = e.stdout ?? '' }
  const hits = []
  for (const row of out.split('\n')) {
    if (row === '') continue
    let rec
    try { rec = JSON.parse(row) } catch { continue }
    if (rec.type !== 'match') continue
    hits.push({
      path: ROOT + '/' + rec.data.path.text.replace(/^\.\//, ''),
      lineNumber: rec.data.line_number,
      line: rec.data.lines.text.replace(/\r?\n$/, ''),
    })
  }
  return hits
}

let rgAvailable = true
try { execFileSync(RG, ['--version'], { stdio: 'ignore' }) } catch { rgAvailable = false }
if (!rgAvailable) {
  console.log('skipped: ripgrep not found (set RG_BIN to point at it)')
  process.exit(0)
}

const CASES = [
  { language: 'typescript', name: 'runTask', file: 'app.ts', line: 1, column: 17 },
  { language: 'go', name: 'HandleRequest', file: 'server.go', line: 3, column: 18 },
  { language: 'python', name: 'compute_total', file: 'util.py', line: 1, column: 5 },
  { language: 'java', name: 'runTask', file: 'Main.java', line: 2, column: 17 },
  { language: 'rust', name: 'run_task', file: 'lib.rs', line: 1, column: 8 },
  { language: 'rust', name: 'Engine', file: 'lib.rs', line: 5, column: 12 },
]

let failed = 0
for (const c of CASES) {
  const hits = grep(c.name, searchIncludeFor(c.language))
  const defs = definitionsFromHits(hits, c.name, c.language, ROOT)
  const hit = defs.find((d) => d.path.endsWith('/' + c.file))
  const ok = hit !== undefined && hit.line === c.line && hit.column === c.column
  if (!ok) failed += 1
  const found = hit === undefined ? 'not found' : hit.line + ':' + hit.column
  console.log((ok ? 'ok   ' : 'FAIL ') + c.language.padEnd(11) + c.name.padEnd(15) + 'expected ' + c.file + ':' + c.line + ':' + c.column + '  got ' + found)
  if (!ok) for (const d of defs) console.log('        candidate', d.path.replace(ROOT + '/', '') + ':' + d.line + ':' + d.column)
}

rmSync(ROOT, { recursive: true, force: true })
console.log(failed === 0 ? '\nall end-to-end definition lookups passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)