// E2E driver: render IdeView with a mock ideTools face whose terminals are
// driven by an in-page fake PTY (echo + canned output), then let the runner
// exercise the new terminal-window features.
(function () {
  'use strict'

  var b64 = {
    enc: function (s) { return btoa(unescape(encodeURIComponent(s))) },
    dec: function (s) { return decodeURIComponent(escape(atob(s))) },
  }

  function makeTerm(id) {
    return {
      id: id,
      canned: [
        'hello alpha line',
        'hello bravo line',
        'hello charlie line',
        'URL: https://example.com/docs page',
        'unique-needle-xyz tail',
      ].join('\r\n'),
      listeners: new Set(),
      write: function (data) {
        var text = b64.dec(data)
        this.emit(text.replace(/\r/g, '\r\n'))
      },
      emit: function (text) {
        var self = this
        setTimeout(function () { self.listeners.forEach(function (fn) { fn({ data: b64.enc(text), exit: false }) }) }, 10)
      },
    }
  }

  var terms = new Map()
  var termSeq = 0
  var calls = { open: [], write: [], resize: [], signal: [], terminate: [] }

  var ideTools = {
    terminalOpen: async function (sessionId, spec) {
      var id = 't' + (++termSeq) + '-e2e'
      terms.set(id, makeTerm(id))
      calls.open.push({ id: id, spec: spec })
      return { ok: true, value: { terminalId: id, pid: 1000 + termSeq } }
    },
    terminalWrite: async function (sessionId, id, data) {
      var t = terms.get(id)
      calls.write.push({ id: id, data: b64.dec(data) })
      if (t !== undefined) t.write(data)
      return { ok: true, value: undefined }
    },
    terminalOutput: async function* (sessionId, id, signal) {
      var t = terms.get(id)
      if (t === undefined) return
      yield { data: b64.enc(t.canned), exit: false }
      yield { data: '', exit: false, replay: true }
      var queue = []
      var wake = null
      var stop = false
      t.listeners.add(function (frame) { queue.push(frame); if (wake !== null) wake() })
      signal.addEventListener('abort', function () { stop = true; if (wake !== null) wake() }, { once: true })
      while (!stop) {
        while (queue.length > 0) yield queue.shift()
        await new Promise(function (r) { wake = r })
        wake = null
      }
    },
    terminalResize: async function (sessionId, id, cols, rows) {
      calls.resize.push({ id: id, cols: cols, rows: rows })
      return { ok: true, value: undefined }
    },
    terminalSignal: async function (sessionId, id, name) {
      calls.signal.push({ id: id, name: name })
      return { ok: true, value: undefined }
    },
    terminalTerminate: async function (sessionId, id) {
      calls.terminate.push({ id: id })
      terms.delete(id)
      return { ok: true, value: undefined }
    },
    hostPlatform: async function () { return { ok: true, value: 'darwin' } },
    gitStatus: async function () { return { ok: true, value: { notARepo: false, branch: 'main', upstream: null, ahead: 0, behind: 0, detached: false, headSha: '', entries: [], clean: true } } },
    gitBranches: async function () { return { ok: true, value: { notARepo: false, branches: [] } } },
    gitDiff: async function () { return { ok: true, value: { path: '', hunks: [], oldContent: '', newContent: '' } } },
    gitLog: async function () { return { ok: true, value: { commits: [] } } },
    dirtyBuffers: async function () { return { ok: true, value: { revision: 0, buffers: [] } } },
    vscodeOpen: async function () { return { ok: false, error: { code: 'ide-tools/vscode-missing', message: 'not installed' } } },
    vscodeStatus: async function () { return { ok: true, value: { running: false } } },
    vscodeStop: async function () { return { ok: true, value: undefined } },
    search: async function () { return { ok: true, value: { matches: [], truncated: false, totalMatches: 0 } } },
    pushDirtyBuffers: async function () { return { ok: true, value: { revision: 0 } } },
    completeInline: async function () { return { ok: true, value: { completions: [] } } },
    fileReveal: async function () { return { ok: true, value: undefined } },
    gitStage: async function () { return { ok: true, value: undefined } },
    gitDiscard: async function () { return { ok: true, value: undefined } },
    gitCommit: async function () { return { ok: true, value: { committed: false } } },
    gitSync: async function () { return { ok: true, value: { pulled: 0, pushed: 0 } } },
    gitFetch: async function () { return { ok: true, value: undefined } },
    gitCheckout: async function () { return { ok: true, value: undefined } },
    gitCreateBranch: async function () { return { ok: true, value: undefined } },
    gitDeleteBranch: async function () { return { ok: true, value: undefined } },
    gitStageAll: async function () { return { ok: true, value: undefined } },
    gitUnstage: async function () { return { ok: true, value: undefined } },
    gitUnstageAll: async function () { return { ok: true, value: undefined } },
    gitDiscardAll: async function () { return { ok: true, value: undefined } },
    gitGenerateCommitMessage: async function () { return { ok: true, value: { message: '' } } },
    gitCommitDetails: async function () { return { ok: true, value: { commit: null } } },
    gitCommitFileDiff: async function () { return { ok: true, value: null } },
    fileRename: async function () { return { ok: true, value: undefined } },
    fileDelete: async function () { return { ok: true, value: undefined } },
    fileCreate: async function () { return { ok: true, value: undefined } },
    fileMove: async function () { return { ok: true, value: undefined } },
    fileCopy: async function () { return { ok: true, value: undefined } },
    writeFile: async function () { return { ok: true, value: { version: 1 } } },
    debugOpen: async function () { return { ok: false, error: { code: 'x', message: 'no' } } },
    debugTerminate: async function () { return { ok: true, value: undefined } },
  }

  var dict = (window.__DSH_IDE_E2E__.zh) || {}
  function t(key, params) {
    var s = dict[key] !== undefined ? dict[key] : key
    if (params !== undefined) {
      Object.keys(params).forEach(function (k) { s = s.split('{' + k + '}').join(String(params[k])) })
    }
    return s
  }

  var workspaceFiles = {
    readDir: async function () { return { ok: true, value: { entries: [] } } },
    readFile: async function () { return { ok: false, error: { code: 'x', message: 'no file' } } },
    getSnapshot: function () { return {} },
    subscribe: function () { return function () {} },
  }
  var workspaceFilesWrite = { write: async function () { return { ok: true, value: { version: 1 } } } }

  var E2E = window.__DSH_IDE_E2E__
  var container = document.getElementById('ide-root')
  var viewProps = {
    sessionId: 'e2e-session',
    cwd: '/Users/fengzy/Documents/gitmy/dsh-web-ide',
    workspaceFiles: workspaceFiles,
    workspaceFilesWrite: workspaceFilesWrite,
    ideTools: function () { return ideTools },
    t: t,
    tabVisible: true,
  }
  console.log('[e2e-driver] rendering IdeView, E2E keys: ' + Object.keys(E2E).join(','))
  var React = E2E.React
  var ReactDOM = E2E.ReactDOM
  var root = ReactDOM.createRoot(container)
  root.render(React.createElement(E2E.IdeView, viewProps))
  console.log('[e2e-driver] render() called')

  window.__E2E_RESULTS__ = { pass: [], fail: [], note: [] }
  window.__E2E_CALLS__ = calls
  window.__E2E_TERMS__ = terms
  window.__E2E_UTILS__ = {
    makeProps: function () { return viewProps },
    ok: function (name) { window.__E2E_RESULTS__.pass.push(name); console.log('PASS', name) },
    fail: function (name, detail) { window.__E2E_RESULTS__.fail.push(name + ': ' + detail); console.log('FAIL', name, String(detail)) },
    $: function (sel) { return document.querySelector(sel) },
    $$: function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)) },
    visible: function (el) { return el !== null && el.offsetParent !== null },
    b64: b64,
    ideTools: ideTools,
  }
})()
