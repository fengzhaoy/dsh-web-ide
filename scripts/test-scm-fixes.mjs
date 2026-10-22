import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (r) => readFileSync(new URL(r, import.meta.url), 'utf8')
let pass = 0, fail = 0
async function test(name, fn){ try{ await fn(); pass++; console.log('PASS '+name) }catch(e){ fail++; console.log('FAIL '+name+': '+(e&&e.message?e.message:e)) } }
const fileTree = read('../src/client/explorer/FileTree.tsx')
const scm = read('../src/client/git/SourceControlPanel.tsx')
const ide = read('../src/client/IdeView.tsx')

await test('FileTree:目录的重命名/删除不再用 depth===0 禁用(误伤所有顶层目录)', () => {
  assert.ok(!/disabled:\s*depth\s*===\s*0/.test(fileTree), '不应再用 disabled: depth === 0')
})

await test('FileTree:目录的重命名/删除只在仓库根节点本身禁用(childPath===rootDir)', () => {
  assert.match(fileTree, /disabled: childPath === rootDir/, '目录 rename/delete 应改为 disabled: childPath === rootDir')
})

await test('FileTree:非目录(文件)的重命名/删除仍无条件可用(无 disabled)', () => {
  const fileBranchStart = fileTree.indexOf("id: 'open'")
  assert.ok(fileBranchStart > -1, '找到文件分支起点')
  const fileBranch = fileTree.slice(fileBranchStart)
  const fileRename = fileBranch.match(/id: 'rename'[^\n]*/)
  const fileDelete = fileBranch.match(/id: 'delete'[^\n]*/)
  assert.ok(fileRename && fileDelete, '文件分支有 rename 和 delete')
  assert.ok(!/disabled/.test(fileRename[0]), '文件 rename 不应有 disabled')
  assert.ok(!/disabled/.test(fileDelete[0]), '文件 delete 不应有 disabled')
})

await test('SCM:SourceControlPanel 接受受控 commitMessage prop(提升到父级)', () => {
  assert.match(scm, /commitMessage\?:\s*string/, 'props 接口有 commitMessage?: string')
  assert.match(scm, /onCommitMessageChange\?:\s*\(value:\s*string\)\s*=>\s*void/, 'props 接口有 onCommitMessageChange')
})

await test('SCM:组件内 commitMessage 优先用 prop,否则回退内部 state', () => {
  assert.match(scm, /const commitMessage = commitMessageProp \?\? commitMessageLocal/, 'commitMessage = prop ?? local')
})

await test('IdeView:持有提升的 scm 提交信息 state(跨 sidebar 切换不丢)', () => {
  assert.match(ide, /scmCommitMessage.*useState/, 'IdeView 有 scmCommitMessage useState')
  assert.match(ide, /commitMessage=\{scmCommitMessage\}/, '传 commitMessage={scmCommitMessage}')
  assert.match(ide, /onCommitMessageChange=\{setScmCommitMessage\}/, '传 onCommitMessageChange={setScmCommitMessage}')
})

console.log('\\nSUMMARY pass='+pass+' fail='+fail)
if (fail > 0) process.exitCode = 1