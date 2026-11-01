/**
 * Virtual tabs (the VS Code overlay) must never enter a file-lifecycle path.
 * Regression guard for: the tab vanishing ~15s after opening, because the
 * 15s stat poll asked for dsh://vscode, got not-found, and dropped the tab.
 */
import { readFileSync } from 'node:fs'

let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }
const ide = readFileSync(new URL('../src/client/IdeView.tsx', import.meta.url), 'utf8')

// --- the helper ---
check('isFileTab helper exists', /function isFileTab\(/.test(ide))
check('isFileTab rejects vscode tabs', /tab\.kind === 'vscode'/.test(ide))
check('isFileTab rejects dsh:// paths', /startsWith\('dsh:\/\/'\)/.test(ide))

// --- the three file-lifecycle paths that could delete it ---
check('15s stat poll skips virtual tabs',
  /filter\(\(t\) => t\.status === 'ready' && isFileTab\(t\)\)/.test(ide))
check('external-change match skips virtual tabs',
  /find\(\(t\) => isFileTab\(t\) && matchesPath\(t\.path, absPath, cwd\)\)/.test(ide))
check('deletion victim lookup skips virtual tabs',
  /const victim = tabsRef\.current\.find\(\(t\) => isFileTab\(t\) && matchesPath/.test(ide))
check('dropTab refuses virtual paths', /if \(path\.startsWith\('dsh:\/\/'\)\) return/.test(ide))

// --- the poll interval really is the 15s one ---
check('the poll interval is still 15s (matches the reported symptom)', /setInterval\(poll, 15000\)/.test(ide))

// --- selection/probe: the tab stays open on failure ---
const open = ide.slice(ide.indexOf('const openVscode = useCallback'))
const body = open.slice(0, open.indexOf('const stopVscode'))
check('a failed start does not remove the tab', !/setTabs\(\(prev\) => prev\.filter/.test(body))
check('the tab is added before awaiting the server',
  body.indexOf('setTabs(') < body.indexOf('ideTools.vscodeOpen')
)

console.log(failed === 0 ? '\nall virtual-tab checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)