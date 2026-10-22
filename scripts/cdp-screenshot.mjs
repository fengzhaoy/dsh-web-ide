// CDP screenshot via Node global WebSocket (Node 22+). No external deps.
// Usage: node scripts/cdp-screenshot.mjs <url> <out.png>
const url = process.argv[2] || 'http://127.0.0.1:3080'
const out = process.argv[3] || './scm-screenshot.png'
const { writeFileSync } = await import('node:fs')

// 1) discover a page target's ws endpoint
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json().catch(() => null)
if (!ver) { console.error('cannot reach 9222 /json/version — is Chrome started with --remote-debugging-port=9222?'); process.exit(2) }
// open a fresh tab so we don't hijack user's tabs
let wsUrl
try {
  const nt = await (await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json()
  wsUrl = nt.webSocketDebuggerUrl
} catch {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  wsUrl = (list.find(t => t.type === 'page') || {}).webSocketDebuggerUrl
}
if (!wsUrl) { console.error('no page webSocketDebuggerUrl'); process.exit(2) }
console.error('wsUrl:', wsUrl)

const sock = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
function send(method, params = {}) {
  const msgId = ++id
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject })
    sock.send(JSON.stringify({ id: msgId, method, params }))
  })
}
sock.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }
})
await new Promise((r, x) => { sock.addEventListener('open', r); sock.addEventListener('error', x) })
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url })
await new Promise((r) => setTimeout(r, 7000)) // SPA + IDE mount
// click the SCM sidebar control (best-effort)
const click = await send('Runtime.evaluate', { expression: `(function(){
  const all = Array.from(document.querySelectorAll('*'));
  const cand = all.filter(el => {
    const s = (el.className||'') + ' ' + (el.getAttribute('data-view')||'') + ' ' + (el.title||'') + ' ' + (el.getAttribute('aria-label')||'');
    return /scm|source.?control|git|branch|源代码/i.test(s) && /svg|button|icon/i.test(el.tagName + ' ' + el.className);
  });
  if (cand.length) { cand[0].click(); return 'clicked: ' + (cand[0].className||cand[0].tagName) }
  return 'no scm control; total els=' + all.length;
})()` })
console.error('scm:', click.result.value)
await new Promise((r) => setTimeout(r, 2500))
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('saved:', out)
sock.close(); process.exit(0)
