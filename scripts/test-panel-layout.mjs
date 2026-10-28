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
  // IdeView 的写法是 onToggleTerminal={() => { setTerminalOpen((v) => !v); ... }}：
  // 换行、分号与额外语句都可能出现，这里只锚定「属性名 + 箭头函数 + 切换 terminalOpen」，
  // 不要锁死成紧贴的单表达式形式（旧正则因此误报）。
  assert.match(ide, /onToggleTerminal=\{\(\) => \{[^}]*setTerminalOpen\(\(v\) => !v\)/, 'IdeView 传 onToggleTerminal 给 StatusBar')
})

await test('StatusBar:底部栏终端图标只在"终端"标签激活时高亮(打开问题面板不应点亮)', () => {
  // 底部面板的打开标志 terminalOpen 与"问题"标签共用；只用它决定高亮会让
  // 点击问题图标时终端图标也变蓝。必须同时看当前激活的是哪个标签。
  assert.match(sb, /bottomTab\?:\s*'terminal'\s*\|\s*'problems'/, 'StatusBar 接受 bottomTab prop')
  assert.match(sb, /data-active=\{\(terminalOpen && \(bottomTab === undefined \|\| bottomTab === 'terminal'\)\)/, '终端图标高亮要求 terminalOpen 且激活的是 terminal 标签')
  assert.match(sb, /data-active=\{\(terminalOpen && bottomTab === 'problems'\)/, '问题图标仅在自己标签激活时高亮')
  assert.match(ide, /bottomTab=\{bottomTab\}/, 'IdeView 把 bottomTab 传给 StatusBar')
  assert.match(css, /\.ide-statusbar-problems\[data-active='true'\]/, '问题图标有选中样式')
  // 顺序：终端图标在问题图标之前。
  assert.ok(
    sb.indexOf('ide-statusbar-terminal') < sb.indexOf('ide-statusbar-problems'),
    '终端图标排在问题图标前面',
  )
})

await test('StatusBar:远程信息弹层里的项目路径可点击复制并弹出已复制提示', () => {
  const menu = read('../src/client/ContextMenu.tsx')
  // 项目路径这一行必须真的可点（不能是 disabled 的信息行），且复制失败时有
  // 降级方案与失败提示，不静默无反应。
  // 复制入口改为右侧图标，不再显示"点击复制"文字提示。
  assert.match(sb, /id: 'cwd',[\s\S]{0,220}?actionIcon: Icons\.copy/, '路径行的复制图标在右侧(actionIcon)')
  assert.ok(!/id: 'cwd',[\s\S]{0,220}?hint: t\('status\.clickToCopy'\)/.test(sb), '路径行不再显示"点击复制"文字')
  assert.match(menu, /actionIcon\?: ReactNode/, 'ContextMenuItem 支持 actionIcon')
  assert.match(menu, /ide-context-menu-item-action/, 'actionIcon 渲染在 label 之后')
  assert.match(css, /\.ide-context-menu-item-action\{/, '右侧图标有对应样式')
  assert.match(sb, /copyToClipboard/, 'StatusBar 有 copyToClipboard 实现')
  assert.match(sb, /navigator\.clipboard\.writeText/, '优先用 navigator.clipboard 复制')
  assert.match(sb, /document\.execCommand\('copy'\)/, '无 Clipboard API 时降级到 execCommand')
  assert.match(sb, /notifications\.info\(t\('status\.copied'/, '复制成功弹出 toast 提示')
  assert.match(sb, /notifications\.error\(t\('status\.copyFailed'/, '复制失败也有提示')
  assert.match(menu, /hint\?: string/, 'ContextMenuItem 支持 hint 字段')
  assert.match(menu, /ide-context-menu-item-hint/, 'hint 会被渲染成右侧提示')
  assert.match(css, /\.ide-context-menu-item-hint\{/, '提示有对应样式')
  for (const key of ['status.clickToCopy', 'status.pathWhat', 'status.copied', 'status.copyFailed']) {
    const hits = loc.split("'" + key + "'").length - 1
    assert.equal(hits, 2, key + ' 中英文文案齐全')
  }
})

await test('左侧活动栏:设置按钮在终端按钮下方', () => {
  const term = ide.indexOf("data-testid=\"ide-activitybar-terminal\"")
  const gear = ide.indexOf("data-testid=\"ide-activitybar-gear\"")
  assert.ok(term !== -1 && gear !== -1, '两个按钮都存在')
  assert.ok(term < gear, '终端按钮在前，设置按钮在其下方')
  // 两者都必须在活动栏底部分隔线之后（VS Code 的位置语义）。
  const spacer = ide.indexOf('ide-activitybar-spacer')
  assert.ok(spacer !== -1 && spacer < term, '仍位于活动栏底部区域')
})

await test('StatusBar:分支在最左、其后是同步按钮、点击分支打开 SCM 分支视图', () => {
  // 顺序：分支名 → 同步图标 → 远程/工作区指示器。
  assert.ok(sb.indexOf('ide-statusbar-branch-name') < sb.indexOf('ide-statusbar-sync'), '分支名在同步按钮之前')
  assert.ok(sb.indexOf('ide-statusbar-branch-name') < sb.indexOf('ide-statusbar-remote'), '分支在远程指示器之前(最左侧)')
  assert.match(sb, /onClick=\{\(\) => onOpenBranch\?\.\(\)\}/, '点击分支名触发 onOpenBranch')
  assert.match(sb, /syncBusy/, '同步按钮有进行中状态')
  assert.match(ide, /const openScmBranches = /, 'IdeView 有 openScmBranches')
  assert.match(ide, /setScmOpenViewsRequest\(\{ branches: !branchesShown \}\)/, '按当前状态决定展开还是收起分支视图')
  assert.match(ide, /const branchesShown = sidebarView === 'git' && scmOpenViews\.branches/, '以"已在 SCM 且分支已展开"作为收起条件')
  assert.match(ide, /setSidebarView\('git'\)[\s\S]{0,240}setScmOpenViewsRequest/, '同时切到源代码管理视图')
  assert.match(ide, /onOpenBranch=\{openScmBranches\}/, 'StatusBar 收到 onOpenBranch')
  const scm = read('../src/client/git/SourceControlPanel.tsx')
  assert.match(scm, /openViewsRequest\?: Partial<ScmOpenViews>/, 'SCM 面板接受 openViewsRequest')
  assert.match(scm, /\[openViewsRequest\]\)/, 'openViewsRequest 变化时展开对应视图')
  assert.match(css, /\.ide-statusbar-sync\[data-busy\]/, '同步进行中有旋转动画')
  // 同步图标必须常驻：只有 ahead/behind 计数是条件渲染，按钮本身不能包在条件里。
  assert.ok(
    !/onSync !== undefined && \(\(ahead \?\? 0\) > 0 \|\| \(behind \?\? 0\) > 0/.test(sb),
    '同步按钮不再按 ahead/behind 条件渲染（本地无改动时也应显示）',
  )
  assert.match(sb, /onSync !== undefined && \(\s*<button\s+type="button"\s+className="ide-statusbar-item ide-statusbar-sync"/, '同步按钮恒渲染')
  assert.match(sb, /data-idle=\{/, '无待同步内容时标记 idle')
  assert.match(css, /\.ide-statusbar-sync\[data-idle\]/, 'idle 时图标弱化但可见')
  // 分支按钮为开关语义。
  assert.match(sb, /data-active={branchPanelOpen === true \|\| undefined}/, '分支按钮有激活态')
  assert.match(sb, /aria-expanded={branchPanelOpen === true}/, '分支按钮带 aria-expanded')
  assert.match(ide, /branches: !branchesShown/, '再次点击分支名收起分支视图')
  assert.match(ide, /onOpenViewsChanged=\{setScmOpenViews\}/, 'SCM 上报展开状态给 IdeView')
  assert.match(scm, /onOpenViewsChanged\?\.\(openViews\)/, 'SCM 面板回报当前展开视图')
  for (const key of ['status.syncing', 'status.branchClick']) {
    assert.equal(loc.split("'" + key + "'").length - 1, 2, key + ' 中英文文案齐全')
  }
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