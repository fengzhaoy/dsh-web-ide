/**
 * Regression test for the host-face typert manifest the package exports under
 * "./typert" (run: node scripts/test-typert-manifest.mjs).
 *
 * dsh-typert-loader validates this manifest at boot and treats one malformed
 * codec as a fatal plugin-tree error — `dsh web` dies before serving anything.
 * The loader requires every codec to be a STRICT codec carrying a `create()`
 * factory; the older `{ mode, typeSymbol, schema }` shape is rejected with
 * "parameter codec has no create() factory" (2026-09-19).
 *
 * Because the artifact is built (lib/ is gitignored), the real hazard is drift:
 * src/typert.host.ts is updated but `pnpm run bundle` never runs, so the loader
 * keeps reading a stale lib/typert.host.js. These assertions pin the codec shape
 * AND that the built artifact actually reflects the current source.
 */
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', PKG_ROOT), 'utf8'))

const failures = []
const checks = []
const ok = (label) => checks.push(label)
const fail = (label, detail) => failures.push(`${label}\n    ${detail}`)

/* Mirror of dsh-typert-loader's requireStrictCodec — the exact check that
 * rejected the stale build. Kept local so the test runs without the loader. */
function checkStrictCodec(codec, subject) {
  if (typeof codec !== 'object' || codec === null || Array.isArray(codec)) return `${subject} must be an object`
  if (codec.mode !== 'strict') return `${subject} must use a strict codec`
  if (typeof codec.typeSymbol !== 'string' || codec.typeSymbol.length === 0) return `${subject} has a missing or empty typeSymbol`
  if (typeof codec.create !== 'function') return `${subject} has no create() factory`
  if ('schema' in codec) return `${subject} carries a legacy schema property — the loader only calls create()`
  return null
}

/* --- A. the exported artifact must exist and import ---------------------- */
const exportRel = pkg.exports?.['./typert']
const exportPath = typeof exportRel === 'string' ? exportRel : exportRel?.default
if (typeof exportPath !== 'string') {
  fail('package.json exports "./typert"', `expected a string or { default } path, got ${JSON.stringify(exportRel)}`)
}

const artifactAbs = exportPath === undefined ? undefined : fileURLToPath(new URL(exportPath, PKG_ROOT))
let TYPERT
if (artifactAbs !== undefined) {
  try {
    ;({ TYPERT } = await import(artifactAbs))
    ok(`built manifest imports (${exportPath})`)
  } catch (cause) {
    fail(`built manifest imports (${exportPath})`, `is lib/ built? run \`pnpm run bundle\` — ${String(cause)}`)
  }
}

/* --- B. artifact reflects the current source (drift guard) --------------- */
const SRC = fileURLToPath(new URL('src/typert.host.ts', PKG_ROOT))
if (artifactAbs !== undefined && TYPERT !== undefined) {
  let artifactMtime
  try {
    artifactMtime = statSync(artifactAbs).mtimeMs
  } catch { /* import succeeded, so a missing stat is odd but not worth failing twice */ }
  const srcMtime = statSync(SRC).mtimeMs
  if (artifactMtime !== undefined && srcMtime > artifactMtime + 1000) {
    fail('built manifest is newer than src/typert.host.ts',
      `${exportPath} is stale (${new Date(artifactMtime).toISOString()} < src ${new Date(srcMtime).toISOString()}) — run \`pnpm run bundle\``)
  } else {
    ok('built manifest is not older than src/typert.host.ts')
  }

  const srcInvocations = new Set(
    [...readFileSync(SRC, 'utf8').matchAll(/id:\s*'([^']*#[^']*)'/g)].map((m) => m[1]),
  )
  const artifactInvocations = new Set((TYPERT.invocations ?? []).map((inv) => inv.id))
  const missing = [...srcInvocations].filter((id) => !artifactInvocations.has(id))
  const extra = [...artifactInvocations].filter((id) => !srcInvocations.has(id))
  if (missing.length > 0 || extra.length > 0) {
    fail('built invocation ids match src/typert.host.ts',
      `missing from lib: [${missing}]; not in src: [${extra}] — run \`pnpm run bundle\``)
  } else {
    ok(`invocation ids match src (${artifactInvocations.size})`)
  }
}

/* --- C. every codec passes the loader's strict-codec rules --------------- */
if (TYPERT !== undefined) {
  if (TYPERT.package !== pkg.name) fail('manifest package name', `TYPERT.package is ${TYPERT.package}, package.json says ${pkg.name}`)
  if (TYPERT.face !== 'host') fail('manifest face', `expected "host", got ${TYPERT.face}`)

  const codecProblems = []
  let codecCount = 0
  for (const inv of TYPERT.invocations ?? []) {
    const id = inv.id ?? '<invocation without id>'
    if (inv.cancellation?.parameter !== 'signal') codecProblems.push(`${id} cancellation parameter must be "signal"`)
    for (const [i, param] of (inv.parameters ?? []).entries()) {
      if (param.source !== 'json' && param.source !== 'lookup') codecProblems.push(`${id} parameter[${i}] source must be "json" or "lookup"`)
      codecCount += 1
      const problem = checkStrictCodec(param.codec, `${id} parameter[${i}] "${param.name}" codec`)
      if (problem !== null) codecProblems.push(problem)
    }
    codecCount += 1
    const problem = checkStrictCodec(inv.result, `${id} result codec`)
    if (problem !== null) codecProblems.push(problem)
    if (inv.invocation?.kind === 'context') {
      codecCount += 1
      const receiverProblem = checkStrictCodec(inv.invocation.codec, `${id} Context receiver codec`)
      if (receiverProblem !== null) codecProblems.push(receiverProblem)
    }
  }

  if (codecProblems.length > 0) {
    fail('every codec is a strict codec with create()',
      `${codecProblems.length} problem(s):\n      - ${codecProblems.join('\n      - ')}`)
  } else {
    ok(`every codec is a strict codec with create() (${codecCount} codecs)`)
  }

  /* --- D. best effort: run the loader's own validator when resolvable ---- */
  const validator = await loadRealValidator()
  if (validator === undefined) {
    console.log('note: @deepseek-ai/dsh-typert-loader is not resolvable here — used the local mirror of its checks')
  } else {
    try {
      validator(pkg.name, TYPERT)
      ok('dsh-typert-loader validateTypertManifest accepts the artifact')
    } catch (cause) {
      fail('dsh-typert-loader validateTypertManifest accepts the artifact', String(cause?.message ?? cause))
    }
  }
}

async function loadRealValidator() {
  const candidates = [import.meta.url]
  try {
    const dshBin = process.env.DSH_BIN ?? 'dsh'
    const { execFileSync } = await import('node:child_process')
    const real = execFileSync('sh', ['-c', `command -v ${dshBin}`], { encoding: 'utf8' }).trim()
    if (real !== '') candidates.push(new URL(`file://${real}`).href)
  } catch { /* dsh not on PATH — the mirror above still covers the codec rules */ }
  for (const base of candidates) {
    try {
      const require = createRequire(base)
      const mod = require('@deepseek-ai/dsh-typert-loader')
      if (typeof mod.validateTypertManifest === 'function') return mod.validateTypertManifest
    } catch { /* try the next base */ }
  }
  return undefined
}

/* --- report ------------------------------------------------------------- */
for (const label of checks) console.log(`ok   ${label}`)
if (failures.length > 0) {
  console.error(`\nFAIL (${failures.length}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`\nall ${checks.length} typert manifest checks passed`)
