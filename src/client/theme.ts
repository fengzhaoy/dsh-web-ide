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
.ide-sidebar-body{flex:1;min-height:0;overflow:auto;padding:4px 0}
.ide-sidebar-body::-webkit-scrollbar{width:10px;height:10px}
.ide-sidebar-body::-webkit-scrollbar-thumb{background:#424242;border-radius:5px}
.ide-sidebar-body::-webkit-scrollbar-track{background:transparent}
.ide-editor-area{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--ide-bg);position:relative}
.ide-editor-overlay{position:absolute;inset:35px 0 22px 0;pointer-events:none;display:flex}
.ide-editor-overlay:empty{display:none}
.ide-tabbar{height:35px;flex:none;display:flex;background:var(--ide-tab-bg);border-bottom:1px solid var(--ide-tab-border);overflow-x:auto;overflow-y:hidden}
.ide-tabbar::-webkit-scrollbar{height:0}
.ide-tab{display:flex;align-items:center;gap:8px;height:35px;padding:0 12px;background:var(--ide-tab-inactive-bg);color:var(--ide-tab-inactive-fg);cursor:pointer;white-space:nowrap;border-right:1px solid var(--ide-tab-border);font-size:13px}
.ide-tab[data-active='true']{background:var(--ide-tab-active-bg);color:var(--ide-tab-active-fg)}
.ide-tab:hover:not([data-active='true']){background:#2a2d2e;color:var(--ide-fg)}
.ide-tab-name{max-width:200px;overflow:hidden;text-overflow:ellipsis}
.ide-tab-close{width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:4px;opacity:0}
.ide-tab:hover .ide-tab-close,.ide-tab[data-active='true'] .ide-tab-close{opacity:.6}
.ide-tab-close:hover{opacity:1!important;background:rgba(255,255,255,.12)}
.ide-tab-close svg{width:14px;height:14px}
.ide-editor-container{flex:1;min-height:0;position:relative}
.ide-monaco-host{position:absolute;inset:0}
.ide-editor-image{position:absolute;inset:35px 0 22px 0;overflow:auto;padding:16px;display:flex;align-items:center;justify-content:center;background:var(--ide-bg)}
.ide-editor-image img{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
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
.ide-tree-git-badge{flex:none;margin-left:4px;font-size:11px;font-weight:600;font-family:var(--ds-font-family-sans,-apple-system,'Segoe UI',sans-serif);opacity:.85}
.ide-tree-loading{padding:0 24px;color:var(--ide-fg-dim);font-size:12px;font-style:italic}
.ide-tree-error{padding:8px 16px;color:#f48771;font-size:12px}
.ide-tree-truncated{padding:4px 24px;color:var(--ide-fg-dim);font-size:11px;font-style:italic}
.ide-tab-dirty{color:#cca700;font-size:9px;line-height:1}
.ide-statusbar-dirty{color:#cca700;background:none;border:none;font:inherit;padding:0;cursor:pointer}
.ide-statusbar-conflict{color:#f14c4c}
.ide-dialog-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:40;pointer-events:auto}
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
.ide-git-input{padding:4px 12px 8px;display:flex;flex-direction:column;gap:6px}
.ide-git-input-field{width:100%;box-sizing:border-box;background:#313131;border:1px solid #3c3c3c;border-radius:4px;color:var(--ide-fg);font:13px/1.4 var(--ds-font-family-sans,-apple-system,'Segoe UI',sans-serif);padding:6px 8px;resize:vertical;min-height:40px;outline:none}
.ide-git-input-field:focus{border-color:var(--ide-accent)}
.ide-git-input-field::placeholder{color:var(--ide-fg-dim)}
.ide-git-input-field:disabled{opacity:.6}
.ide-git-input-button{display:flex;align-items:center;justify-content:center;gap:6px;background:var(--ide-accent);color:#fff;border:none;border-radius:4px;padding:4px 12px;font-size:12px;font-weight:500;cursor:pointer;align-self:flex-end}
.ide-git-input-button:hover:not(:disabled){background:var(--ide-accent-hover)}
.ide-git-input-button:disabled{opacity:.5;cursor:not-allowed}
.ide-git-input-button svg{width:14px;height:14px}
.ide-git-input-error{padding:4px 12px;color:#f48771;font-size:11px;word-break:break-word}
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
/* ── Diff editor view ─────────────────────────────────────────────────── */
/* The diff covers the tab bar + editor (the container stays mounted under it),
   leaving the status bar visible. */
.ide-diff-root{position:absolute;inset:0 0 22px 0;z-index:2;display:flex;flex-direction:column;background:var(--ide-bg)}
.ide-diff-header{height:28px;flex:none;display:flex;align-items:center;gap:10px;padding:0 12px;background:var(--ide-tab-bg);border-bottom:1px solid var(--ide-tab-border);font-size:12px}
.ide-diff-title{color:var(--ide-fg);font-weight:500}
.ide-diff-path{flex:1;min-width:0;color:var(--ide-fg-dim);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-diff-stats{flex:none;color:var(--ide-fg-dim);font-size:11px;white-space:nowrap;opacity:.8}
.ide-diff-close{flex:none;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--ide-fg-dim);cursor:pointer;border-radius:4px;padding:0}
.ide-diff-close:hover{background:rgba(255,255,255,.12);color:var(--ide-fg)}
.ide-diff-close svg{width:14px;height:14px}
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
.ide-terminal-hosts{flex:1;min-height:0;position:relative;overflow:hidden}
.ide-terminal-host{height:100%;padding:4px 8px 0;box-sizing:border-box;overflow:hidden}
.ide-terminal-host .xterm{height:100%}
.ide-terminal-error{padding:10px;font-size:12px;color:#f48771;overflow:auto}
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

