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

/** Inline stylesheet injected once when the IDE mounts. VSCode-style geometry. */
export const IDE_STYLES = `
/* While the IDE view is mounted in the conversation ring, take the full
   column: the session container stretches and the composer seat + width
   handles hide — same approach as the git-graph view. */
[data-slot='conversation.session']:has([data-ide-view]) > div{flex:1 1 0% !important;min-height:0 !important}
[data-conversation-scroll]:has([data-ide-view]) ~ [data-width-handle]{display:none !important}
[data-slot='conversation.session']:has([data-ide-view]) ~ [data-composer-seat]{display:none}
.ide-root{display:flex;flex-direction:column;height:100%;min-height:0;width:100%;background:var(--ide-bg);color:var(--ide-fg);font:13px/1.4 var(--ds-font-family-sans, -apple-system, 'Segoe UI', sans-serif);overflow:hidden}
.ide-body{display:flex;flex:1;min-height:0}
.ide-activitybar{width:48px;flex:none;background:var(--ide-activitybar-bg);display:flex;flex-direction:column;align-items:center;padding:6px 0;gap:1px}
.ide-activitybar-icon{width:48px;height:48px;display:flex;align-items:center;justify-content:center;color:var(--ide-activitybar-fg);cursor:pointer;position:relative;transition:background-color .1s}
.ide-activitybar-icon:hover{background-color:rgba(255,255,255,.06)}
.ide-activitybar-icon[data-active='true']{color:var(--ide-activitybar-active)}
.ide-activitybar-icon[data-active='true']::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--ide-activitybar-active)}
.ide-activitybar-icon:hover{color:var(--ide-fg)}
.ide-activitybar-icon svg{width:24px;height:24px}
.ide-activitybar-badge{position:absolute;top:4px;right:4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#0e639c;color:#fff;font-size:9px;font-weight:600;line-height:16px;text-align:center;box-sizing:border-box;font-family:var(--ds-font-family-sans,-apple-system,'Segoe UI',sans-serif)}
.ide-sidebar{position:relative;width:var(--ide-sidebar-width,240px);min-width:170px;max-width:560px;flex:none;background:var(--ide-sidebar-bg);display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--ide-border)}
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
/* ── Markdown split preview (VS Code Open-Preview-to-the-Side parity) ── */
.ide-editor-container[data-md-split='true']{inset:0 50% 0 0}
.ide-md-pane{position:absolute;top:0;bottom:0;right:0;width:50%;display:flex;flex-direction:column;background:var(--ide-bg);border-left:1px solid var(--ide-tab-border);z-index:1}
.ide-md-pane-header{height:28px;flex:none;display:flex;align-items:center;gap:4px;padding:0 8px 0 12px;background:var(--ide-tab-bg);border-bottom:1px solid var(--ide-tab-border);font-size:12px;color:var(--ide-fg)}
.ide-md-pane-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.ide-tabbar-action{flex:none;width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--ide-fg-muted);cursor:pointer;border-radius:4px}
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
.ide-md-body .ide-md-link{cursor:pointer}
.ide-md-empty{display:flex;align-items:center;justify-content:center;color:var(--ide-fg-dim);font-style:italic}
.ide-editor-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--ide-fg-dim);font-size:13px;flex-direction:column;gap:8px}
.ide-editor-empty svg{width:48px;height:48px;opacity:.4}
.ide-statusbar{height:22px;flex:none;display:flex;align-items:center;background:var(--ide-statusbar-bg);color:var(--ide-statusbar-fg);font-size:12px;padding:0 8px;gap:12px}
.ide-statusbar-left,.ide-statusbar-right{display:flex;align-items:center;gap:12px}
.ide-statusbar-right{margin-left:auto}
.ide-statusbar-item{display:flex;align-items:center;gap:4px;white-space:nowrap}
.ide-tree-row{display:flex;align-items:center;gap:4px;height:22px;padding:0 8px;cursor:pointer;user-select:none;color:var(--ide-fg);font-size:13px;white-space:nowrap}
.ide-tree-row:hover{background:var(--ide-tree-hover)}
.ide-tree-row[data-active='true']{background:var(--ide-tree-active)}
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
.ide-statusbar-dirty{color:#cca700;background:none;border:none;font:inherit;padding:0;cursor:pointer}
.ide-statusbar-conflict{color:#f14c4c}
.ide-dialog-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:40;pointer-events:auto}
/* Window-level modal variant (Explorer delete confirm): fixed to the viewport so
   it does not scroll away inside the tree's scroll container. */
.ide-dialog-backdrop.ide-dialog-modal{position:fixed;z-index:60}
.ide-dialog{background:#1f1f1f;border:1px solid #3c3c3c;border-radius:6px;padding:16px;max-width:460px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.ide-dialog-title{font-weight:600;margin-bottom:8px;color:#cccccc;font-size:13px}
.ide-dialog-body{color:#9d9d9d;font-size:12px;line-height:1.6;margin-bottom:16px}
.ide-dialog-actions{display:flex;gap:8px;justify-content:flex-end}
.ide-dialog-button{background:#0078d4;color:#ffffff;border:none;border-radius:4px;padding:6px 14px;font-size:12px;cursor:pointer}
.ide-dialog-button:hover{background:#026ec1}
.ide-dialog-button.ide-dialog-button-quiet{background:#3c3c3c;color:#cccccc}
.ide-dialog-button.ide-dialog-button-quiet:hover{background:#4a4a4a}
[data-slot="rightbar.session"] li[data-files-entry][data-ide-active] > button{background:var(--dsw-alias-state-business-primary, #37373d);color:var(--dsw-alias-label-primary, #ffffff)}
[data-slot="rightbar.session"] div[role="button"][data-ide-active]{background:var(--dsw-alias-state-business-primary, #37373d);color:var(--dsw-alias-label-primary, #ffffff)}
/* ── Source Control panel ─────────────────────────────────────────────── */
.ide-git-panel{position:relative;display:flex;flex-direction:column;height:100%;min-height:0}
/* Discard-confirm dialog anchors to the sidebar panel, not the whole page. */
.ide-git-panel .ide-dialog-backdrop{z-index:30}
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
.ide-git-entries{display:flex;flex-direction:column}
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
/* Header view switcher (VS Code's SCM view picker button). */
.ide-git-header-switch{flex:1;min-width:0;display:flex;align-items:center;gap:4px;background:transparent;border:none;color:var(--ide-fg-muted);font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;padding:2px 0;cursor:pointer;text-align:left}
.ide-git-header-switch:hover{color:var(--ide-fg)}
.ide-git-header-switch .ide-git-header-title{flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-git-header-switch .ide-git-header-caret{display:flex;align-items:center}
.ide-git-header-switch .ide-git-header-caret svg{width:12px;height:12px}
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
.ide-terminal-panel{display:flex;flex-direction:column;height:220px;min-height:120px;border-top:1px solid var(--ide-border,#2b2b2b);background:#1f1f1f;position:relative;transition:height .2s ease}
.ide-terminal-panel[data-state='minimized']{height:35px !important;min-height:35px !important}
.ide-terminal-panel[data-state='maximized']{height:60vh;min-height:200px}
.ide-terminal-toolbar{display:flex;align-items:center;gap:4px;padding:0 4px 0 0;border-bottom:1px solid var(--ide-border,#2b2b2b);flex:none;background:#1e1e1e;height:35px}
.ide-terminal-tabs{display:flex;align-items:stretch;gap:0;flex:1;min-width:0;overflow-x:auto;overflow-y:hidden}
.ide-terminal-tabs::-webkit-scrollbar{height:3px}
.ide-terminal-tabs::-webkit-scrollbar-thumb{background:#424242;border-radius:2px}
.ide-terminal-tab{display:flex;align-items:center;gap:6px;padding:0 8px 0 12px;cursor:pointer;white-space:nowrap;color:var(--ide-fg-dim,#9d9d9d);border-right:1px solid var(--ide-border,#2b2b2b);font-size:12px;min-width:0;transition:background-color .1s}
.ide-terminal-tab[data-exited]{opacity:.55;text-decoration:line-through}
.ide-terminal-tab:hover{background:var(--ide-tree-hover,#2a2d2e)}
.ide-terminal-tab[data-active='true']{background:var(--ide-bg,#1f1f1f);color:var(--ide-fg,#cccccc)}
.ide-terminal-tab[data-active='true']::before{content:'';position:absolute}
.ide-terminal-tab-label{overflow:hidden;text-overflow:ellipsis}
.ide-terminal-tab-close{background:transparent;border:none;color:var(--ide-fg-dim,#9d9d9d);cursor:pointer;padding:2px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex:none}
.ide-terminal-tab-close:hover{background:var(--ide-tree-hover,#3a3d41);color:var(--ide-fg,#cccccc)}
.ide-terminal-tab-close svg{width:14px;height:14px}
.ide-terminal-actions{display:flex;align-items:center;gap:1px;flex:none;padding-left:4px}
.ide-terminal-action{background:transparent;border:none;color:var(--ide-fg-dim,#9d9d9d);cursor:pointer;padding:4px 6px;border-radius:4px;font-size:12px;display:flex;align-items:center;justify-content:center}
.ide-terminal-action:hover{background:var(--ide-tree-hover,#2a2d2e);color:var(--ide-fg,#cccccc)}
.ide-terminal-action svg{width:16px;height:16px}
.ide-terminal-resizer{flex:none;height:4px;cursor:row-resize;background:transparent;position:relative;z-index:2}.ide-terminal-resizer:hover{background:var(--ide-border,#3b3b3b)}.ide-terminal-resizer::after{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:28px;height:2px;border-radius:1px;background:#424242}.ide-terminal-panel[data-resizing]{transition:none;user-select:none}.ide-terminal-panel[data-resizing] *{user-select:none}.ide-terminal-hosts{flex:1;min-height:0;position:relative;overflow:hidden}.ide-terminal-hosts[data-hidden]{display:none}
.ide-terminal-host{height:100%;padding:4px 8px 0;box-sizing:border-box;overflow:hidden}
.ide-terminal-host .xterm{height:100%}
.ide-terminal-error{padding:10px;font-size:12px;color:#f48771;overflow:auto}
.ide-terminal-error[data-testid=ide-terminal-exited]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--ide-fg-dim,#cccccc)}
.ide-terminal-error[data-testid=ide-terminal-exited] .ide-dialog-button{flex:none;height:22px;padding:0 10px;font-size:11px}
.ide-terminal-empty{padding:20px;font-size:12px;color:var(--ide-fg-dim,#9d9d9d);text-align:center}
.ide-activitybar-spacer{flex:1}
.ide-context-menu{position:fixed;z-index:10000;min-width:200px;max-width:320px;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.36);padding:4px 0;font:13px/1.4 var(--ds-font-family-sans,-apple-system,'Segoe UI',sans-serif);color:var(--ide-fg);overflow-y:auto;overflow-x:hidden}
.ide-context-menu-separator{height:1px;background:#454545;margin:4px 0}
.ide-context-menu-item{display:flex;align-items:center;gap:8px;padding:0 12px 0 28px;height:26px;cursor:default;user-select:none;white-space:nowrap;position:relative}
.ide-context-menu-item:hover:not([data-disabled='true']){background:var(--ide-accent);color:#fff}
.ide-context-menu-item[data-disabled='true']{color:var(--ide-fg-dim);cursor:default}
.ide-context-menu-item-icon{position:absolute;left:6px;display:flex;align-items:center;color:inherit}
.ide-context-menu-item-icon svg{width:14px;height:14px}
.ide-context-menu-item-label{flex:1;overflow:hidden;text-overflow:ellipsis}
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

