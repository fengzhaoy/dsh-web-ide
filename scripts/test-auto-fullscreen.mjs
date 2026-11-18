/**
 * Regression test for the right-sidebar IDE tab's auto-fullscreen gate
 * (run: node scripts/test-auto-fullscreen.mjs).
 *
 * Bug: the gate was latched per VISIBILITY EPISODE and cleared whenever
 * useTabInfo().tab.visible went false, so every switch back to the IDE tab
 * (start page, terminal tab, chat and back) clicked the panel's fullscreen
 * button again: exit fullscreen → switch away → switch back → fullscreen.
 *
 * The gate is now keyed on the tab OCCURRENCE (useTabInfo().tab.signal, minted
 * once per tab open by the sidebar-right controller): one auto-fullscreen per
 * open, and the occurrence is recorded even when the panel is already
 * fullscreen, so the user's first exit is not yanked back by a second click.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

let pass = 0
let fail = 0
async function test(name, fn) {
  try { await fn(); pass += 1; console.log('PASS ' + name) } catch (e) { fail += 1; console.log('FAIL ' + name + ': ' + (e && e.message ? e.message : e)) }
}

const idx = read('../src/client/index.ts')

await test('闸门按「一次打开」记:visible 转 false 不再清空闸门', () => {
  assert.doesNotMatch(idx, /forcedRef\.current = false/, '不再在 !visible 时把闸门清零')
  assert.match(idx, /if \(!visible\) return/, '本标签不可见时直接返回')
})

await test('打开标识用 useTabInfo().tab.signal(每次打开一个新的 AbortSignal)', () => {
  assert.match(idx, /signal\?: AbortSignal/, 'IdeTabInfo 声明可选的 signal')
  assert.match(idx, /const autoFullscreened = new WeakSet<AbortSignal>\(\)/, '模块级 WeakSet 记录已强制过的打开')
  assert.match(idx, /autoFullscreened\.has\(occurrence\)/, '已强制过的打开直接返回')
  assert.match(idx, /autoFullscreened\.add\(occurrence\)/, '首次可见时先记账')
  assert.match(idx, /\[visible, fullscreen, info\.tab\.signal\]/, 'effect 依赖里带上 tab.signal')
})

await test('面板已是全屏时打开标签:先记账再跳过点击(首次退出不再被弹回)', () => {
  const signed = idx.indexOf('autoFullscreened.add(occurrence)')
  const skip = idx.indexOf('if (fullscreen) return')
  const click = idx.indexOf('requestFullscreenPanel(ref.current)')
  assert.ok(signed > 0, '有记账语句')
  assert.ok(skip > signed, '记账发生在「已全屏」提前返回之前')
  assert.ok(click > skip, '仍通过 requestFullscreenPanel 点击面板全屏按钮')
})

await test('没有 tab.signal 的旧运行时:退回「一次挂载一次全屏」而不是每次切回都点', () => {
  assert.match(idx, /if \(forcedRef\.current\) return/, '挂载期回退闸门仍在')
})

console.log('\nSUMMARY pass=' + pass + ' fail=' + fail)
process.exit(fail === 0 ? 0 : 1)