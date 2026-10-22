import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (r) => readFileSync(new URL(r, import.meta.url), 'utf8')
let pass = 0, fail = 0
async function test(name, fn){ try{ await fn(); pass++; console.log('PASS '+name) }catch(e){ fail++; console.log('FAIL '+name+': '+(e&&e.message?e.message:e)) } }
const idx = read('../src/index.ts')

await test('host:有 hasUpstream 辅助方法(检测当前分支上游)', () => {
  assert.match(idx, /private async hasUpstream\(/, '有 hasUpstream 私有方法')
  assert.match(idx, /rev-parse.*--abbrev-ref.*@\{u\}/, 'hasUpstream 用 git rev-parse --abbrev-ref @{u} 检测')
})

await test('host:有 publishBranch 辅助方法(push -u 发布分支)', () => {
  assert.match(idx, /private async publishBranch\(/, '有 publishBranch 私有方法')
  assert.match(idx, /push.*-u/, 'publishBranch 用 push -u')
})

await test('gitCommit:sync 模式先检查 upstream,有则 pull+push,无则 publish', () => {
  assert.match(idx, /opts\.sync[\s\S]*?hasUpstream[\s\S]*?pull[\s\S]*?push[\s\S]*?publishBranch/, 'gitCommit sync: hasUpstream ? pull+push : publishBranch')
})

await test('gitSync:sync 模式先检查 upstream,有则 pull+push,无则 publish', () => {
  assert.match(idx, /action === 'sync'[\s\S]*?hasUpstream[\s\S]*?pull[\s\S]*?push[\s\S]*?publishBranch/, 'gitSync sync: hasUpstream ? pull+push : publishBranch')
})

await test('gitSync:publish 模式直接走 publishBranch', () => {
  assert.match(idx, /action === 'sync'[\s\S]*?\} else \{[\s\S]*?publishBranch/, 'gitSync else 分支走 publishBranch')
})

console.log('\\nSUMMARY pass='+pass+' fail='+fail)
if (fail > 0) process.exitCode = 1