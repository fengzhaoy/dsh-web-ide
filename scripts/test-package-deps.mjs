/**
 * Regression test for package.json @deepseek-ai dependency hygiene (run: node scripts/test-package-deps.mjs).
 *
 * The plugin used to list 7 @deepseek-ai/* packages in BOTH peerDependencies
 * and devDependencies (14 declarations, identical versions written twice) plus
 * a peerDependenciesMeta marking them all optional. The reference project
 * (dsh-code-server-app) lists NONE of them in peerDependencies — DSH host
 * packages are provided by the host at runtime and resolved external by the
 * bundler (tsdown.config.ts: /^@deepseek-ai\// → external). The only version
 * gate the plugin needs is dsh.env.minVersion. devDependencies keeps the
 * build-time copies (TypeScript needs them for type resolution / .d.ts gen).
 *
 * This test pins the cleaned shape so the duplication / unnecessary peer
 * declarations do not creep back.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

let pass = 0
let fail = 0
async function test(name, fn) {
  try {
    await fn()
    pass += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    fail += 1
    console.log(`FAIL ${name}: ${error && error.message ? error.message : error}`)
  }
}

const pkg = JSON.parse(read('../package.json'))
const dsPeer = Object.keys(pkg.peerDependencies || {}).filter((k) => k.startsWith('@deepseek-ai/'))
const dsDev = Object.keys(pkg.devDependencies || {}).filter((k) => k.startsWith('@deepseek-ai/'))
const dsPeerMeta = Object.keys(pkg.peerDependenciesMeta || {}).filter((k) => k.startsWith('@deepseek-ai/'))

await test('package.json:peerDependencies 不再声明任何 @deepseek-ai/* (宿主提供,参考项目约定)', () => {
  assert.deepEqual(dsPeer, [], 'peerDependencies 里不应有任何 @deepseek-ai/* 条目,实际: ' + JSON.stringify(dsPeer))
})

await test('package.json:peerDependenciesMeta 不再为 @deepseek-ai/* 留 optional 标记', () => {
  assert.deepEqual(dsPeerMeta, [], 'peerDependenciesMeta 里不应有任何 @deepseek-ai/* 条目,实际: ' + JSON.stringify(dsPeerMeta))
})

await test('package.json:dsh.env.minVersion 声明了最小宿主版本(统一版本门禁)', () => {
  assert.ok(pkg.dsh && typeof pkg.dsh.env === 'object' && typeof pkg.dsh.env.minVersion === 'string' && pkg.dsh.env.minVersion.length > 0, 'dsh.env.minVersion 必须是声明最小宿主版本的非空字符串')
  assert.match(pkg.dsh.env.minVersion, /0\.2\.0-rc\.2/, 'minVersion 应为 0.2.0-rc.2(与参考项目对齐)')
})

await test('package.json:devDependencies 保留构建期 @deepseek-ai/* (tsdown 类型解析需要)', () => {
  // These are imported as runtime VALUES in src/index.ts (typert-protocol,
  // schemastery, dsh-llm, dsh-util-values, dsh-tool-fs-search) — the build
  // needs them installed for type resolution. cordis is import-type only but
  // kept for the Context type. dsh-subprocess is inline-type-only and SHOULD
  // be dropped from dev too (see next test).
  const must = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-util-values', '@deepseek-ai/dsh-tool-fs-search']
  const missing = must.filter((k) => !dsDev.includes(k))
  assert.deepEqual(missing, [], '构建期必需的 @deepseek-ai/* 仍要在 devDependencies: ' + JSON.stringify(missing))
})

await test('package.json:@deepseek-ai/dsh-subprocess 从 peerDependencies 移除(仅内联类型,宿主提供)', () => {
  // src/index.ts uses it only as import('...').SubprocessHandle (inline type,
  // erased at build). No runtime value import, no inject — so it must NOT be
  // a peer dependency (host provides it). It stays in devDependencies for
  // type resolution (it is today a transitive dep of dsh-tool-fs-search, but
  // declaring it directly keeps the type resolvable if that chain changes).
  assert.ok(!dsPeer.includes('@deepseek-ai/dsh-subprocess'), 'dsh-subprocess 不应在 peerDependencies(仅内联类型,宿主提供)')
  assert.ok(dsDev.includes('@deepseek-ai/dsh-subprocess'), 'dsh-subprocess 保留在 devDependencies(类型解析需要)')
})

await test('package.json:@deepseek-ai 版本号只在 devDependencies 写一次(不再 peer/dev 重复)', () => {
  // After dropping peerDependencies entries, each @deepseek-ai/* version is
  // declared exactly once (in devDependencies). No peer copy remains.
  for (const k of dsDev) {
    assert.ok(!(pkg.peerDependencies || {})[k], k + ' 不应同时在 peerDependencies 和 devDependencies 出现')
  }
})

console.log(`\nSUMMARY pass=${pass} fail=${fail}`)
if (fail > 0) process.exitCode = 1
