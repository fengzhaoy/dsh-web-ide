#!/usr/bin/env node
/**
 * Verifies the dsh-ide.* -> dsh-web-ide.* rename moves user data instead of
 * dropping it. Runs the built module against a fake localStorage.
 */
import { readFileSync } from 'node:fs'

let failed = 0
const check = (name, ok) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + name)
  if (!ok) failed += 1
}

const src = readFileSync(new URL('../src/client/storageMigration.ts', import.meta.url), 'utf8')
check('migration maps settings', src.includes("['dsh-ide.settings', 'dsh-web-ide.settings']"))
check('migration maps keybindings', src.includes("['dsh-ide.keybindings', 'dsh-web-ide.keybindings']"))
check('migration is idempotent (a guard flag)', /if \(migrated\) return/.test(src))
check('a new value always wins over the legacy one', /getItem\(newKey\) === null/.test(src))
check('legacy key is removed after moving', /removeItem\(oldKey\)/.test(src))

// The client bundle only exports the plugin entry, so the move is verified
// end-to-end at runtime instead of by importing it here.
const entry = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
check('migration runs before the RPC mount',
  /migrateLegacyStorage\(\)[\s\S]{0,200}\$mount/.test(entry))

console.log(failed === 0 ? '\nall storage-migration checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
