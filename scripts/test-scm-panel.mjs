/**
 * Regression test for the SCM sidebar's view-switching UI (run: node scripts/test-scm-panel.mjs).
 *
 * The Source Control sidebar used to switch between 源代码管理/图表/分支 via a
 * header DROPDOWN (ide-git-header-switch + openViewMenu → showContextMenu,
 * single-active ScmView state). The user asked to replace that with a stack of
 * collapsible SUB-PANELS — one per view, each independently openable/collapsible
 * (click header to open, click again to collapse), modelled on the reference
 * project's csCard accordion. This test pins the new structure so a regression
 * to the dropdown is caught.
 *
 * Decisions (confirmed by the user): multi-expand (each panel opens
 * independently) + the changes view's AI-generate/refresh action buttons live
 * INSIDE the changes panel's header, not in a shared header.
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

const src = read('../src/client/git/SourceControlPanel.tsx')

await test('SCM:不再有头部下拉视图切换器(ide-git-header-switch / openViewMenu 已移除)', () => {
  assert.doesNotMatch(src, /ide-git-header-switch/, '下拉开关按钮 class 必须删除')
  assert.doesNotMatch(src, /openViewMenu/, 'openViewMenu(三选一 showContextMenu)必须删除')
  assert.doesNotMatch(src, /git\.graphSwitchView/, '下拉切换的文案 key 不再使用')
})

await test('SCM:不再用单选 ScmView / setView 三选一切换', () => {
  // The old single-active model: useState<ScmView>('changes') + setView(...)
  assert.doesNotMatch(src, /useState<ScmView>\('changes'\)/, '单选 view 状态必须替换为多展开态')
  // setView may still appear only if repurposed; the dropdown's setView(entry.view) must be gone.
  assert.doesNotMatch(src, /setView\(entry\.view\)/, '下拉条目的 setView 切换必须删除')
})

await test('SCM:三个视图改为可折叠子 panel(各自独立展开/收起)', () => {
  // Each panel carries its own open state — multi-expand, not single-active.
  assert.match(src, /openViews|openPanels|useState<\{[^}]*changes[^}]*\}>|const \[(changes|graph|branches)Open/, '要有三个视图各自的展开/收起状态(多展开)')
  // A collapsible panel header is a button that toggles open; reuse ide-git-section header idiom.
  assert.match(src, /ide-git-section-header/, '可折叠 header 复用 ide-git-section-header')
  // Chevron reflects open state (rotates / switches between chevronDown and chevronRight).
  assert.match(src, /chevronDown|chevronRight/, 'chevron 要随展开态切换')
})

await test('SCM:三个视图本体(变更/GraphView/BranchesView)都在 SCM panel,图表/分支在面板底部', () => {
  // All three views render inside SourceControlPanel; graph/branches sit at
  // the bottom (after the changes subpanel).
  assert.match(src, /<GraphView/, '图表视图本体在 SourceControlPanel')
  assert.match(src, /<BranchesView/, '分支视图本体在 SourceControlPanel')
  assert.match(src, /ide-git-input/, '变更视图的提交输入仍在')
  assert.match(src, /ide-git-entries/, '变更视图的变更列表仍在')
})

await test('SCM:变更视图的 AI生成/刷新 按钮挪进了对应 panel header(不在公共头部)', () => {
  // The sparkle (AI generate) + refresh actions must live inside the changes panel,
  // not in a shared ide-git-header that all views share.
  assert.match(src, /Icons\.sparkle/, 'AI 生成按钮仍在')
  assert.match(src, /Icons\.refresh/, '刷新按钮仍在')
  // No shared header that renders these actions conditionally on a single active view.
  assert.doesNotMatch(src, /view === 'changes' && \(\s*<>\s*<button[^>]*ide-git-action/, 'AI/刷新 按钮不能再放在「仅 changes 视图时显示」的公共头部里')
})

await test('SCM:可折叠 panel header 是可点击的按钮(aria-expanded + onClick 切换)', () => {
  // csCard-style: header is a <button aria-expanded=... onClick=toggle>.
  assert.match(src, /aria-expanded/, '可折叠 header 要有 aria-expanded 无障碍属性')
})

console.log(`\nSUMMARY pass=${pass} fail=${fail}`)
if (fail > 0) process.exitCode = 1
