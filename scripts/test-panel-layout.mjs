import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (r) => readFileSync(new URL(r, import.meta.url), 'utf8')
let pass = 0, fail = 0
async function test(name, fn){ try{ await fn(); pass++; console.log('PASS '+name) }catch(e){ fail++; console.log('FAIL '+name+': '+(e&&e.message?e.message:e)) } }
const ide = read('../src/client/IdeView.tsx')
const sb = read('../src/client/editor/StatusBar.tsx')
const css = read('../src/client/theme.ts')
const loc = read('../src/client/locales.ts')

await test('StatusBar:接受 branch prop 并在左侧显示分支图标+分支名', () => {
  assert.match(sb, /branch\?:\s*string/, 'StatusBar props 有 branch?: string')
  assert.match(sb, /ide-statusbar-branch/, 'StatusBar 渲染 ide-statusbar-branch 项')
  assert.match(sb, /Icons\.branch/, '分支名前有 branch 图标')
  assert.match(sb, /ide-statusbar-branch-icon/, '有分支图标容器 ide-statusbar-branch-icon')
})

await test('IdeView:从 gitStatus 捕获 branch 并传给 StatusBar', () => {
  assert.match(ide, /gitBranch.*useState/, 'IdeView 有 gitBranch useState')
  assert.match(ide, /setGitBranch\(res\.value\.branch\)/, '从 gitStatus 响应捕获 branch')
  assert.match(ide, /branch=\{gitBranch\}/, 'StatusBar 接收 branch={gitBranch}')
})

await test('布局:终端面板移到 ide-body 底部占满整宽(不在 editor-area 内)', () => {
  assert.match(ide, /ide-body-main/, '引入 ide-body-main 包裹 activitybar+sidebar+editor')
  assert.match(css, /\.ide-body\{display:flex;flex-direction:column/, 'ide-body 改为 column 布局')
  assert.match(css, /\.ide-body-main\{display:flex;flex:1/, 'ide-body-main 是 flex:1 行容器')
})

await test('StatusBar:底部栏左侧有终端按钮(点击开关终端面板)', () => {
  assert.match(sb, /onToggleTerminal/, 'StatusBar 接受 onToggleTerminal 回调')
  assert.match(sb, /terminalOpen/, 'StatusBar 接受 terminalOpen 状态')
  assert.match(sb, /ide-statusbar-terminal/, 'StatusBar 渲染 ide-statusbar-terminal 按钮')
  assert.match(ide, /onToggleTerminal=\{\(\) => setTerminalOpen/, 'IdeView 传 onToggleTerminal 给 StatusBar')
})

await test('SCM:图表/分支 panel 固定在面板底部(不随变更滚动浮动)', () => {
  const src = read('../src/client/git/SourceControlPanel.tsx')
  assert.match(src, /ide-git-subpanel-top/, '变更 panel 包在 ide-git-subpanel-top(上部可滚动)')
  assert.match(src, /ide-git-subpanel-bottom/, '图表/分支 panel 包在 ide-git-subpanel-bottom(底部固定)')
  assert.match(css, /\.ide-git-subpanel-top\{flex:1/, 'top 容器 flex:1 占据上部')
  assert.match(css, /\.ide-git-subpanel-bottom\{flex:none/, 'bottom 容器 flex:none 固定底部')
})

await test('右上角:持久 ide-editor-toolbar 始终有终端和侧边栏位置两个按钮(不依赖 TabBar)', () => {
  // Buttons moved OUT of TabBar actions (which hide when no tabs) into a
  // persistent ide-editor-toolbar that always renders.
  assert.match(ide, /ide-editor-toolbar/, '有持久的 ide-editor-toolbar 容器')
  assert.match(ide, /panel\.toggleBottom/, '有底部面板切换按钮(用 panel.toggleBottom)')
  assert.match(ide, /setTerminalOpen\(\(v\) => !v\)/, '底部面板按钮切换 terminalOpen')
  assert.match(ide, /panel\.toggleRightSidebar/, '有右侧栏切换按钮(用 panel.toggleRightSidebar)')
  assert.match(ide, /setRightSidebarOpen\(\(v\) => !v\)/, '右侧栏按钮切换 rightSidebarOpen')
})

await test('右上角最右侧按钮:打开/关闭右侧栏(不是切换侧边栏位置)', () => {
  assert.match(ide, /rightSidebarOpen.*useState/, 'IdeView 有 rightSidebarOpen 状态')
  assert.match(ide, /setRightSidebarOpen\(\(v\) => !v\)/, '按钮切换 rightSidebarOpen')
  assert.match(ide, /ide-sidebar-right/, '有 ide-sidebar-right 容器')
  assert.match(ide, /panel\.toggleRightSidebar/, '按钮用 panel.toggleRightSidebar 文案')
  assert.match(css, /\.ide-sidebar-right\{/, '有 .ide-sidebar-right CSS')
  assert.ok(!/data-sidebar-right=\{sidebarOnRight/.test(ide), '不再用 data-sidebar-right 切换侧边栏位置')
})

await test('locales:panel.toggleBottom / panel.toggleSidebar 中英文案齐全', () => {
  assert.match(loc, /'panel.toggleBottom': '切换底部面板'/, '中文 panel.toggleBottom')
  assert.match(loc, /'panel.toggleSidebar': '切换侧边栏位置'/, '中文 panel.toggleSidebar')
  assert.match(loc, /'panel.toggleBottom': 'Toggle Bottom Panel'/, '英文 panel.toggleBottom')
  assert.match(loc, /'panel.toggleSidebar': 'Toggle Sidebar Position'/, '英文 panel.toggleSidebar')
})

console.log('\\nSUMMARY pass='+pass+' fail='+fail)
if (fail > 0) process.exitCode = 1