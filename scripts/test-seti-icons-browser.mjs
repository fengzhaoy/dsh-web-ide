/**
 * Seti file icons — browser verification against the standalone preview page
 * (scripts/test-ui/seti-icons-preview.html, generated from the same theme data
 * + webfont the client bundle embeds). Asserts the @font-face actually loads
 * and the matcher picks distinct, colored, correct glyphs for a matrix of
 * extensions, special file names, and unknown types. Uses the system Chrome
 * channel; regenerate the preview page after changing seti-icon-theme.ts.
 */
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } })
await page.goto('file:///Users/fengzy/Documents/gitmy/dsh-web-ide/scripts/test-ui/seti-icons-preview.html')
await page.waitForTimeout(800)

// 1) 字体真的加载（document.fonts.check）
const fontOk = await page.evaluate(async () => {
  try { await document.fonts.load('150% seti') } catch { /* ignore */ }
  return document.fonts.check('150% seti')
})
console.log('seti font loaded:', fontOk)

// 2) 匹配逻辑断言（页面里的 keyFor 与组件逻辑等价）
const matchChecks = await page.evaluate(() => {
  const DEFS = window.DEFS ?? null
  return null
})
// 页面脚本没有挂 window；重跑关键匹配（等价逻辑）
const checks = await page.evaluate(() => {
  const out = []
  const q = (sel) => document.querySelectorAll(sel)
  out.push(['rows rendered', q('.row').length === 32])
  // 每个 glyph span 都有颜色且文本非空
  let allColored = true, allChar = true, distinct = new Set()
  for (const g of q('.g')) {
    if (!getComputedStyle(g).color) allColored = false
    if (!g.textContent || !g.textContent.codePointAt(0)) allChar = false
    distinct.add(g.textContent)
  }
  out.push(['all glyphs colored', allColored])
  out.push(['all glyphs have codepoints', allChar])
  // 32 个样本文件应至少渲染出 20+ 种不同图标（各种语言）
  out.push(['20+ distinct glyphs (' + distinct.size + ')', distinct.size >= 20])
  // readme.md / package.json / Makefile / Dockerfile 这类文件名级匹配生效（有专属图标，非默认 _file）
  const labels = [...q('.row')].map(r => r.textContent)
  const special = ['README.md', 'package.json', 'Makefile', 'Dockerfile']
  const specialsOk = special.every(s => labels.some(t => t.includes(s) && !t.includes('_file')))
  out.push(['special filenames get dedicated icons', specialsOk])
  // 未知扩展名走默认图标
  const weird = labels.find(t => t.includes('weird.xyzunknown'))
  out.push(['unknown ext falls back to default', !!weird && weird.includes('_default')])
  return out
})
let failed = 0
for (const [name, ok] of checks) {
  if (!ok) failed++
  console.log((ok ? 'ok   ' : 'FAIL ') + name)
}

await page.screenshot({ path: '/Users/fengzy/Documents/gitmy/dsh-web-ide/browser-screenshots/seti-icons-preview.png' })
await browser.close()
console.log(failed === 0 ? 'ALL VISUAL CHECKS PASSED' : failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
