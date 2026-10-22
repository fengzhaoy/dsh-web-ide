/**
 * Regression test for the diff editor auto-jump to first change (run: node scripts/test-diff-jump.mjs).
 *
 * Desired behavior: when the user clicks a modified/uncommitted file in the
 * Source Control sidebar, the Monaco diff editor that opens should AUTO-SCROLL
 * to the first changed region (first diff hunk) instead of sitting at the top
 * of the file. VS Code does this natively; this hand-written IDE did not — the
 * diff editor was created and models set, but nothing revealed the first change.
 *
 * This test pins the presence of that jump in reading the DiffEditor source.
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

const src = read('../src/client/git/DiffEditor.tsx')

await test('DiffEditor:监听 diff 计算完成事件(onDidUpdateDiff)', () => {
  // Monaco emits onDidUpdateDiff once the diff between the two models is
  // computed; that is the moment the line changes become available.
  assert.match(src, /onDidUpdateDiff/, '要在 setModel 后监听 onDidUpdateDiff')
})

await test('DiffEditor:diff 完成后取首个改动行(getLineChanges / lineChanges)', () => {
  // The first change's modified-start line is what we reveal. Must read the
  // line changes off the diff editor (getLineChanges() or the event's changes).
  assert.match(src, /getLineChanges\(\)|lineChanges|\.changes/, '要从 diff 编辑器取 line changes')
})

await test('DiffEditor:跳到首个改动的修改侧行(revealLineInCenter on modified editor)', () => {
  // Reveal the first changed line in the MODIFIED editor (the right/working
  // side), centered, so the user lands on the first edit.
  assert.match(src, /revealLineInCenter|revealLineInCenterIfOutsideViewport|revealPosition/, '要 reveal 首个改动行')
  assert.match(src, /getModifiedEditor\(\)|modifiedEditor|\.modified/, '要在修改侧(modified)编辑器上 reveal')
})

await test('DiffEditor:跳转只在首次 diff 完成后做一次(避免每次 diff 更新都抢焦点)', () => {
  // The external-change watch reloads models in place and re-runs the diff;
  // jumping on EVERY update would fight the user's scroll. Guard it so the
  // jump happens once per mount (a ref/flag that flips after the first jump).
  assert.match(src, /jumpedRef|firstJumpDone|hasJumped|jumped\.current|once/, '跳转要只做一次,避免后续 diff 更新抢焦点')
})

console.log(`\nSUMMARY pass=${pass} fail=${fail}`)
if (fail > 0) process.exitCode = 1
