/**
 * VSCode Dark Modern theme tokens, projected onto Monaco and CSS variables.
 *
 * The color values mirror the VSCode built-in `dark_modern` color theme:
 * background #1f1f1f, sidebar #181818, the standard Dark+ token palette.
 * Monaco themes inherit from `vs-dark` and override the named tokens/colors.
 */
import type * as Monaco from 'monaco-editor'

/** CSS custom properties for the IDE shell (activity bar, sidebar, tabs, status). */
export const IDE_CSS_VARS: Record<string, string> = {
  '--ide-bg': '#1f1f1f',
  '--ide-sidebar-bg': '#181818',
  '--ide-activitybar-bg': '#333333',
  '--ide-activitybar-fg': '#858585',
  '--ide-activitybar-active': '#ffffff',
  '--ide-tab-bg': '#2d2d2d',
  '--ide-tab-inactive-bg': '#2d2d2d',
  '--ide-tab-active-bg': '#1f1f1f',
  '--ide-tab-inactive-fg': '#969696',
  '--ide-tab-active-fg': '#ffffff',
  '--ide-tab-border': '#252526',
  '--ide-statusbar-bg': '#1e1e1e',
  '--ide-statusbar-fg': '#cccccc',
  // Light gray highlight for a selected status-bar toggle (terminal icon):
  // on the dark bar a translucent white reads as VS Code's gray selection.
  '--ide-statusbar-active-bg': 'rgba(255,255,255,.16)',
  '--ide-statusbar-active-hover-bg': 'rgba(255,255,255,.24)',
  '--ide-statusbar-active-fg': '#ffffff',
  '--ide-border': '#2b2b2b',
  '--ide-tree-hover': '#2a2d2e',
  '--ide-tree-active': '#37373d',
  '--ide-tree-focus': '#0e639c',
  '--ide-fg': '#cccccc',
  '--ide-fg-muted': '#9d9d9d',
  '--ide-fg-dim': '#858585',
  '--ide-accent': '#0e639c',
  '--ide-accent-hover': '#1177bb',
  '--ide-titlebar-bg': '#181818',
  '--ide-icon-fg': '#c5c5c5',
}

/** Light Modern equivalents (VS Code light_modern): swapped when the theme
 *  setting says light. Applied by overwriting the same CSS custom properties
 *  on the IDE root element. */
export const IDE_CSS_VARS_LIGHT: Record<string, string> = {
  '--ide-bg': '#ffffff',
  '--ide-sidebar-bg': '#f8f8f8',
  '--ide-activitybar-bg': '#f8f8f8',
  '--ide-activitybar-fg': '#616161',
  '--ide-activitybar-active': '#1f1f1f',
  '--ide-tab-bg': '#f8f8f8',
  '--ide-tab-inactive-bg': '#f8f8f8',
  '--ide-tab-active-bg': '#ffffff',
  '--ide-tab-inactive-fg': '#616161',
  '--ide-tab-active-fg': '#1f1f1f',
  '--ide-tab-border': '#e5e5e5',
  '--ide-statusbar-bg': '#f8f8f8',
  '--ide-statusbar-fg': '#3b3b3b',
  // Same idea on the light bar: a gray wash that still contrasts with white.
  '--ide-statusbar-active-bg': 'rgba(0,0,0,.12)',
  '--ide-statusbar-active-hover-bg': 'rgba(0,0,0,.18)',
  '--ide-statusbar-active-fg': '#1f1f1f',
  '--ide-border': '#e5e5e5',
  '--ide-tree-hover': '#e8e8e8',
  '--ide-tree-active': '#e4e6f1',
  '--ide-tree-focus': '#005fb8',
  '--ide-fg': '#3b3b3b',
  '--ide-fg-muted': '#616161',
  '--ide-fg-dim': '#8b8b8b',
  '--ide-accent': '#005fb8',
  '--ide-accent-hover': '#0258a8',
  '--ide-titlebar-bg': '#f8f8f8',
  '--ide-icon-fg': '#424242',
}

/** Inline stylesheet injected once when the IDE mounts. VSCode-style geometry. */
export const IDE_STYLES = `
/* While the IDE view is mounted in the conversation ring, take the full
   column: the session container stretches and the composer seat + width
   handles hide — same approach as the git-graph view. */
[data-slot='conversation.session']:has([data-ide-view]) > div{flex:1 1 0% !important;min-height:0 !important}
[data-conversation-scroll]:has([data-ide-view]) ~ [data-width-handle]{display:none !important}
[data-slot='conversation.session']:has([data-ide-view]) ~ [data-composer-seat]{display:none}
.ide-root{display:flex;flex-direction:column;height:100%;min-height:0;width:100%;background:var(--ide-bg);color:var(--ide-fg);font:13px/1.4 var(--ds-font-family-sans, -apple-system, 'Segoe UI', sans-serif);overflow:hidden}
.ide-body{display:flex;flex-direction:column;flex:1;min-height:0}
.ide-body-main{display:flex;flex:1;min-height:0}
/* Right sidebar (secondary side bar) — toggled open from the top-right
   toolbar button. Sits to the right of the editor area, inside ide-body-main. */
.ide-sidebar-right{width:var(--ide-sidebar-width,240px);min-width:170px;max-width:560px;flex:none;display:flex;flex-direction:column;min-height:0;background:var(--ide-sidebar-bg);border-left:1px solid var(--ide-border)}
.ide-sidebar-right-header{height:35px;flex:none;display:flex;align-items:center;padding:0 8px 0 16px;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--ide-fg-muted);border-bottom:1px solid var(--ide-border)}
.ide-sidebar-right-title{flex:1}
.ide-sidebar-right-close{flex:none;width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--ide-fg-muted);cursor:pointer;border-radius:4px}
.ide-sidebar-right-close:hover{color:var(--ide-fg);background:var(--ide-tree-hover)}
.ide-sidebar-right-close svg{width:14px;height:14px}
.ide-sidebar-right-body{flex:1;min-height:0;overflow:auto;padding:12px}
.ide-sidebar-right-placeholder{color:var(--ide-fg-muted);font-size:12px;margin:0}
.ide-activitybar{width:48px;flex:none;background:var(--ide-activitybar-bg);display:flex;flex-direction:column;align-items:center;padding:6px 0;gap:1px}
.ide-activitybar-icon{width:48px;height:48px;display:flex;align-items:center;justify-content:center;color:var(--ide-activitybar-fg);cursor:pointer;position:relative;transition:background-color .1s}
.ide-activitybar-icon:hover{background-color:rgba(255,255,255,.06)}
.ide-activitybar-icon[data-active='true']{color:var(--ide-activitybar-active)}
.ide-activitybar-icon[data-active='true']::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--ide-activitybar-active)}
.ide-activitybar-icon:hover{color:var(--ide-fg)}
.ide-activitybar-icon svg{width:24px;height:24px}
.ide-activitybar-badge{position:absolute;top:4px;right:4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#0e639c;color:#fff;font-size:9px;font-weight:600;line-height:16px;text-align:center;box-sizing:border-box;font-family:var(--ds-font-family-sans,-apple-system,'Segoe UI',sans-serif)}
.ide-sidebar{position:relative;width:var(--ide-sidebar-width,240px);min-width:170px;max-width:560px;flex:none;background:var(--ide-sidebar-bg);display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--ide-border)}
/* Collapsed left panel: the activity bar stays, the panel takes no space.
   The hidden attribute cannot do this — the element is display:flex, which
   overrides the attribute display:none. */
.ide-sidebar[data-collapsed='true']{display:none}
/* Right-edge resize grip: a 7px hit strip centered on the 1px border. Hover
   shows the accent line + a small handle icon (Icons.splitEditor). */
.ide-sidebar-resizer{position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;z-index:20;display:flex;align-items:center;justify-content:center}
.ide-sidebar-resizer::before{content:'';position:absolute;top:0;bottom:0;left:3px;width:1px;background:transparent;transition:background-color .12s}
.ide-sidebar-resizer:hover::before,.ide-sidebar-resizer[data-dragging='true']::before{background:var(--ide-accent)}
.ide-sidebar-resizer-icon{pointer-events:none;opacity:0;transition:opacity .12s;display:flex;align-items:center;justify-content:center;width:16px;height:28px;border-radius:4px;background:#252526;border:1px solid #454545;color:var(--ide-fg-muted);box-shadow:0 1px 4px rgba(0,0,0,.4)}
.ide-sidebar-resizer:hover .ide-sidebar-resizer-icon,.ide-sidebar-resizer[data-dragging='true'] .ide-sidebar-resizer-icon{opacity:1}
.ide-sidebar-resizer-icon svg{width:12px;height:12px}
.ide-sidebar-header{height:35px;flex:none;display:flex;align-items:center;padding:0 16px 0 20px;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--ide-fg-muted)}
/* VS Code-style explorer title actions: hidden until the pointer moves over the
   sidebar, then revealed in the header's top-right corner. */
.ide-header-actions{margin-left:auto;display:flex;gap:2px;opacity:0;transition:opacity .12s ease}
.ide-sidebar:hover .ide-header-actions{opacity:1}
.ide-header-action{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;background:transparent;color:var(--ide-fg-muted);cursor:pointer;border-radius:4px;padding:0}
.ide-header-action:hover{background:var(--ide-tree-hover);color:var(--ide-fg)}
.ide-header-action svg{width:16px;height:16px}
.ide-sidebar-body{flex:1;min-height:0;overflow:auto;padding:4px 0}
.ide-sidebar-body::-webkit-scrollbar{width:10px;height:10px}
.ide-sidebar-body::-webkit-scrollbar-thumb{background:#424242;border-radius:5px}
.ide-sidebar-body::-webkit-scrollbar-track{background:transparent}
.ide-editor-area{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--ide-bg);position:relative}
/* Persistent editor toolbar: panel-layout action buttons that are always
   visible (unlike TabBar actions which hide when there are no open tabs). */
.ide-editor-toolbar{flex:none;display:flex;align-items:center;gap:2px;justify-content:flex-end;padding:2px 8px;border-bottom:1px solid var(--ide-border,#2b2b2b);background:var(--ide-bg);min-height:30px}
.ide-editor-stack{flex:1;min-height:0;position:relative;overflow:hidden}
.ide-editor-overlay{position:absolute;inset:0;pointer-events:none;display:flex}
.ide-editor-overlay:empty{display:none}
.ide-tabbar{height:35px;flex:none;display:flex;background:var(--ide-tab-bg);border-bottom:1px solid var(--ide-tab-border);overflow:hidden}
.ide-tabbar-tabs{flex:1;min-width:0;display:flex;overflow-x:auto;overflow-y:hidden}
.ide-tabbar-tabs::-webkit-scrollbar{height:0}
.ide-tabbar-actions{flex:none;display:flex;align-items:center;gap:2px;padding:0 8px}
.ide-tab{display:flex;align-items:center;gap:8px;height:35px;padding:0 12px;background:var(--ide-tab-inactive-bg);color:var(--ide-tab-inactive-fg);cursor:pointer;white-space:nowrap;border-right:1px solid var(--ide-tab-border);font-size:13px}
.ide-tab[data-active='true']{background:var(--ide-tab-active-bg);color:var(--ide-tab-active-fg)}
.ide-tab:hover:not([data-active='true']){background:#2a2d2e;color:var(--ide-fg)}
.ide-tab-name{max-width:200px;overflow:hidden;text-overflow:ellipsis}
.ide-tab-close{width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:4px;opacity:0}
.ide-tab:hover .ide-tab-close,.ide-tab[data-active='true'] .ide-tab-close{opacity:.6}
.ide-tab-close:hover{opacity:1!important;background:rgba(255,255,255,.12)}
.ide-tab-close svg{width:14px;height:14px}
.ide-editor-container{position:absolute;inset:0}
.ide-monaco-host{position:absolute;inset:0}
.ide-editor-image{position:absolute;inset:0;overflow:auto;padding:16px;display:flex;align-items:center;justify-content:center;background:var(--ide-bg)}
.ide-editor-image img{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
/* PDF preview: fill the pane (no padding/centering — an iframe is a page, not
   an object to letterbox). */
.ide-editor-image:has(> .ide-editor-pdf){padding:0;display:block}
.ide-editor-pdf{width:100%;height:100%;border:0;background:#fff;display:block}
/* ── Markdown split preview (VS Code Open-Preview-to-the-Side parity) ── */
.ide-editor-container[data-md-split='true']{inset:0 50% 0 0}
.ide-md-pane{position:absolute;top:0;bottom:0;right:0;width:50%;display:flex;flex-direction:column;background:var(--ide-bg);border-left:1px solid var(--ide-tab-border);z-index:1}
/* Full screen ("Show Preview Full Screen"): the pane owns the whole editor
   area and the split divider goes away. Monaco keeps its node (only covered),
   so the editor is intact the moment full screen is left. */
.ide-md-pane[data-fullscreen]{width:auto;left:0;border-left:none}
.ide-editor-container[data-md-covered='true']{visibility:hidden}
.ide-md-pane-header{height:28px;flex:none;display:flex;align-items:center;gap:4px;padding:0 8px 0 12px;background:var(--ide-tab-bg);border-bottom:1px solid var(--ide-tab-border);font-size:12px;color:var(--ide-fg)}
.ide-md-pane-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.ide-tabbar-action{flex:none;width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--ide-fg-muted);cursor:pointer;border-radius:4px}
.ide-tabbar-action:disabled{opacity:.35;cursor:default}
.ide-tabbar-action:disabled:hover{background:transparent;color:var(--ide-fg-muted)}
.ide-tabbar-action:hover{color:var(--ide-fg);background:var(--ide-tree-hover)}
.ide-tabbar-action[data-active='true']{color:var(--ide-fg);background:var(--ide-tree-active)}
.ide-tabbar-action svg{width:16px;height:16px}
/* Typography adapted from the official markdown preview (markdown.css:
   14px/22px, headings 600, 24/16 margins) on the Dark Modern palette. */
.ide-md-body{flex:1;min-height:0;overflow:auto;padding:12px 24px 24px;font-size:14px;line-height:22px;word-wrap:break-word;color:var(--ide-fg);font-family:var(--ds-font-family-sans,-apple-system,'Segoe UI',sans-serif)}
.ide-md-body h1,.ide-md-body h2,.ide-md-body h3,.ide-md-body h4,.ide-md-body h5,.ide-md-body h6{font-weight:600;line-height:1.25;margin:24px 0 16px}
.ide-md-body h1:first-child,.ide-md-body h2:first-child,.ide-md-body h3:first-child,.ide-md-body h4:first-child{margin-top:8px}
.ide-md-body h1{font-size:28px}
.ide-md-body h2{font-size:22px}
.ide-md-body h3{font-size:18px}
.ide-md-body h4{font-size:15px}
.ide-md-body h5{font-size:14px}
.ide-md-body h6{font-size:13px;color:var(--ide-fg-muted)}
.ide-md-body p{margin:0 0 16px}
.ide-md-body a{color:#4daafc;text-decoration:none}
.ide-md-body a:hover{text-decoration:underline}
.ide-md-body ul,.ide-md-body ol{margin:0 0 16px;padding-left:28px}
.ide-md-body li{margin:2px 0}
.ide-md-body li.ide-md-task{list-style:none;margin-left:-20px;display:flex;align-items:flex-start;gap:6px}
.ide-md-body li.ide-md-task input{margin-top:5px}
.ide-md-body blockquote{margin:0 0 16px;padding:0 12px;border-left:3px solid #3c3c3c;color:var(--ide-fg-muted)}
.ide-md-body code{font-family:var(--ds-font-family-code,Menlo,Consolas,monospace);font-size:12px;background:rgba(255,255,255,.09);border-radius:3px;padding:1px 4px}
.ide-md-body pre{position:relative;background:rgba(255,255,255,.045);border:1px solid #3c3c3c;border-radius:4px;padding:12px;overflow:auto;margin:0 0 16px}
.ide-md-body pre code{background:none;padding:0;font-size:12px;line-height:18px;display:block;white-space:pre}
.ide-md-body pre[data-lang]:not([data-lang=''])::before{content:attr(data-lang);position:absolute;top:4px;right:8px;font-size:10px;color:var(--ide-fg-dim);text-transform:uppercase;letter-spacing:.5px}
.ide-md-body table{border-collapse:collapse;margin:0 0 16px;display:block;overflow-x:auto;max-width:100%}
.ide-md-body th,.ide-md-body td{border:1px solid #3c3c3c;padding:5px 12px;font-size:13px}
.ide-md-body th{background:rgba(255,255,255,.05);font-weight:600}
.ide-md-body hr{border:none;border-top:1px solid #3c3c3c;margin:20px 0}
.ide-md-body img{max-width:100%}
/* Raw README markup. GitHub renders a centred banner as <p align="center">
   holding an <img>; the browser's default UA stylesheet for align= is long
   gone, and a lone <img> is an inline box on a text baseline, so it needs
   both an explicit centring rule and block layout (otherwise the line box
   adds descender space under the image). */
.ide-md-body [align='center'],.ide-md-body [align='middle']{text-align:center}
.ide-md-body [align='right']{text-align:right}
.ide-md-body p>img:only-child,.ide-md-body p>a:only-child>img:only-child{display:inline-block;vertical-align:middle;margin:4px 0}
.ide-md-body details{border:1px solid #3c3c3c;border-radius:4px;padding:0 12px;margin:0 0 16px}
.ide-md-body summary{cursor:pointer;padding:8px 0;font-weight:600}
.ide-md-body details[open]>summary{margin-bottom:8px;border-bottom:1px solid #3c3c3c}
.ide-md-body kbd{font-family:var(--ds-font-family-code,Menlo,Consolas,monospace);font-size:11px;border:1px solid #3c3c3c;border-bottom-width:2px;border-radius:3px;padding:1px 5px;background:rgba(255,255,255,.06)}
.ide-md-body sub,.ide-md-body sup{font-size:75%;line-height:0}
.ide-md-body .ide-md-image-alt{color:var(--ide-fg-muted);font-style:italic}
/* GitHub alerts (> [!NOTE] …). */
.ide-md-alert{margin:0 0 16px;padding:8px 16px;border-left:3px solid #4daafc;border-radius:4px;background:rgba(77,170,252,.08)}
.ide-md-alert-title{margin:0 0 6px;font-weight:600;color:#4daafc}
.ide-md-alert-tip{border-left-color:#3fb950;background:rgba(63,185,80,.08)}
.ide-md-alert-tip .ide-md-alert-title{color:#3fb950}
.ide-md-alert-important{border-left-color:#a371f7;background:rgba(163,113,247,.08)}
.ide-md-alert-important .ide-md-alert-title{color:#a371f7}
.ide-md-alert-warning{border-left-color:#d29922;background:rgba(210,153,34,.08)}
.ide-md-alert-warning .ide-md-alert-title{color:#d29922}
.ide-md-alert-caution{border-left-color:#f85149;background:rgba(248,81,73,.08)}
.ide-md-alert-caution .ide-md-alert-title{color:#f85149}
.ide-md-body .ide-md-link{cursor:pointer}
.ide-md-empty{display:flex;align-items:center;justify-content:center;color:var(--ide-fg-dim);font-style:italic}
.ide-editor-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--ide-fg-dim);font-size:13px;flex-direction:column;gap:8px}
.ide-editor-empty svg{width:48px;height:48px;opacity:.4}
.ide-statusbar{height:22px;flex:none;display:flex;align-items:center;background:var(--ide-statusbar-bg);color:var(--ide-statusbar-fg);font-size:12px;padding:0 8px;gap:12px}
.ide-statusbar-left,.ide-statusbar-right{display:flex;align-items:center;gap:12px}
.ide-statusbar-right{margin-left:auto}
.ide-statusbar-item{display:flex;align-items:center;gap:4px;white-space:nowrap;background:transparent;border:none;color:inherit;font:inherit;cursor:default;padding:0}
.ide-statusbar button.ide-statusbar-item{cursor:pointer}
.ide-statusbar button.ide-statusbar-item:hover{background:rgba(255,255,255,.08)}
/* Branch group: the clickable branch name plus the sync button beside it. */
.ide-statusbar-branch-group{display:inline-flex;align-items:center;gap:0;flex:none}
.ide-statusbar-branch{color:var(--ide-statusbar-fg);font-weight:500;padding:0 4px;border-radius:3px;display:flex;align-items:center;gap:4px;background:transparent;border:none;font-family:inherit;font-size:inherit;cursor:pointer;height:18px}
.ide-statusbar button.ide-statusbar-branch:hover{background:var(--ide-statusbar-active-bg,rgba(255,255,255,.16))}
/* Branches view showing: keep the branch button highlighted like a toggled control. */
.ide-statusbar button.ide-statusbar-branch[data-active='true']{background:var(--ide-statusbar-active-bg,rgba(255,255,255,.16));color:var(--ide-statusbar-active-fg,#fff)}
.ide-statusbar-branch-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.ide-statusbar-branch-icon{display:flex;align-items:center;flex:none}
.ide-statusbar-branch-icon svg{width:13px;height:13px}
.ide-statusbar-terminal{padding:0 6px;height:18px}
.ide-statusbar-terminal[data-active='true']{background:var(--ide-statusbar-active-bg,rgba(255,255,255,.16));color:var(--ide-statusbar-active-fg,#ffffff);border-radius:3px}
.ide-statusbar button.ide-statusbar-terminal[data-active='true']:hover{background:var(--ide-statusbar-active-hover-bg,rgba(255,255,255,.24))}
.ide-statusbar-terminal svg{width:14px;height:14px}
.ide-tree-row{display:flex;align-items:center;gap:4px;height:22px;padding:0 8px;cursor:pointer;user-select:none;color:var(--ide-fg);font-size:13px;white-space:nowrap}
.ide-tree-row:hover{background:var(--ide-tree-hover)}
.ide-tree-row[data-active='true']{background:var(--ide-tree-active)}
.ide-tree-row:focus{outline:none}
.ide-tree-row[data-focused='true']{box-shadow:inset 0 0 0 1px var(--ide-accent,#3794ff)}
.ide-tree-row[data-cut='true']{opacity:.45}
.ide-tree-row[data-drop-target='true']{box-shadow:inset 0 0 0 1px var(--ide-accent,#3794ff);background:rgba(55,148,255,.12)}
.ide-tree-filter{display:flex;align-items:center;gap:4px;margin:2px 8px 6px;height:24px;padding:0 6px;border:1px solid var(--ide-border,#3c3c3c);border-radius:4px;background:var(--ide-bg-elev,#2d2d2d)}
.ide-tree-filter:focus-within{border-color:var(--ide-accent,#3794ff)}
.ide-tree-filter-icon{display:flex;align-items:center;color:var(--ide-fg-dim)}
.ide-tree-filter-icon svg{width:13px;height:13px}
.ide-tree-filter-input{flex:1;min-width:0;background:transparent;border:none;outline:none;color:var(--ide-fg);font-size:12px}
.ide-tree-filter-input::placeholder{color:var(--ide-fg-dim)}
.ide-tree-filter-clear{display:flex;align-items:center;background:transparent;border:none;outline:none;cursor:pointer;color:var(--ide-fg-dim);padding:2px}
.ide-tree-filter-clear:hover{color:var(--ide-fg)}
.ide-tree-filter-clear svg{width:13px;height:13px}
.ide-tree-filter-count{color:var(--ide-fg-dim);font-size:11px;min-width:12px;text-align:right}
.ide-tree-chevron{width:16px;flex:none;display:flex;align-items:center;justify-content:center;color:var(--ide-fg-muted)}
.ide-tree-chevron svg{width:12px;height:12px;transition:transform .1s}
.ide-tree-chevron[data-expanded='true'] svg{transform:rotate(90deg)}
.ide-tree-icon{width:16px;flex:none;display:flex;align-items:center;justify-content:center}
.ide-tree-icon svg{width:16px;height:16px}
.ide-tree-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
/* In-tree rename editor (VS Code style: input replaces the label, accent border). */
.ide-tree-rename-input{flex:1 1 auto;min-width:40px;height:20px;background:#313131;border:1px solid var(--ide-accent);border-radius:2px;color:var(--ide-fg);font:inherit;font-size:13px;padding:0 3px;outline:none}
.ide-tree-rename-input[data-invalid='true']{border-color:#f48771}
.ide-tree-rename-input::selection{background:#264f78}
.ide-tree-rename-error{font-size:11px;line-height:15px;color:#f48771;padding:1px 12px 2px;white-space:normal}
.ide-tree-rename-warning{font-size:11px;line-height:15px;color:#cca700;padding:1px 12px 2px;white-space:normal}
.ide-tree-git-badge{flex:none;margin-left:4px;font-size:11px;font-weight:600;font-family:var(--ds-font-family-sans,-apple-system,'Segoe UI',sans-serif);opacity:.85}
.ide-tree-loading{padding:0 24px;color:var(--ide-fg-dim);font-size:12px;font-style:italic}
.ide-tree-error{padding:8px 16px;color:#f48771;font-size:12px}
.ide-tree-truncated{padding:4px 24px;color:var(--ide-fg-dim);font-size:11px;font-style:italic}
.ide-tab-dirty{color:#cca700;font-size:9px;line-height:1}
.ide-statusbar-dirty{color:#cca700}
.ide-statusbar-conflict{color:#f14c4c}
.ide-dialog-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:40;pointer-events:auto}
/* Window-level modal variant (Explorer delete confirm): fixed to the viewport so
   it does not scroll away inside the tree's scroll container. */
.ide-dialog-backdrop.ide-dialog-modal{position:fixed;z-index:60}
.ide-dialog{background:#1f1f1f;border:1px solid #3c3c3c;border-radius:6px;padding:16px;max-width:460px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.ide-dialog-title{font-weight:600;margin-bottom:8px;color:#cccccc;font-size:13px}
.ide-dialog-body{color:#9d9d9d;font-size:12px;line-height:1.6;margin-bottom:16px}
.ide-dialog-actions{display:flex;gap:8px;justify-content:flex-end}
.ide-dialog-button{background:#0078d4;color:#ffffff;border:none;border-radius:4px;padding:3px 10px;font-size:12px;line-height:1.5;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
.ide-dialog-button:hover{background:#026ec1}
.ide-dialog-button.ide-dialog-button-quiet{background:#3c3c3c;color:#cccccc}
.ide-dialog-button.ide-dialog-button-quiet:hover{background:#4a4a4a}
.ide-dialog-button svg{width:12px;height:12px;flex:none}
[data-slot="rightbar.session"] li[data-files-entry][data-ide-active] > button{background:var(--dsw-alias-state-business-primary, #37373d);color:var(--dsw-alias-label-primary, #ffffff)}
[data-slot="rightbar.session"] div[role="button"][data-ide-active]{background:var(--dsw-alias-state-business-primary, #37373d);color:var(--dsw-alias-label-primary, #ffffff)}
/* ── Source Control panel ─────────────────────────────────────────────── */
.ide-git-panel{position:relative;display:flex;flex-direction:column;height:100%;min-height:0}
/* Discard-confirm dialog anchors to the sidebar panel, not the whole page. */
.ide-git-panel .ide-dialog-backdrop{z-index:30}
.ide-git-panel .ide-dialog{max-width:calc(100vw - 80px);width:calc(100% - 16px)}
.ide-git-header{height:35px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 20px;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--ide-fg-muted)}
.ide-git-header-title{flex:1}
.ide-git-action{flex:none;width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--ide-fg-muted);cursor:pointer;border-radius:4px}
.ide-git-action:hover:not(:disabled){color:var(--ide-fg);background:var(--ide-tree-hover)}
.ide-git-action:disabled{opacity:.5;cursor:default}
.ide-git-action svg{width:16px;height:16px}
.ide-git-body{flex:1;min-height:0;overflow:auto;padding-bottom:8px}
.ide-git-body::-webkit-scrollbar{width:10px;height:10px}
.ide-git-body::-webkit-scrollbar-thumb{background:#424242;border-radius:5px}
.ide-git-body::-webkit-scrollbar-track{background:transparent}
.ide-git-state{display:flex;align-items:center;gap:8px;padding:12px 16px;color:var(--ide-fg-dim);font-size:12px}
.ide-git-state svg{width:16px;height:16px;flex:none}
.ide-git-state.ide-git-error{color:#f48771}
.ide-git-branch{display:flex;align-items:center;gap:6px;padding:4px 12px 4px 16px;color:var(--ide-fg);font-size:12px;cursor:default}
.ide-git-branch-icon{display:flex;align-items:center;color:var(--ide-fg-muted)}
.ide-git-branch-icon svg{width:14px;height:14px}
.ide-git-branch-name{font-weight:500}
.ide-git-branch-ab{color:var(--ide-fg-dim);font-size:11px;margin-left:4px}
.ide-git-input{position:relative;padding:4px 12px 8px;display:flex;flex-direction:column;gap:6px}
.ide-git-input-field{width:100%;box-sizing:border-box;background:#313131;border:1px solid #3c3c3c;border-radius:4px;color:var(--ide-fg);font:13px/1.4 var(--ds-font-family-sans,-apple-system,'Segoe UI',sans-serif);padding:6px 8px;resize:vertical;min-height:40px;outline:none}
.ide-git-input-field:focus{border-color:var(--ide-accent)}
.ide-git-input-field::placeholder{color:var(--ide-fg-dim)}
.ide-git-input-field:disabled{opacity:.6}
.ide-git-input-row{display:flex;align-self:flex-end}
.ide-git-input-action{align-self:stretch;justify-content:center}
.ide-git-input-ab{background:rgba(255,255,255,.18);border-radius:3px;padding:1px 5px;font-weight:400;font-size:11px}
.ide-git-input-button{display:flex;align-items:center;justify-content:center;gap:6px;background:var(--ide-accent);color:#fff;border:none;border-radius:4px;padding:4px 12px;font-size:12px;font-weight:500;cursor:pointer}
.ide-git-input-row .ide-git-input-button:first-child{border-radius:4px 0 0 4px}
.ide-git-input-row .ide-git-input-button:last-child{border-radius:0 4px 4px 0}
.ide-git-input-caret{padding:4px 7px;border-left:1px solid rgba(255,255,255,.22)}
.ide-git-input-button:hover:not(:disabled){background:var(--ide-accent-hover)}
.ide-git-input-button:disabled{opacity:.5;cursor:not-allowed}
.ide-git-input-button svg{width:14px;height:14px}
.ide-git-input-error{padding:4px 12px;color:#f48771;font-size:11px;word-break:break-word}
/* AI commit message generation: shimmer bar over the input while the model
   works (VS Code Copilot-style progress affordance) + stop/retry controls. */
.ide-git-input[data-generating='true'] .ide-git-input-field{border-color:var(--ide-accent)}
.ide-git-input[data-generating='true']::after{content:'';position:absolute;top:5px;left:12px;right:12px;height:2px;border-radius:1px;background:linear-gradient(90deg,transparent,var(--ide-accent),transparent);background-size:200% 100%;background-position:200% 0;animation:ide-shimmer 1.4s linear infinite;pointer-events:none}
@keyframes ide-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ide-git-action-busy{color:var(--ide-accent)}
.ide-git-action-busy:hover:not(:disabled){color:var(--ide-accent)}
.ide-git-action-busy svg{animation:ide-pulse 1.1s ease-in-out infinite}
@keyframes ide-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.ide-git-retry{background:none;border:none;color:var(--ide-accent);cursor:pointer;font:inherit;font-size:11px;padding:0 0 0 6px;text-decoration:underline;text-underline-offset:2px}
.ide-git-retry:hover{color:#4daafc}
.ide-git-section{margin-top:4px}
.ide-git-section-header{display:flex;align-items:center;gap:6px;padding:2px 12px 2px 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--ide-fg-muted);cursor:default}
.ide-git-section-chevron{display:flex;align-items:center;color:var(--ide-fg-muted)}
.ide-git-section-chevron svg{width:12px;height:12px}
.ide-git-section-title{flex:1}
.ide-git-section-count{background:#4d4d4d;color:var(--ide-fg);border-radius:10px;padding:0 6px;font-size:10px;font-weight:600;line-height:16px;min-width:16px;text-align:center}
.ide-git-empty{padding:6px 16px 6px 32px;color:var(--ide-fg-dim);font-size:12px;font-style:italic}
/* ── SCM 可折叠子 panel(源代码管理/图表/分支纵向堆叠,替代头部下拉) ── */
.ide-git-panels{display:flex;flex-direction:column;gap:0;padding:0}
/* 变更 panel 占据上部可滚动区域;图表/分支固定在面板底部(不随变更滚动浮动)。 */
.ide-git-subpanel-top{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}
.ide-git-subpanel-bottom{flex:none;border-top:1px solid var(--ide-border,#2b2b2b)}
.ide-git-subpanel{margin-top:0;border-bottom:1px solid var(--ide-tree-border,#333)}
.ide-git-subpanel:last-child{border-bottom:none}
.ide-git-subpanel-header{padding:0 4px 0 0;cursor:default}
.ide-git-subpanel-toggle{flex:1;min-width:0;display:flex;align-items:center;gap:6px;background:transparent;border:none;color:var(--ide-fg-muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:2px 8px;cursor:pointer;text-align:left;border-radius:4px}
.ide-git-subpanel-toggle:hover{color:var(--ide-fg);background:var(--ide-tree-hover)}
.ide-git-subpanel-toggle:focus-visible{outline:2px solid var(--ide-accent);outline-offset:-2px}
.ide-git-subpanel-toggle .ide-git-section-title{flex:1}
.ide-git-subpanel-toggle svg{width:12px;height:12px;flex:none}
.ide-git-subpanel[data-open='true'] .ide-git-subpanel-toggle{color:var(--ide-fg)}
.ide-git-subpanel .ide-git-action{flex:none}
/* 第一个子 panel 顶部对齐 body,不与边界打架 */
.ide-git-panels .ide-git-subpanel:first-child{margin-top:0}
/* 图表/分支视图自带 toolbar(为旧的全屏 body 设计),嵌进子 panel 后去掉它的顶部
   间距,让它紧贴 panel header;左右 padding 与 header 对齐。 */
.ide-git-subpanel .ide-git-graph-toolbar,
.ide-git-subpanel .ide-git-branches-toolbar{padding:2px 8px 6px 8px}
/* 视图内容行与 panel header 的左缩进对齐(旧值 12px/16px/24px 是全屏 body 时代的)。 */
.ide-git-subpanel .ide-git-graph-item{padding:3px 8px}
.ide-git-subpanel .ide-git-branch-row{padding:3px 8px 3px 16px}
.ide-git-subpanel .ide-git-branch-row[data-remote='true']{padding-left:20px}
.ide-git-subpanel .ide-git-entries .ide-git-entry{padding:0 8px 0 12px}
.ide-git-entries{display:flex;flex-direction:column}
.ide-git-group{display:flex;flex-direction:column}
.ide-git-group-header{display:flex;align-items:center;gap:4px;padding:0 8px 0 8px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ide-fg);min-height:22px;line-height:22px;white-space:nowrap}
.ide-git-group-label{flex:none}
.ide-git-group-count{flex:none;opacity:.75;font-weight:400}
.ide-git-group-actions{flex:none;margin-left:auto;display:none;align-items:center;gap:0}
.ide-git-group-header:hover .ide-git-group-actions{display:inline-flex}
.ide-git-group-action{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:0;background:transparent;color:var(--ide-fg);cursor:pointer;border-radius:3px;padding:0}
.ide-git-group-action:hover{background:var(--ide-tree-hover);color:var(--ide-fg)}
.ide-git-group-action svg{width:16px;height:16px}
.ide-git-entry-hover-actions{display:none;align-items:center;gap:0;margin-left:auto}
.ide-git-entry:hover .ide-git-entry-hover-actions{display:inline-flex}
.ide-git-entry:hover .ide-git-entry-dir{display:none}
.ide-git-group[data-group='merge'] .ide-git-group-label{color:#e2c08d}
.ide-git-entry{display:flex;align-items:center;gap:4px;padding:0 12px 0 20px;font-size:13px;cursor:pointer;color:var(--ide-fg);min-height:22px;line-height:22px;white-space:nowrap}
.ide-git-entry:hover{background:var(--ide-tree-hover)}
.ide-git-entry[data-selected='true']{background:var(--ide-tree-active)}
.ide-git-entry-icon{width:16px;flex:none;display:flex;align-items:center;justify-content:center;color:var(--ide-icon-fg,#c5c5c5)}
.ide-git-entry-icon svg{width:16px;height:16px}
.ide-git-entry-icon[data-kind='modified']{color:#e2c08d}
.ide-git-entry-icon[data-kind='added']{color:#73c991}
.ide-git-entry-icon[data-kind='untracked']{color:#73c991}
.ide-git-entry-icon[data-kind='deleted']{color:#f48771}
.ide-git-entry-icon[data-kind='renamed']{color:#61afef}
.ide-git-entry-icon[data-kind='conflicted']{color:#e2c08d}
.ide-git-entry-name{flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}
.ide-git-entry-name[data-kind='modified']{color:#e2c08d}
.ide-git-entry-name[data-kind='added']{color:#73c991}
.ide-git-entry-name[data-kind='untracked']{color:#73c991}
.ide-git-entry-name[data-kind='deleted']{color:#f48771}
.ide-git-entry-name[data-kind='renamed']{color:#61afef}
.ide-git-entry-name[data-kind='conflicted']{color:#e2c08d}
.ide-git-entry-dir{flex:1 1 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ide-fg-dim);font-size:11px;margin-left:6px}
.ide-git-entry-status{flex:none;width:16px;min-width:16px;text-align:center;font-weight:700;font-size:12px;font-family:var(--ds-font-family-code,Menlo,Consolas,monospace)}
/* Deleted files strike their label, matching VS Code's SCM view (the status
   letter keeps its color). */
.ide-git-entry[data-kind='deleted'] .ide-git-entry-name,
.ide-git-entry[data-kind='deleted'] .ide-git-entry-dir{text-decoration:line-through}
.ide-git-entry-status[data-kind='modified']{color:#e2c08d}
.ide-git-entry-status[data-kind='added']{color:#73c991}
.ide-git-entry-status[data-kind='untracked']{color:#73c991}
.ide-git-entry-status[data-kind='deleted']{color:#f48771}
.ide-git-entry-status[data-kind='renamed']{color:#61afef}
.ide-git-entry-status[data-kind='conflicted']{color:#e2c08d}
/* ── SCM graph + branches views (VS Code Source Control Graph parity) ── */
/* Graph toolbar: branch filter segmented control + fetch/refresh actions. */
.ide-git-graph-toolbar{display:flex;align-items:center;gap:2px;padding:4px 12px 6px 16px}
.ide-git-graph-filter{flex:1;display:flex;background:#313131;border-radius:4px;padding:1px;gap:1px;max-width:200px}
.ide-git-graph-filter-btn{flex:1;background:transparent;border:none;border-radius:3px;color:var(--ide-fg-dim);font-size:11px;padding:2px 8px;cursor:pointer;white-space:nowrap}
.ide-git-graph-filter-btn:hover{color:var(--ide-fg)}
.ide-git-graph-filter-btn[data-active='true']{background:#4d4d4d;color:var(--ide-fg)}
/* Commit rows: swimlane cell + two-line content (subject+refs, author+age). */
.ide-git-graph-list{display:flex;flex-direction:column}
.ide-git-graph-row{border-left:2px solid transparent}
.ide-git-graph-row:hover{background:var(--ide-tree-hover)}
.ide-git-graph-row[data-expanded='true']{background:var(--ide-tree-active)}
.ide-git-graph-row[data-head='true']{border-left-color:var(--ide-accent)}
.ide-git-graph-item{display:flex;align-items:flex-start;gap:6px;padding:3px 12px 3px 12px;cursor:pointer}
.ide-git-graph-cell{flex:none;margin-top:8px}
.ide-git-graph-main{flex:1;min-width:0;padding-top:3px}
.ide-git-graph-subject-row{display:flex;align-items:center;gap:4px;min-width:0}
.ide-git-graph-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--ide-fg);min-width:0}
.ide-git-graph-row[data-expanded='true'] .ide-git-graph-subject{font-weight:600}
/* Ref pills (branches blue, remotes grey-purple, tags amber-grey). */
.ide-git-graph-pill{flex:none;display:inline-flex;align-items:center;gap:2px;border-radius:9px;padding:0 6px;font-size:10px;line-height:16px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#4d4d4d;color:var(--ide-fg);border:1px solid transparent}
.ide-git-graph-pill svg{width:10px;height:10px;flex:none}
.ide-git-graph-pill[data-type='remote']{background:#473a5c;color:#c8b7ea}
.ide-git-graph-pill[data-type='tag']{background:#5c5c3a;color:#e2d67a}
.ide-git-graph-pill[data-current='true']{color:#fff}
/* Second meta line: author · age · HEAD badge. */
.ide-git-graph-meta{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--ide-fg-dim);overflow:hidden;white-space:nowrap}
.ide-git-graph-author{overflow:hidden;text-overflow:ellipsis}
.ide-git-graph-head{flex:none;background:var(--ide-accent);color:#fff;border-radius:3px;padding:0 4px;font-size:9px;font-weight:700;letter-spacing:.5px}
/* Expanded commit details: full message + changed files. */
.ide-git-graph-details{padding:2px 12px 8px 12px}
.ide-git-graph-details-msg{font-size:12px;color:var(--ide-fg);white-space:pre-wrap;word-break:break-word;padding:2px 0 4px;border-left:2px solid #4d4d4d;padding-left:8px}
.ide-git-graph-details-meta{font-size:10px;color:var(--ide-fg-dim);padding-bottom:4px}
.ide-git-graph-details-files{display:flex;flex-direction:column;border-top:1px solid #3c3c3c;padding-top:2px}
.ide-git-graph-details-loading{display:flex;align-items:center;gap:6px;padding:6px 4px;color:var(--ide-fg-dim);font-size:12px}
.ide-git-graph-details-loading svg{width:14px;height:14px}
.ide-git-graph-file{display:flex;align-items:center;gap:4px;padding:2px 4px 2px 10px;font-size:12px;cursor:pointer;color:var(--ide-fg);border-radius:3px;white-space:nowrap}
.ide-git-graph-file:hover{background:var(--ide-tree-hover)}
.ide-git-graph-file-name{overflow:hidden;text-overflow:ellipsis;max-width:55%}
.ide-git-graph-adds{color:#81b88b;font-family:var(--ds-font-family-code,Menlo,Consolas,monospace);font-size:11px}
.ide-git-graph-dels{color:#c74e39;font-family:var(--ds-font-family-code,Menlo,Consolas,monospace);font-size:11px}
.ide-git-graph-file .ide-git-entry-status[data-kind='binary']{color:var(--ide-fg-dim)}
/* Load More row: placeholder lanes keep the open swimlanes visible. */
.ide-git-graph-more{display:flex;align-items:center;gap:8px;background:transparent;border:none;border-top:1px solid #3c3c3c;color:var(--ide-accent);font-size:12px;padding:6px 12px;cursor:pointer;width:100%;text-align:left}
.ide-git-graph-more:hover{background:var(--ide-tree-hover)}
.ide-git-graph-more span{display:flex;align-items:center;gap:6px}
.ide-git-graph-more svg{width:14px;height:14px}
/* Branches view: toolbar + section trees. */
.ide-git-branches-toolbar{display:flex;align-items:center;gap:2px;padding:4px 12px 6px 16px}
.ide-git-branches-new{display:flex;align-items:center;gap:6px;flex:1;background:#313131;border:1px solid #3c3c3c;border-radius:4px;color:var(--ide-fg-dim);font-size:12px;padding:3px 8px;cursor:pointer;max-width:160px}
.ide-git-branches-new:hover{color:var(--ide-fg);background:#3a3a3a}
.ide-git-branches-new svg{width:14px;height:14px}
.ide-git-branch-current{display:flex;align-items:center;gap:6px;padding:2px 12px 4px 16px;color:var(--ide-fg);font-size:12px}
.ide-git-branch-current-icon{display:flex;align-items:center;color:var(--ide-accent)}
.ide-git-branch-current-icon svg{width:14px;height:14px}
.ide-git-branch-current-name{font-weight:600}
.ide-git-branch-row{display:flex;align-items:center;gap:6px;padding:3px 12px 3px 24px;font-size:12px;cursor:pointer;color:var(--ide-fg);white-space:nowrap}
.ide-git-branch-row:hover{background:var(--ide-tree-hover)}
.ide-git-branch-row[data-current='true']{background:var(--ide-tree-active)}
.ide-git-branch-row[data-remote='true']{padding-left:28px}
.ide-git-branch-row-icon{display:flex;align-items:center;color:var(--ide-fg-muted);flex:none}
.ide-git-branch-row-icon svg{width:13px;height:13px}
.ide-git-branch-row[data-current='true'] .ide-git-branch-row-icon{color:#73c991}
.ide-git-branch-row-name{overflow:hidden;text-overflow:ellipsis}
.ide-git-branch-row-remote{color:var(--ide-fg-dim)}
.ide-git-branch-row-ab{color:var(--ide-fg-dim);font-size:11px;font-family:var(--ds-font-family-code,Menlo,Consolas,monospace)}
.ide-git-branch-row-current{margin-left:auto;color:#73c991;font-size:10px}
.ide-git-branch-row-sha{margin-left:auto;color:var(--ide-fg-dim);font-size:10px;font-family:var(--ds-font-family-code,Menlo,Consolas,monospace)}
/* Dialog inputs (create branch). */
.ide-git-branch-input{width:100%;box-sizing:border-box;background:#313131;border:1px solid #3c3c3c;border-radius:4px;color:var(--ide-fg);font:13px/1.4 var(--ds-font-family-sans,-apple-system,'Segoe UI',sans-serif);padding:6px 8px;outline:none;margin-bottom:6px}
.ide-git-branch-input:focus{border-color:var(--ide-accent)}
.ide-git-branch-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ide-fg);cursor:pointer}
/* ── Diff editor view ─────────────────────────────────────────────────── */
/* The diff covers the tab bar + editor (the container stays mounted under it),
   leaving the status bar visible. */
.ide-diff-root{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;background:var(--ide-bg)}
.ide-diff-header{height:28px;flex:none;display:flex;align-items:center;gap:10px;padding:0 12px;background:var(--ide-tab-bg);border-bottom:1px solid var(--ide-tab-border);font-size:12px}
.ide-diff-title{color:var(--ide-fg);font-weight:500}
.ide-diff-path{flex:1;min-width:0;color:var(--ide-fg-dim);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-diff-stats{flex:none;color:var(--ide-fg-dim);font-size:11px;white-space:nowrap;opacity:.8}
.ide-diff-close{flex:none;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--ide-fg-dim);cursor:pointer;border-radius:4px;padding:0}
.ide-diff-close:hover{background:rgba(255,255,255,.12);color:var(--ide-fg)}
.ide-diff-close svg{width:14px;height:14px}
.ide-diff-dirty{flex:none;width:8px;height:8px;border-radius:50%;background:var(--ide-accent,#0078d4);box-shadow:0 0 4px rgba(0,120,212,.8)}
.ide-diff-save-error{flex:none;color:var(--ide-error,#f48771);font-size:11px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:help}
.ide-diff-reload{flex:none;height:22px;padding:0 8px;border:1px solid var(--ide-tab-border);background:transparent;color:var(--ide-fg);font-size:11px;cursor:pointer;border-radius:4px;white-space:nowrap}
.ide-diff-reload:hover{background:rgba(255,255,255,.12)}
.ide-diff-container{flex:1;min-height:0;position:relative}
.ide-diff-overlay{position:absolute;inset:28px 0 0 0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.ide-diff-overlay:empty{display:none}
.ide-diff-empty{display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--ide-fg-dim);font-size:13px}
.ide-diff-empty svg{width:32px;height:32px;opacity:.4}
.ide-diff-image-container{flex:1;min-height:0;overflow:auto;padding:16px;display:flex;align-items:center;justify-content:center;background:var(--ide-bg)}
.ide-diff-image{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.3)}

/* ── Search panel ─────────────────────────────────────────────────────── */
.ide-search-panel{display:flex;flex-direction:column;height:100%;min-height:0}
.ide-search-inputs{padding:8px;border-bottom:1px solid var(--ide-border,#2b2b2b);display:flex;flex-direction:column;gap:6px}
.ide-search-row{display:flex;gap:6px;align-items:stretch}
.ide-search-input{flex:1;min-width:0;background:var(--ide-input-bg,#313131);color:var(--ide-fg,#cccccc);border:1px solid var(--ide-border,#3c3c3c);border-radius:4px;padding:4px 8px;font-size:12px;outline:none}
.ide-search-input:focus{border-color:var(--ide-accent,#0078d4)}
.ide-search-toggle{background:transparent;color:var(--ide-fg-dim,#9d9d9d);border:1px solid transparent;border-radius:4px;padding:4px 8px;font-size:12px;font-weight:600;cursor:pointer}
.ide-search-toggle.is-on{background:var(--ide-accent,#0078d4);color:#fff}
.ide-search-run{background:var(--ide-accent,#0078d4);color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer}
.ide-search-run:disabled{opacity:.5;cursor:default}
.ide-search-results{flex:1;min-height:0;overflow:auto;padding:6px 4px}
.ide-search-hint,.ide-search-error{padding:10px 8px;font-size:12px;color:var(--ide-fg-dim,#9d9d9d)}
.ide-search-error{color:#f48771}
.ide-search-summary{padding:4px 8px 8px;font-size:11px;color:var(--ide-fg-dim,#9d9d9d)}
.ide-search-file{margin-bottom:6px}
.ide-search-file-name{padding:3px 8px;font-size:12px;font-weight:600;color:var(--ide-fg,#cccccc);display:flex;align-items:baseline;gap:6px}
.ide-search-file-dir{font-weight:400;font-size:10px;color:var(--ide-fg-dim,#9d9d9d);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-search-hit{display:flex;width:100%;text-align:left;background:transparent;border:none;color:var(--ide-fg,#cccccc);padding:2px 8px 2px 20px;font-size:12px;cursor:pointer;gap:8px;align-items:baseline}
.ide-search-hit:hover{background:var(--ide-hover,#2a2d2e)}
.ide-search-hit-line{color:var(--ide-fg-dim,#6a9955);min-width:30px;text-align:right;font-variant-numeric:tabular-nums;flex:none}
.ide-search-hit-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-alias-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
/* ── Terminal panel ───────────────────────────────────────────────────── */
.ide-terminal-panel{display:flex;flex-direction:column;flex:none;height:220px;min-height:120px;border-top:1px solid var(--ide-border,#2b2b2b);background:#1f1f1f;position:relative;transition:height .2s ease}
.ide-bottompanel > .ide-terminal-panel{flex:1;min-height:0;height:auto;border-top:none}
.ide-terminal-panel[data-state='minimized']{height:35px !important;min-height:35px !important}
.ide-terminal-panel[data-state='maximized']{height:60vh;min-height:200px}
.ide-bottompanel:has(.ide-terminal-panel[data-state='maximized']){height:60vh}
.ide-bottompanel:has(.ide-terminal-panel[data-state='minimized']){height:35px}
/* The terminal panel has no toolbar: its action buttons live in the bottom
   panel's tab row (see .ide-bottomtabs-actions). */
/* ── Terminal body: hosts (left) + sidebar list (right) ─────────────── */
.ide-terminal-body{display:flex;flex:1;min-height:0;position:relative;overflow:hidden}
.ide-terminal-body[data-hidden]{display:none}
.ide-terminal-sidebar{flex:none;width:160px;min-width:120px;max-width:240px;display:flex;flex-direction:column;border-left:1px solid var(--ide-border,#2b2b2b);background:#1e1e1e;overflow:hidden;transition:width .15s ease,opacity .15s ease}
.ide-terminal-sidebar-header{display:flex;align-items:center;gap:4px;padding:4px 4px 4px 10px;flex:none;border-bottom:1px solid var(--ide-border,#2b2b2b);height:28px}
.ide-terminal-sidebar-title{font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--ide-fg-muted,#9d9d9d);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-terminal-sidebar-new{background:transparent;border:none;color:var(--ide-fg-dim,#9d9d9d);cursor:pointer;padding:2px 4px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex:none}
.ide-terminal-sidebar-new:hover{background:var(--ide-tree-hover,#2a2d2e);color:var(--ide-fg,#cccccc)}
.ide-terminal-sidebar-new svg{width:14px;height:14px}
.ide-terminal-sidebar-list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:2px 0}
.ide-terminal-sidebar-list::-webkit-scrollbar{width:6px}
.ide-terminal-sidebar-list::-webkit-scrollbar-thumb{background:#424242;border-radius:3px}
.ide-terminal-sidebar-list::-webkit-scrollbar-track{background:transparent}
.ide-terminal-sidebar-item{display:flex;align-items:center;gap:6px;padding:3px 4px 3px 6px;cursor:pointer;font-size:12px;color:var(--ide-fg-dim,#9d9d9d);min-width:0;transition:background-color .1s;position:relative}.ide-terminal-sidebar-color{flex:none;width:2px;height:14px;border-radius:1px;align-self:center;background:transparent}.ide-terminal-sidebar-color[data-active='true']{background:#2472c8}
.ide-terminal-sidebar-item:hover{background:var(--ide-tree-hover,#2a2d2e)}
.ide-terminal-sidebar-item[data-active='true']{background:var(--ide-bg,#252526);color:var(--ide-fg,#cccccc)}
.ide-terminal-sidebar-item[data-active='true']::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--ide-fg,#cccccc)}
.ide-terminal-sidebar-item[data-exited]{opacity:.55}
.ide-terminal-sidebar-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-terminal-sidebar-close{flex:none;background:transparent;border:none;color:var(--ide-fg-dim,#9d9d9d);cursor:pointer;padding:2px;border-radius:4px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .1s}
.ide-terminal-sidebar-item:hover .ide-terminal-sidebar-close,.ide-terminal-sidebar-item[data-active='true'] .ide-terminal-sidebar-close{opacity:1}
.ide-terminal-sidebar-close:hover{background:var(--ide-tree-hover,#3a3d41);color:var(--ide-fg,#cccccc)}
.ide-terminal-sidebar-close svg{width:14px;height:14px}.ide-terminal-sidebar-rename{flex:1;min-width:0;background:#3c3c3c;border:1px solid var(--ide-accent,#007acc);color:var(--ide-fg,#cccccc);font-size:12px;font-family:inherit;padding:1px 4px;border-radius:2px;outline:none}.ide-terminal-sidebar-rename:focus{border-color:var(--ide-accent,#007acc)}
/* ── Terminal context menu ──────────────────────────────────────────── */
.ide-terminal-context-overlay{position:fixed;inset:0;z-index:9998;background:transparent}
.ide-terminal-context-menu{position:fixed;z-index:9999;min-width:160px;background:#252526;border:1px solid #454545;border-radius:4px;padding:4px 0;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;flex-direction:column}
.ide-terminal-context-item{display:flex;align-items:center;gap:8px;padding:4px 12px;background:transparent;border:none;color:var(--ide-fg,#cccccc);font-size:12px;font-family:inherit;cursor:pointer;text-align:left;white-space:nowrap}
.ide-terminal-context-item:hover{background:var(--ide-accent,#04395e);color:#fff}
.ide-terminal-context-icon{display:flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}
.ide-terminal-context-icon svg{width:14px;height:14px}
.ide-terminal-actions{display:flex;align-items:center;gap:1px;flex:none}
.ide-terminal-actions .ide-terminal-action{height:22px;padding:2px 5px}
.ide-terminal-actions .ide-terminal-action svg{width:14px;height:14px}
.ide-terminal-action{background:transparent;border:none;color:var(--ide-fg-dim,#9d9d9d);cursor:pointer;padding:4px 6px;border-radius:4px;font-size:12px;display:flex;align-items:center;justify-content:center}
.ide-terminal-action:hover{background:var(--ide-tree-hover,#2a2d2e);color:var(--ide-fg,#cccccc)}
.ide-terminal-action svg{width:16px;height:16px}
.ide-terminal-resizer{flex:none;height:4px;cursor:row-resize;background:transparent;position:relative;z-index:2}.ide-terminal-resizer:hover{background:var(--ide-border,#3b3b3b)}.ide-terminal-resizer::after{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:28px;height:2px;border-radius:1px;background:#424242}.ide-terminal-panel[data-resizing]{transition:none;user-select:none}.ide-terminal-panel[data-resizing] *{user-select:none}.ide-terminal-hosts{flex:1;min-height:0;position:relative;overflow:hidden}.ide-terminal-hosts[data-hidden]{display:none}.ide-terminal-hosts[data-split]{display:flex;flex-direction:row;gap:0}.ide-terminal-hosts[data-split] .ide-terminal-host{flex:1 1 0;min-width:0}.ide-terminal-hosts[data-split] .ide-terminal-host+.ide-terminal-host{border-left:1px solid var(--ide-border,#2b2b2b)}
.ide-terminal-host{height:100%;padding:4px 8px 0;box-sizing:border-box;overflow:hidden}
.ide-terminal-host .xterm{height:100%}
/* xterm paints its own themed selection on its rows/canvas. The browser's
   native selection (an opaque system grey over the canvas) would otherwise
   be stacked on top of it, which reads as "grey leftover text" over the
   history — suppress it everywhere in the terminal; xterm's selection
   colours come from the terminal theme (updateTheme). */
.ide-terminal-host .xterm ::selection{background:transparent}
.ide-terminal-host .xterm canvas{background:transparent}
.ide-terminal-error{padding:10px;font-size:12px;color:#f48771;overflow:auto}
.ide-terminal-error[data-testid=ide-terminal-exited]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--ide-fg-dim,#cccccc)}
.ide-terminal-error[data-testid=ide-terminal-exited] .ide-dialog-button{flex:none;height:22px;padding:0 10px;font-size:11px}
.ide-terminal-empty{padding:20px;font-size:12px;color:var(--ide-fg-dim,#9d9d9d);text-align:center}
.ide-activitybar-spacer{flex:1}
.ide-context-menu{position:fixed;z-index:10000;min-width:200px;max-width:320px;max-height:calc(100vh - 16px);background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.36);padding:4px 0;font:13px/1.4 var(--ds-font-family-sans,-apple-system,'Segoe UI',sans-serif);color:var(--ide-fg);overflow-y:auto;overflow-x:hidden}
.ide-context-menu-separator{height:1px;background:#454545;margin:4px 0}
.ide-context-menu-item{display:flex;align-items:center;gap:8px;padding:0 12px 0 28px;height:26px;cursor:default;user-select:none;white-space:nowrap;position:relative}
.ide-context-menu-item:hover:not([data-disabled='true']){background:var(--ide-accent);color:#fff}
.ide-context-menu-item[data-disabled='true']{color:var(--ide-fg-dim);cursor:default}
/* Informational rows that copy on click: label truncates, muted hint pinned right. */
.ide-context-menu-item:not([data-disabled='true']) .ide-context-menu-item-label,.ide-context-menu-item .ide-context-menu-item-hint{white-space:nowrap}
.ide-context-menu-item .ide-context-menu-item-label{overflow:hidden;text-overflow:ellipsis;min-width:0}
.ide-context-menu-item-hint{flex:none;margin-left:12px;padding-left:12px;border-left:1px solid #454545;font-size:11px;color:var(--ide-fg-dim,#9d9d9d)}
/* Right-aligned action affordance (e.g. the copy icon on the project path row):
   keeps the label at full width and only lights up on row hover. */
.ide-context-menu-item-action{flex:none;display:flex;align-items:center;margin-left:12px;color:var(--ide-fg-dim,#9d9d9d)}
.ide-context-menu-item-action svg{width:14px;height:14px}
.ide-context-menu-item:hover:not([data-disabled='true']) .ide-context-menu-item-action{color:#fff}
.ide-context-menu-item:hover:not([data-disabled='true']) .ide-context-menu-item-hint{color:#d8d8d8;border-left-color:#5a5a5a}
.ide-context-menu-item-icon{position:absolute;left:6px;display:flex;align-items:center;color:inherit}
.ide-context-menu-item-icon svg{width:14px;height:14px}
.ide-context-menu-item-label{flex:1;overflow:hidden;text-overflow:ellipsis}

/* ── Settings / About / Keybindings / Snippets dialogs ─────────────── */
.ide-settings-dialog{max-width:560px;width:min(560px,92vw);display:flex;flex-direction:column;max-height:80vh}
.ide-settings-header{display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--ide-border)}
.ide-settings-title{font-weight:600;color:var(--ide-fg);font-size:13px;flex:1}
.ide-settings-search{flex:1.2;background:var(--ide-bg);border:1px solid var(--ide-border);border-radius:4px;color:var(--ide-fg);padding:5px 8px;font-size:12px}
.ide-settings-body{overflow:auto;padding:12px 4px}
.ide-settings-section{margin-bottom:16px}
.ide-settings-section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--ide-fg-muted);margin-bottom:6px}
.ide-settings-row{display:flex;align-items:center;justify-content:space-between;padding:5px 0;gap:12px}
.ide-settings-row-label{color:var(--ide-fg);font-size:12px}
.ide-settings-select{background:var(--ide-bg);border:1px solid var(--ide-border);border-radius:4px;color:var(--ide-fg);padding:4px 8px;font-size:12px;min-width:160px}
.ide-settings-number{background:var(--ide-bg);border:1px solid var(--ide-border);border-radius:4px;color:var(--ide-fg);padding:4px 8px;font-size:12px;width:88px;min-width:88px;flex:none;box-sizing:border-box;text-align:right}
.ide-settings-toggle{position:relative;display:inline-block;width:34px;height:18px;cursor:pointer}
.ide-settings-toggle input{opacity:0;width:0;height:0}
.ide-settings-toggle span{position:absolute;inset:0;background:#3c3c3c;border-radius:9px;transition:.15s}
.ide-settings-toggle span:before{content:'';position:absolute;width:12px;height:12px;left:3px;top:3px;background:#cccccc;border-radius:50%;transition:.15s}
.ide-settings-toggle input:checked + span{background:var(--ide-accent)}
.ide-settings-toggle input:checked + span:before{transform:translateX(16px);background:#ffffff}
.ide-settings-actions{display:flex;gap:8px}
.ide-settings-error{color:#f14c4c;font-size:12px;padding:4px 0}
.ide-about-body{text-align:center;padding:8px 0}
.ide-about-logo{font-size:24px;font-weight:700;color:var(--ide-accent);margin-bottom:4px}
.ide-about-name{font-size:15px;font-weight:600;color:var(--ide-fg)}
.ide-about-version{font-size:12px;color:var(--ide-fg-muted);margin-bottom:12px}
.ide-about-rows{display:flex;flex-direction:column;gap:4px;text-align:left}
.ide-about-rows div{display:flex;justify-content:space-between;font-size:12px}
.ide-about-rows dt{color:var(--ide-fg-muted)}
.ide-about-rows dd{color:var(--ide-fg);margin:0}
.ide-kb-list{display:flex;flex-direction:column}
.ide-kb-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--ide-border)}
.ide-kb-command{flex:1;color:var(--ide-fg);font-size:12px}
.ide-kb-keys{min-width:120px;text-align:right;color:var(--ide-fg-muted);font-size:12px;font-family:var(--ds-font-family-code,Menlo,monospace)}
.ide-kb-edit{background:transparent;border:1px solid var(--ide-border);border-radius:4px;color:var(--ide-fg-muted);font-size:11px;padding:3px 8px;cursor:pointer}
.ide-kb-edit:hover{color:var(--ide-fg);border-color:var(--ide-accent)}
.ide-kb-edit[data-active='true']{background:var(--ide-accent);color:#fff;border-color:var(--ide-accent)}
.ide-snippets-hint{font-size:11px;color:var(--ide-fg-muted);margin-bottom:8px;line-height:1.5}
.ide-snippets-editor{width:100%;min-height:220px;background:var(--ide-bg);border:1px solid var(--ide-border);border-radius:4px;color:var(--ide-fg);font:12px/1.5 var(--ds-font-family-code,Menlo,monospace);padding:8px;resize:vertical;box-sizing:border-box}
.ide-snippets-status{color:#4ec9b0;font-size:12px;padding:4px 0}
/* ── Command palette ───────────────────────────────────────────────── */
.ide-palette-backdrop{position:fixed;inset:0;z-index:70;display:flex;justify-content:center;padding-top:10vh;background:rgba(0,0,0,.25);pointer-events:auto}
.ide-palette{width:min(560px,92vw);background:var(--ide-tab-bg);border:1px solid var(--ide-border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;flex-direction:column;max-height:60vh;overflow:hidden}
.ide-palette-input{margin:8px;padding:7px 10px;background:var(--ide-bg);border:1px solid var(--ide-accent);border-radius:4px;color:var(--ide-fg);font-size:13px;outline:none}
.ide-palette-list{overflow:auto;padding-bottom:6px}
.ide-palette-item{display:flex;align-items:center;gap:8px;padding:6px 14px;font-size:12px;color:var(--ide-fg);cursor:pointer}
.ide-palette-item[data-selected='true']{background:var(--ide-accent);color:#fff}
.ide-palette-item[data-disabled='true']{color:var(--ide-fg-dim)}
.ide-palette-category{color:var(--ide-fg-muted);font-size:11px}
.ide-palette-item[data-selected='true'] .ide-palette-category{color:rgba(255,255,255,.75)}
.ide-palette-label{flex:1}
.ide-palette-keys{font-family:var(--ds-font-family-code,Menlo,monospace);font-size:11px;color:var(--ide-fg-muted)}
.ide-palette-item[data-selected='true'] .ide-palette-keys{color:rgba(255,255,255,.75)}
.ide-palette-empty{padding:16px;text-align:center;color:var(--ide-fg-muted);font-size:12px}
/* ── Notifications ─────────────────────────────────────────────────── */
.ide-notify-root{position:relative;display:inline-flex}
.ide-notify-bell{position:relative}
.ide-notify-bell[data-has-unseen='true']::after{content:'';position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:#f14c4c}
.ide-notify-panel{position:absolute;bottom:24px;right:0;width:320px;background:var(--ide-tab-bg);border:1px solid var(--ide-border);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);z-index:80;overflow:hidden}
.ide-notify-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;font-size:12px;font-weight:600;color:var(--ide-fg);border-bottom:1px solid var(--ide-border)}
.ide-notify-clear{background:transparent;border:none;color:var(--ide-fg-muted);font-size:11px;cursor:pointer}
.ide-notify-clear:hover{color:var(--ide-fg)}
.ide-notify-list{max-height:280px;overflow:auto}
.ide-notify-item{display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-bottom:1px solid var(--ide-border);font-size:12px}
.ide-notify-sev svg{width:13px;height:13px}
.ide-notify-error .ide-notify-sev{color:#f14c4c}
.ide-notify-warning .ide-notify-sev{color:#cca700}
.ide-notify-info .ide-notify-sev{color:#3794ff}
.ide-notify-msg{flex:1;color:var(--ide-fg);word-break:break-word}
.ide-notify-time{color:var(--ide-fg-dim);font-size:11px}
.ide-notify-empty{padding:16px;text-align:center;color:var(--ide-fg-muted);font-size:12px}
.ide-toasts{position:absolute;right:12px;bottom:30px;display:flex;flex-direction:column;gap:6px;z-index:90;pointer-events:none}
.ide-toast{display:flex;align-items:center;gap:8px;background:var(--ide-tab-bg);border:1px solid var(--ide-border);border-left:3px solid var(--ide-accent);border-radius:4px;padding:8px 12px;font-size:12px;color:var(--ide-fg);box-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:auto;cursor:pointer;max-width:360px}
.ide-toast-error{border-left-color:#f14c4c}
.ide-toast-warning{border-left-color:#cca700}
.ide-toast-sev{display:flex}
.ide-toast-sev svg{width:13px;height:13px}
.ide-toast-error .ide-toast-sev{color:#f14c4c}
.ide-toast-warning .ide-toast-sev{color:#cca700}
.ide-toast-msg{flex:1}
.ide-toast-close{color:var(--ide-fg-dim);display:flex}
.ide-toast-close svg{width:12px;height:12px}
/* ── Problems panel + bottom tabs ──────────────────────────────────── */
.ide-bottompanel{display:flex;flex-direction:column;flex:none;min-height:0;overflow:hidden;height:220px;border-top:1px solid var(--ide-border,#2b2b2b);background:#1f1f1f}
.ide-bottomtabs{display:flex;align-items:stretch;gap:2px;padding:0 4px 0 8px;border-bottom:1px solid var(--ide-border);background:var(--ide-sidebar-bg)}
/* Right end of the tab row: the terminal's action buttons are portaled here. */
.ide-bottomtabs-actions{display:flex;align-items:center;margin-left:auto;padding-left:8px;flex:none}
.ide-bottomtab{background:transparent;border:none;color:var(--ide-fg-muted);font-size:11px;letter-spacing:.5px;text-transform:uppercase;padding:6px 10px;cursor:pointer;border-bottom:1px solid transparent;display:flex;align-items:center;gap:6px}
.ide-bottomtab[data-active='true']{color:var(--ide-fg);border-bottom-color:var(--ide-fg)}
.ide-bottomtab-count{background:#f14c4c;color:#fff;border-radius:8px;font-size:10px;padding:0 5px;min-width:14px;text-align:center}
.ide-bottom-problems{flex:1;min-height:0;overflow:auto;background:var(--ide-bg)}
.ide-problems{padding:8px 12px}
.ide-problems-empty{padding:24px;text-align:center;color:var(--ide-fg-muted);font-size:12px}
.ide-problems-group{margin-bottom:8px}
.ide-vscode{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--ide-bg);z-index:3}
.ide-vscode-bar{display:flex;align-items:center;gap:8px;padding:4px 10px;border-bottom:1px solid var(--ide-border);flex:none}
.ide-vscode-title{font-size:12px;font-weight:600;color:var(--ide-fg)}
.ide-vscode-origin{font-size:11px;color:var(--ide-fg-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.ide-vscode-actions{display:flex;gap:4px;flex:none}
.ide-vscode-action{background:none;border:1px solid var(--ide-border);border-radius:3px;color:var(--ide-fg);font-size:11px;padding:2px 8px;cursor:pointer}
.ide-vscode-action:hover{background:var(--ide-tree-hover)}
.ide-vscode-frame{flex:1;width:100%;border:none;background:#1e1e1e}
.ide-vscode-loading,.ide-vscode-error{display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;flex:1;font-size:12px;color:var(--ide-fg-muted);padding:20px;text-align:center}
.ide-vscode-error{color:var(--ide-fg)}
.ide-debug{padding:0 0 4px}
.ide-debug-toolbar{display:flex;align-items:center;gap:4px;padding:6px 12px 4px;border-bottom:1px solid var(--ide-border)}
.ide-debug-action{background:none;border:none;padding:2px;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;color:var(--ide-fg);cursor:pointer;border-radius:3px}
.ide-debug-action:hover:not(:disabled){background:var(--ide-tree-hover)}
.ide-debug-action:disabled{opacity:.35;cursor:default}
.ide-debug-status{margin-left:6px;font-size:11px;color:var(--ide-fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-debug-status[data-status='paused']{color:#e2c08d}
.ide-debug-status[data-status='running']{color:#3fb950}
.ide-debug-hint{padding:4px 12px;font-size:11px;color:var(--ide-fg-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-debug-hint code{font-size:10px;color:var(--ide-fg-muted)}
.ide-debug-section{margin-top:4px}
.ide-debug-frame{display:flex;align-items:baseline;gap:8px;padding:2px 12px;font-size:12px;cursor:pointer;color:var(--ide-fg)}
.ide-debug-frame:hover{background:var(--ide-tree-hover)}
.ide-debug-frame[data-active='true']{background:var(--ide-tree-active)}
.ide-debug-frame-fn{flex:none;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-debug-frame-loc{font-size:11px;color:var(--ide-fg-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-debug-console{max-height:180px;overflow:auto;padding:2px 12px;font-family:Menlo,Consolas,monospace;font-size:11px;line-height:1.5}
.ide-debug-console-line{white-space:pre-wrap;word-break:break-word}
.ide-debug-console-line[data-kind='input']{color:#4daafc}
.ide-debug-console-line[data-kind='system']{color:var(--ide-fg-dim);font-style:italic}
.ide-debug-input-row{padding:2px 12px 0}
.ide-debug-input{width:100%;box-sizing:border-box;background:var(--ide-input-bg);border:1px solid var(--ide-border);border-radius:2px;color:var(--ide-fg);font-family:Menlo,Consolas,monospace;font-size:11px;padding:3px 6px;outline:none}
.ide-debug-input:focus{border-color:#4daafc}
.ide-debug-input:disabled{opacity:.5}
.ide-runview{padding:4px 0;overflow:auto;height:100%}
.ide-runview-section{margin-bottom:6px}
.ide-runview-header{display:flex;align-items:center;justify-content:space-between;padding:6px 12px 4px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--ide-fg-muted);letter-spacing:.04em}
.ide-runview-badge{color:#4daafc}
.ide-runview-empty{padding:8px 12px;font-size:12px;color:var(--ide-fg-dim)}
.ide-runview-task{display:flex;align-items:center;gap:8px;padding:3px 12px;font-size:12px;color:var(--ide-fg);cursor:pointer}
.ide-runview-task:hover{background:var(--ide-tree-hover)}
.ide-runview-task-icon{display:inline-flex;width:14px;height:14px;color:#4daafc}
.ide-runview-task-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-runview-task-source{font-size:10px;color:var(--ide-fg-dim);text-transform:uppercase}
.ide-runview-run{display:flex;align-items:center;gap:8px;padding:3px 12px;font-size:12px;color:var(--ide-fg)}
.ide-runview-status{display:inline-flex;width:14px;height:14px}
.ide-runview-status-running{color:#4daafc}
.ide-runview-status-succeeded{color:#3fb950}
.ide-runview-status-failed{color:#f14c4c}
.ide-runview-status-cancelled{color:var(--ide-fg-muted)}
.ide-runview-run-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-runview-run-state{font-size:11px;color:var(--ide-fg-dim)}
.ide-runview-breakpoint{display:flex;align-items:center;gap:8px;padding:3px 12px;font-size:12px;cursor:pointer;color:var(--ide-fg)}
.ide-runview-breakpoint:hover{background:var(--ide-tree-hover)}
.ide-runview-breakpoint-dot{width:8px;height:8px;border-radius:50%;background:#e51400;flex:none}
.ide-runview-breakpoint-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-runview-breakpoint-line{font-size:11px;color:var(--ide-fg-dim)}
.ide-runview-breakpoint-remove{background:none;border:none;color:var(--ide-fg-dim);cursor:pointer;padding:0;display:inline-flex;width:12px;height:12px}
.ide-runview-breakpoint-remove:hover{color:var(--ide-fg)}
.ide-runview-clear{background:none;border:none;color:var(--ide-fg-dim);cursor:pointer;font-size:11px;padding:0;text-transform:none}
.ide-runview-clear:hover{color:var(--ide-fg)}
.ide-breakpoint-glyph{background:radial-gradient(circle at center,#e51400 0 45%,transparent 46%);cursor:pointer}
.ide-problems-file{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px}
.ide-problems-file-name{color:var(--ide-fg);font-weight:600}
.ide-problems-file-path{color:var(--ide-fg-dim);font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis}
.ide-problems-file-count{color:var(--ide-fg-muted);font-size:11px}
.ide-problems-item{display:flex;align-items:center;gap:8px;padding:3px 0 3px 16px;font-size:12px;cursor:pointer;color:var(--ide-fg)}
.ide-problems-item:hover{background:var(--ide-tree-hover)}
.ide-problems-icon svg{width:13px;height:13px}
.ide-problems-error{color:#f14c4c}
.ide-problems-warning{color:#cca700}
.ide-problems-info{color:#3794ff}
.ide-problems-message{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-problems-pos{color:var(--ide-fg-dim);font-size:11px}
/* ── Extensions view ───────────────────────────────────────────────── */
.ide-extensions{padding:12px}
.ide-extensions-note{font-size:12px;color:var(--ide-fg-muted);line-height:1.6;margin-bottom:12px}
.ide-extensions-list{display:flex;flex-direction:column;gap:6px}
.ide-extensions-item{display:flex;align-items:center;gap:10px;background:var(--ide-tree-hover);border-radius:6px;padding:10px 12px}
.ide-extensions-badge{background:var(--ide-accent);color:#fff;font-size:10px;border-radius:3px;padding:1px 6px;text-transform:uppercase}
.ide-extensions-name{flex:1;font-size:13px;color:var(--ide-fg)}
.ide-extensions-enabled{color:#4ec9b0;font-size:11px}
/* ── Status bar additions ──────────────────────────────────────────── */
.ide-statusbar-remote svg{width:13px;height:13px}
.ide-statusbar-remote-icon{display:inline-flex;margin-right:4px}
/* VS Code's synchronize affordance: a codicon-style circular arrow next to the
   branch, with the ahead/behind counts inline. Spins while a sync is running. */
.ide-statusbar-sync{display:inline-flex;align-items:center;gap:2px;padding:0 4px;margin-left:1px;height:18px;border:none;background:transparent;color:inherit;font:inherit;font-size:11px;cursor:pointer;border-radius:3px}
.ide-statusbar button.ide-statusbar-sync:hover{background:var(--ide-statusbar-active-bg,rgba(255,255,255,.16))}
.ide-statusbar-sync:disabled{cursor:default;opacity:.75}
/* Nothing to pull or push: the icon stays visible but muted. */
.ide-statusbar-sync[data-idle]{opacity:.45}
.ide-statusbar-sync-ring{display:inline-flex;align-items:center}
.ide-statusbar-sync svg{width:13px;height:13px}
.ide-statusbar-sync[data-busy] .ide-statusbar-sync-ring{animation:ide-sync-spin .9s linear infinite}
@keyframes ide-sync-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.ide-statusbar-sync-count{font-size:11px;color:var(--ide-fg-muted);font-variant-numeric:tabular-nums}
.ide-statusbar-problems{gap:4px}
.ide-statusbar-problems[data-active='true']{background:var(--ide-accent,#007acc)}
.ide-statusbar-prob-icon{display:inline-flex;margin:0 1px 0 4px}
.ide-statusbar-prob-icon svg{width:12px;height:12px}
.ide-statusbar-prob-error{color:#f14c4c}
.ide-statusbar-prob-warn{color:#cca700}
`

/** Monaco theme definition matching VSCode Dark Modern (Dark+ equivalent). */
export const MONACO_DARK_MODERN = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a9955' },
    { token: 'keyword', foreground: '569cd6' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'number', foreground: 'b5cea8' },
    { token: 'type', foreground: '4ec9b0' },
    { token: 'type.identifier', foreground: '4ec9b0' },
    { token: 'identifier', foreground: '9cdcfe' },
    { token: 'function', foreground: 'dcdcaa' },
    { token: 'variable', foreground: '9cdcfe' },
    { token: 'variable.predefined', foreground: '4fc1ff' },
    { token: 'variable.parameter', foreground: '9cdcfe' },
    { token: 'tag', foreground: '569cd6' },
    { token: 'attribute.name', foreground: '9cdcfe' },
    { token: 'attribute.value', foreground: 'ce9178' },
    { token: 'delimiter', foreground: '808080' },
    { token: 'operator', foreground: 'd4d4d4' },
    { token: 'key', foreground: '9cdcfe' },
    { token: 'string.key.json', foreground: '9cdcfe' },
    { token: 'string.value.json', foreground: 'ce9178' },
    { token: 'keyword.json', foreground: '569cd6' },
  ],
  colors: {
    'editor.background': '#1f1f1f',
    'editor.foreground': '#cccccc',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#c6c6c6',
    'editor.selectionBackground': '#264f78',
    'editor.inactiveSelectionBackground': '#3a3d41',
    'editor.lineHighlightBackground': '#2a2a2a',
    'editorCursor.foreground': '#aeafad',
    'editorIndentGuide.background': '#404040',
    'editorIndentGuide.activeBackground': '#707070',
    'editorGutter.background': '#1f1f1f',
    'editorWidget.background': '#252526',
    'editorWidget.border': '#454545',
    'editorSuggestWidget.background': '#252526',
    'editorSuggestWidget.selectedBackground': '#04395e',
    'editorHoverWidget.background': '#252526',
    'scrollbarSlider.background': '#79797966',
    'scrollbarSlider.hoverBackground': '#646464b3',
    'scrollbarSlider.activeBackground': '#bfbfbf66',
    'minimap.background': '#1f1f1f',
  },
}

/** Define the Dark Modern Monaco theme once per Monaco load. */
export function defineDarkModernTheme(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme('dsh-dark-modern', MONACO_DARK_MODERN as Parameters<typeof monaco.editor.defineTheme>[1])
}

/** Monaco theme definition matching VSCode Light Modern (Light+ equivalent). */
export const MONACO_LIGHT_MODERN = {
  base: 'vs' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '008000' },
    { token: 'keyword', foreground: '0000ff' },
    { token: 'string', foreground: 'a31515' },
    { token: 'number', foreground: '098658' },
    { token: 'type', foreground: '267f99' },
    { token: 'type.identifier', foreground: '267f99' },
    { token: 'identifier', foreground: '001080' },
    { token: 'function', foreground: '795e26' },
    { token: 'variable', foreground: '001080' },
    { token: 'variable.predefined', foreground: '0070c1' },
    { token: 'variable.parameter', foreground: '001080' },
    { token: 'tag', foreground: '800000' },
    { token: 'attribute.name', foreground: 'e50000' },
    { token: 'attribute.value', foreground: '0451a5' },
    { token: 'delimiter', foreground: '000000' },
    { token: 'operator', foreground: '000000' },
    { token: 'key', foreground: '0451a5' },
    { token: 'string.key.json', foreground: '0451a5' },
    { token: 'string.value.json', foreground: 'a31515' },
    { token: 'keyword.json', foreground: '0000ff' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#3b3b3b',
    'editorLineNumber.foreground': '6e7681',
    'editorLineNumber.activeForeground': '171184',
    'editor.selectionBackground': 'add6ff',
    'editor.inactiveSelectionBackground': 'e4e6f1',
    'editor.lineHighlightBackground': 'f2f2f2',
    'editorCursor.foreground': '000000',
    'editorIndentGuide.background': 'd3d3d3',
    'editorIndentGuide.activeBackground': '929292',
    'editorGutter.background': '#ffffff',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#cecece',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.selectedBackground': 'e4e6f1',
    'editorHoverWidget.background': '#ffffff',
    'scrollbarSlider.background': '64646466',
    'scrollbarSlider.hoverBackground': '646464b3',
    'scrollbarSlider.activeBackground': '00000066',
    'minimap.background': '#ffffff',
  },
}

/** Define both Monaco themes once per Monaco load (dark is the default). */
export function defineIdeThemes(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme('dsh-dark-modern', MONACO_DARK_MODERN as Parameters<typeof monaco.editor.defineTheme>[1])
  monaco.editor.defineTheme('dsh-light-modern', MONACO_LIGHT_MODERN as Parameters<typeof monaco.editor.defineTheme>[1])
}

/** CSS-variable set for a theme id. */
export function cssVarsForTheme(theme: 'dark-modern' | 'light-modern'): Record<string, string> {
  return theme === 'light-modern' ? IDE_CSS_VARS_LIGHT : IDE_CSS_VARS
}

/** Monaco theme name for a theme id. */
export function monacoThemeFor(theme: 'dark-modern' | 'light-modern'): string {
  return theme === 'light-modern' ? 'dsh-light-modern' : 'dsh-dark-modern'
}

