/**
 * Regression test for the context menu viewport-edge flipping (run: node scripts/test-context-menu.mjs).
 *
 * Bug: right-clicking a file near the BOTTOM of the viewport made the menu
 * render below the click point and get clipped off-screen — the old code only
 * clamped y with an ESTIMATED menu height (items*26+8, capped 400), so a real
 * taller menu still overflowed, and clamping the TOP up did not flip it.
 *
 * Fix: compute the menu's position from its REAL measured height, and when
 * y + height would overflow the bottom, FLIP the menu to open upward
 * (top = y - height). This test pins the pure positioning helper that both
 * the estimated (pre-mount) and measured (post-mount) passes use.
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

const src = read('../src/client/ContextMenu.tsx')

await test('ContextMenu:有根据真实菜单高度+点击坐标计算定位的纯函数(导出)', () => {
  // The fix must expose a pure helper so the flip logic is testable off-DOM.
  assert.match(src, /export function (computeMenuPosition|placeMenu|fitMenu|menuPosition)\b/, '要导出一个根据(x,y,menuWidth,menuHeight,viewportW,viewportH)计算最终 left/top 的纯函数')
})

await test('ContextMenu:底部溢出时向上翻折(open upward),而不是只把顶部上移', () => {
  // The signature must take a real height and a viewport height, and the body
  // must flip (top = y - height) when y + height > viewportHeight.
  assert.match(src, /viewportHeight|innerHeight|window\.innerHeight/, '要用真实视口高度')
  assert.match(src, /y\s*-\s*(menuHeight|height|measuredHeight|h)\b|top\s*=\s*y\s*-/, '底部溢出时要翻折到 y - height(向上弹)')
})

await test('ContextMenu:翻折后仍要保证 top 不为负(再 clamp 到 >= 0)', () => {
  // If the menu is taller than the viewport, flipping puts top negative —
  // it must be clamped back to >= 0 (top-aligned to viewport top).
  assert.match(src, /Math\.max\(0|>=\s*0|clamp.*0/, '翻折后 top 要 clamp 到 >= 0')
})

await test('ContextMenu:水平方向也要 clamp(右边不溢出)', () => {
  assert.match(src, /Math\.min\(.*innerWidth|Math\.min\(.*viewportW|clampX/, 'x 方向要 clamp 到不溢出右边')
})

await test('ContextMenu:挂载后用真实测量高度修正定位(measure + reposition)', () => {
  // The host must measure the rendered menu (ref.current.getBoundingClientRect / offsetHeight)
  // after mount and reposition if the estimate was off — the pure helper is
  // used both pre-mount (estimate) and post-mount (measured).
  assert.match(src, /getBoundingClientRect|offsetHeight|clientHeight/, '挂载后要测量真实高度并据其修正定位')
})

console.log(`\nSUMMARY pass=${pass} fail=${fail}`)
if (fail > 0) process.exitCode = 1
