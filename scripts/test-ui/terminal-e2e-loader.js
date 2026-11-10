// react-dom reads process.env at module scope; provide a browser shim.
window.process = window.process || { env: { NODE_ENV: 'production' }, platform: 'browser', browser: true, version: '' }

;(async function () {
  'use strict'
  try {
    var res = await fetch('./lib/e2e.iife.js')
    var code = await res.text()
    window.eval(code)
  } catch (e) {
    console.error('e2e bundle failed:', e)
    return
  }
  try {
    var d = await fetch('./terminal-e2e-driver.js')
    window.eval(await d.text())
  } catch (e) {
    console.error('driver failed:', e)
  }
})()
