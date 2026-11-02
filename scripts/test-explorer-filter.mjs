/**
 * Explorer type-to-filter: the box lives at the top of the tree but is hidden
 * until the title-bar magnifier toggles it; closing it must clear the filter,
 * and Esc closes it too. Source-level checks (the repo's other UI tests do the
 * same) plus a real-browser pass for the interaction.
 */
import { readFileSync } from 'node:fs'

let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }
const tree = readFileSync(new URL('../src/client/explorer/FileTree.tsx', import.meta.url), 'utf8')
const ide = readFileSync(new URL('../src/client/IdeView.tsx', import.meta.url), 'utf8')

// --- handle contract ---
check('ExplorerHandle exposes toggleFilter', /toggleFilter\(\): void/.test(tree))
check('toggleFilter flips the open flag', /toggleFilter: \(\) => setFilterOpen\(\(open\) => !open\)/.test(tree))
check('box starts hidden', /const \[filterOpen, setFilterOpen\] = useState\(false\)/.test(tree))

// --- the box is conditional, not a permanent row ---
const filterRow = tree.indexOf('className="ide-tree-filter"')
check('filter row exists', filterRow !== -1)
const before = tree.slice(Math.max(0, filterRow - 120), filterRow)
check('filter row is guarded by filterOpen', before.includes('{filterOpen && ('))

// --- open focuses, close clears ---
check('opening focuses the input', /if \(filterOpen\) \{\s*filterInputRef\.current\?\.focus\(\)/.test(tree))
check('closing clears the filter text', /\}\s*setFilterText\(''\)\s*\}, \[filterOpen\]\)/.test(tree))
check('Escape closes and clears', /e\.key !== 'Escape'[\s\S]{0,160}setFilterText\(''\)[\s\S]{0,80}setFilterOpen\(false\)/.test(tree))

// --- header wiring: the magnifier drives the box, never the search view ---
check('header magnifier calls toggleFilter', ide.includes('onClick={() => explorerRef.current?.toggleFilter()}'))
check('header magnifier uses the filter tooltip', /title=\{t\('explorer\.filterFiles'\)\}/.test(ide))
check('header magnifier does not open the search sidebar', !ide.includes("onClick={() => toggleSidebarFor('search')}"))

console.log(failed === 0 ? '\nall explorer filter checks passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
