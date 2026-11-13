import { chromium } from 'playwright'
const URL = 'http://127.0.0.1:3080/?token=7PQry4Hiph1fvt_youtFB1tRANOL46qP4uCJZKZ6axU'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
p.on('pageerror', e => console.log('PAGE ERROR:', e.message.slice(0, 300)))
await p.goto(URL, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(16000)

// 进 IDE
await p.evaluate(() => {
  const el = Array.from(document.querySelectorAll('div')).find(e => (e.textContent||'').trim().startsWith('安全拉取 Git 代码方案'))
  if (el) { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x+5, clientY: r.y+5 })) }
})
await p.waitForTimeout(6000)
await p.evaluate(() => {
  const el = Array.from(document.querySelectorAll('[role=tab],button,div,span')).find(e => (e.textContent||'').trim() === 'IDE' && e.getBoundingClientRect().width > 0)
  if (el) { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x+r.width/2, clientY: r.y+r.height/2 })) }
})
await p.waitForTimeout(8000)

// 抓所有 workspace-file-write 的请求/响应
const trace = await p.evaluate(async () => {
  const log = []
  const orig = window.fetch
  window.fetch = async function(...a) {
    const body = a[1]?.body
    const isWrite = typeof body === 'string' && (body.includes('workspace-file-write') || body.includes('fileWrite') || body.includes('writeFile'))
    const res = await orig.apply(this, a)
    if (isWrite) {
      const clone = res.clone()
      let txt = ''
      try { txt = (await clone.text()).slice(0, 400) } catch {}
      log.push({ req: (body || '').slice(0, 300), res: txt })
    }
    return res
  }
  window.__writeLog = log
  return 'instrumented'
})
console.log('instrument:', trace)

// 直接调 IDE 暴露的 RPC（如果能拿到），否则打开一个文件用 UI 保存
const hasApi = await p.evaluate(() => typeof window.__dshIdeTools !== 'undefined')
console.log('ideTools on window:', hasApi)
await b.close()
