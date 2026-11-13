/**
 * Workspace-wide grep panel, backed by the ideTools.search Remote (the host
 * reuses dsh-tool-fs-search's ripgrep argv builder, runner, and --json
 * parser). Results group by file; clicking a hit opens the file at the line.
 */
import { showContextMenu } from '../ContextMenu.js'
import { useCallback, useRef, useState, useEffect, type ReactNode } from 'react'
import type { IdeSearchMatch, IdeToolsRemote, SessionId } from '../types.js'
import { Icons } from '../icons.js'
import { setiFileIcon } from '../setiFileIcon.js'

export interface SearchPanelProps {
  sessionId: SessionId
  cwd: string | undefined
  ideTools: IdeToolsRemote
  /** Open one absolute path in the editor. */
  onOpenFile: (path: string, line?: number) => void

  /** Reveal a hit's file in the Explorer, switching the sidebar view. */
  onRevealFile?: (path: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

interface SearchState {
  status: 'idle' | 'running' | 'done' | 'failed'
  matches: readonly IdeSearchMatch[]
  truncated: boolean
  totalMatches: number
  error: string | null
}

const IDLE: SearchState = { status: 'idle', matches: [], truncated: false, totalMatches: 0, error: null }

export function SearchPanel({ sessionId, cwd, ideTools, onOpenFile, onRevealFile, t }: SearchPanelProps) {
  const [pattern, setPattern] = useState('')
  const [include, setInclude] = useState('')
  /** VS Code shows TWO file-type inputs under [...]: include and exclude. */
  const [exclude, setExclude] = useState('')
  /** patternInputWidget.ts: include carries two toggles (open editors /
   *  changed files) and exclude carries one (exclude settings + ignore). */
  const [onlyOpenEditors, setOnlyOpenEditors] = useState(false)
  const [onlyChangedFiles, setOnlyChangedFiles] = useState(false)
  const [useIgnoreFiles, setUseIgnoreFiles] = useState(true)
  // VS Code's search is case-INsensitive by default (its Aa toggle starts off).
  const [caseSensitive, setCaseSensitive] = useState(false)
  /** VS Code .* toggle: interpret the pattern as a regular expression. */
  const [regex, setRegex] = useState(false)
  /** Two INDEPENDENT toggles, exactly like VS Code:
   *  - chevron (toggleReplaceButton) shows/hides the REPLACE row inside
   *    .search-widget;
   *  - ellipsis (searchview .more) shows/hides the query-details FILE TYPES
   *    row, which sits BELOW the ellipsis, so clicking it never moves itself. */
  const [replaceShown, setReplaceShown] = useState(false)
  const [detailsShown, setDetailsShown] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  /** replaceInput.ts PreserveCaseToggle (Codicon.preserveCase): the
   *  replacement inherits the match casing. */
  const [preserveCase, setPreserveCase] = useState(false)
  const [replaceNote, setReplaceNote] = useState<string | null>(null)
  const [state, setState] = useState<SearchState>(IDLE)
  /** VS Code collapses a file's matches when its row is clicked. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  /** VS Code viewAsTree (default) / viewAsList; list mode flattens the groups. */
  const [asTree, setAsTree] = useState(true)
  const searchSeq = useRef(0)
  /** Aborts the in-flight ripgrep. The seq check only hides a stale RESULT;
   *  without this the host kept grepping the whole workspace for a query the
   *  user had already replaced. */
  const searchAbortRef = useRef<AbortController | null>(null)

  const runSearch = useCallback(async () => {
    const query = pattern.trim()
    if (query.length === 0) return
    const seq = ++searchSeq.current
    searchAbortRef.current?.abort()
    const ctrl = new AbortController()
    searchAbortRef.current = ctrl
    setState({ status: 'running', matches: [], truncated: false, totalMatches: 0, error: null })
    const includeTrimmed = include.trim()
    // The remote can REJECT (transport drop, unmounted host), not only resolve
    // with !ok. Without this catch the panel stayed on 'running' forever and the
    // rejection went unhandled.
    try {
      const result = await ideTools.search(sessionId, {
        pattern: query,
        include: includeTrimmed.length > 0 ? includeTrimmed : undefined,
        exclude: exclude.trim().length > 0 ? exclude.trim() : undefined,
        caseSensitive,
        regex,
      }, ctrl.signal)
      if (seq !== searchSeq.current) return
      if (result.ok) {
        setState({ status: 'done', matches: result.value.matches, truncated: result.value.truncated, totalMatches: result.value.totalMatches, error: null })
      } else {
        setState({ status: 'failed', matches: [], truncated: false, totalMatches: 0, error: result.error.message })
      }
    } catch (err) {
      if (seq !== searchSeq.current) return
      setState({ status: 'failed', matches: [], truncated: false, totalMatches: 0, error: err instanceof Error ? err.message : String(err) })
    }
  }, [pattern, include, exclude, caseSensitive, regex, sessionId, ideTools])

  /**
   * Replace matches through the host. `onlyPath` scopes it to one file (the
   * per-file button); omitting it replaces across the whole workspace, which is
   * what the global button does. Files that changed on disk are SKIPPED and
   * listed — nothing is silently overwritten.
   */
  const runReplace = useCallback(async (onlyPath?: string) => {
    const query = pattern.trim()
    if (query.length === 0 || replacing) return
    const replace = ideTools.searchReplace
    if (replace === undefined) {
      setReplaceNote(t('search.replaceUnavailable'))
      return
    }
    setReplacing(true)
    setReplaceNote(null)
    try {
      const res = await replace.call(ideTools, sessionId, {
        pattern: query,
        replacement,
        include: include.trim().length > 0 ? include.trim() : undefined,
        exclude: exclude.trim().length > 0 ? exclude.trim() : undefined,
        path: onlyPath,
        caseSensitive,
        regex,
        preserveCase,
      })
      if (!res.ok) {
        setReplaceNote(t('search.replaceFailed', { message: res.error.message ?? res.error.code }))
        return
      }
      const { changed, replacements, skipped } = res.value
      setReplaceNote(
        skipped.length === 0
          ? t('search.replaceDone', { files: String(changed.length), count: String(replacements) })
          : t('search.replaceSkipped', { files: String(changed.length), count: String(replacements), skipped: String(skipped.length) }),
      )
      await runSearch()
    } catch (err) {
      setReplaceNote(t('search.replaceFailed', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setReplacing(false)
    }
  }, [pattern, replacement, include, exclude, caseSensitive, regex, preserveCase, sessionId, ideTools, replacing, runSearch, t])

  // Search on type, like VS Code (searchOnType + searchOnTypeDebouncePeriod).
  // Enter still fires an immediate run through runSearch().
  useEffect(() => {
    if (pattern.trim().length === 0) {
      setState(IDLE)
      return
    }
    const timer = setTimeout(() => { void runSearch() }, 250)
    return () => clearTimeout(timer)
  }, [pattern])

  // Abort the in-flight grep when the panel goes away (tab switch, session
  // change): the host would otherwise keep ripgrep running to completion.
  useEffect(() => () => { searchAbortRef.current?.abort() }, [])

  const hasResults = state.status === 'done' && state.totalMatches > 0

  // Group matches by file, preserving first-seen order.
  const groups = new Map<string, IdeSearchMatch[]>()
  for (const match of state.matches) {
    const list = groups.get(match.path)
    if (list !== undefined) list.push(match)
    else groups.set(match.path, [match])
  }

  return (
    <div className="ide-search-panel">
      <div className="ide-search-inputs" data-testid="ide-search-inputs">
      {/* VS Code searchWidget.render(): one .search-widget holds the chevron
          (absolute left column), the rounded input GROUP (input + inline
          Aa/.* toggles inside one bordered box) and the replace row. The
          ellipsis lives OUTSIDE it, in .query-details, pinned to the right
          edge just under the input (searchview.css .more). */}
      <div className="ide-search-widget" data-expanded={replaceShown || undefined} data-testid="ide-search-widget">
        <button
          className="ide-search-chevron"
          data-testid="ide-search-chevron"
          aria-expanded={replaceShown}
          title={replaceShown ? t('search.hideReplace') : t('search.showReplace')}
          onClick={() => setReplaceShown((v) => !v)}
        >{replaceShown ? Icons.chevronDown : Icons.chevronRight}</button>
        <div className="ide-search-container">
          <input
            className="ide-search-input"
            data-testid="ide-search-pattern"
            placeholder={t('search.placeholder')}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
          />
          <button
            className={'ide-search-toggle' + (caseSensitive ? ' is-on' : '')}
            title={t('search.caseSensitive')}
            onClick={() => setCaseSensitive((v) => !v)}
          >Aa</button>
          <button
            className={'ide-search-toggle' + (regex ? ' is-on' : '')}
            data-testid="ide-search-regex"
            title={t('search.regex')}
            onClick={() => setRegex((v) => !v)}
          >.*</button>
        </div>
        {/* Replace row (renderReplaceInput): hidden until the chevron expands. */}
        {replaceShown && (
          <div className="ide-search-replace-container">
            <input
              className="ide-search-input"
              data-testid="ide-search-replacement"
              placeholder={t('search.replacePlaceholder')}
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
            />
            <button
              className="ide-search-toggle"
              data-testid="ide-search-replace-all"
              title={t('search.replaceAll')}
              disabled={replacing || state.status !== 'done'}
              onClick={() => { void runReplace() }}
            >{replacing ? '...' : t('search.replaceAllButton')}</button>
            {/* replaceInput.ts PreserveCaseToggle: sits in the replace input
                controls, right of the replace-all button. */}
            <button
              className={'ide-search-toggle' + (preserveCase ? ' is-on' : '')}
              data-testid="ide-search-preserve-case"
              title={t('search.preserveCase')}
              onClick={() => setPreserveCase((v) => !v)}
            >{Icons.preserveCase}</button>
          </div>
        )}
      </div>
      {/* query-details: the ellipsis sits OUTSIDE the widget, pinned right
          just under the input group; it toggles the include row. */}
      <div className="ide-query-details" data-expanded={detailsShown || undefined}>
        <button
          className="ide-search-more"
          data-testid="ide-search-details"
          aria-expanded={detailsShown}
          title={detailsShown ? t('search.hideDetails') : t('search.showDetails')}
          onClick={() => setDetailsShown((v) => !v)}
        >{Icons.more}</button>
        {/* VS Code keeps .file-types in the DOM and switches it with CSS
            (searchview.css .file-types{display:none} / .more .file-types{display:inherit}). */}
        {/* VS Code has NO search button: queries run on type (searchOnType,
            debounced). Enter still forces an immediate run. */}
        <div className="ide-search-file-types" data-hidden={detailsShown ? undefined : true}>
          {/* searchView.ts: .file-types.includes + h4 "files to include" */}
          <div className="ide-file-types-group">
            <h4>{t('search.filesToInclude')}</h4>
            <div className="ide-file-input-wrap">
              <input
                className="ide-search-input"
                data-testid="ide-search-include"
                placeholder={t('search.includePlaceholder')}
                value={include}
                onChange={(e) => setInclude(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
              />
              <button
                className={'ide-search-toggle' + (onlyChangedFiles ? ' is-on' : '')}
                data-testid="ide-search-only-changed"
                title={t('search.onlyChangedFiles')}
                onClick={() => { setOnlyChangedFiles((v) => !v); if (!onlyChangedFiles) setOnlyOpenEditors(false) }}
              >{Icons.editCode}</button>
              <button
                className={'ide-search-toggle' + (onlyOpenEditors ? ' is-on' : '')}
                data-testid="ide-search-only-open"
                title={t('search.onlyOpenEditors')}
                onClick={() => { setOnlyOpenEditors((v) => !v); if (!onlyOpenEditors) setOnlyChangedFiles(false) }}
              >{Icons.book}</button>
            </div>
          </div>
          {/* searchView.ts: .file-types.excludes + h4 "files to exclude" */}
          <div className="ide-file-types-group">
            <h4>{t('search.filesToExclude')}</h4>
            <div className="ide-file-input-wrap">
              <input
                className="ide-search-input"
                data-testid="ide-search-exclude"
                placeholder={t('search.excludePlaceholder')}
                value={exclude}
                onChange={(e) => setExclude(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
              />
              <button
                className={'ide-search-toggle' + (useIgnoreFiles ? ' is-on' : '')}
                data-testid="ide-search-use-ignore"
                title={t('search.useIgnoreFiles')}
                onClick={() => setUseIgnoreFiles((v) => !v)}
              >{Icons.excludeIcon}</button>
            </div>
          </div>
        </div>
      </div>

        {replaceNote !== null && (
          <div className="ide-search-note" data-testid="ide-search-replace-note">{replaceNote}</div>
        )}
      </div>
      {/* searchActionsTopBar.ts: the navigation group on the view title bar.
          Each action's precondition from the source decides when it shows. */}
      <div className="ide-search-topbar" data-testid="ide-search-topbar">
        <button
          className="ide-search-topaction"
          data-testid="ide-search-refresh"
          title={t('search.refresh')}
          disabled={pattern.trim().length === 0 || state.status === 'running'}
          onClick={() => { void runSearch() }}
        >{Icons.refresh}</button>
        <button
          className="ide-search-topaction"
          data-testid="ide-search-clear-results"
          title={t('search.clearResults')}
          disabled={state.status === 'idle' && pattern.trim().length === 0}
          onClick={() => {
            setPattern('')
            setReplacement('')
            setInclude('')
            setExclude('')
            setState(IDLE)
            setCollapsed(new Set())
          }}
        >{Icons.clearAll}</button>
        {hasResults && (asTree
          ? <button
              className="ide-search-topaction"
              data-testid="ide-search-collapse-all"
              title={t('search.collapseAll')}
              onClick={() => setCollapsed(new Set(groups.keys()))}
            >{Icons.collapseAll}</button>
          : <button
              className="ide-search-topaction"
              data-testid="ide-search-expand-all"
              title={t('search.expandAll')}
              onClick={() => setCollapsed(new Set())}
            >{Icons.expandAll}</button>)}
        {hasResults && (
          <button
            className="ide-search-topaction"
            data-testid="ide-search-view-toggle"
            title={asTree ? t('search.viewAsList') : t('search.viewAsTree')}
            onClick={() => setAsTree((v) => !v)}
          >{asTree ? Icons.listFlat : Icons.listTree}</button>
        )}
      </div>
      <div className="ide-search-results" data-testid="ide-search-results">
        {/* VS Code: .messages carries the completion line (search.resultsInfoForeground). */}
        {/* VS Code shows nothing below the inputs until a query runs. */}
        {state.status === 'running' && <div className="ide-search-messages">{t('search.running')}</div>}
        {state.status === 'failed' && <div className="ide-search-messages ide-search-failed">{t('search.failed', { message: state.error ?? '' })}</div>}
        {state.status === 'done' && state.totalMatches === 0 && <div className="ide-search-messages">{t('search.noResults')}</div>}
        {state.status === 'done' && state.totalMatches > 0 && (
          <>
            <div className="ide-search-messages" data-testid="ide-search-summary">
              {t('search.summary', { count: state.totalMatches })}
              {state.truncated ? t('search.truncated', { kept: state.matches.length }) : ''}
            </div>
            {[...groups.entries()].map(([path, hits]) => (
              <div key={path} className="ide-search-filecontainer" data-collapsed={(asTree && collapsed.has(path)) || undefined}>
                {}
                <div
                  className="ide-search-foldermatch"
                  title={path}
                  data-testid={'ide-search-file-' + path}
                  onClick={(e) => {
                    // VS Code: clicking a file row collapses/expands its matches.
                    if ((e.target as HTMLElement).closest('.ide-search-file-replace') !== null) return
                    setCollapsed((prev) => {
                      const next = new Set(prev)
                      if (next.has(path)) next.delete(path)
                      else next.add(path)
                      return next
                    })
                  }}
                  onContextMenu={(e) => {
                    if (onRevealFile === undefined) return
                    e.preventDefault()
                    showContextMenu(e.clientX, e.clientY, [
                      { id: 'open', label: t('search.openHit'), icon: Icons.goToFile, onClick: () => onOpenFile(absolutize(path, cwd), hits[0]?.lineNumber ?? 1) },
                      { id: 'side', label: t('search.openToSide'), icon: Icons.splitEditor, onClick: () => onOpenFile(absolutize(path, cwd), hits[0]?.lineNumber ?? 1) },
                      { id: 'reveal', label: t('search.revealInExplorer'), icon: Icons.explorer, onClick: () => onRevealFile(path) },
                      { id: 'copy', label: t('search.copyPath'), icon: Icons.copy, onClick: () => { void navigator.clipboard?.writeText(absolutize(path, cwd)) } },
                    ])
                  }}
                >
                  {asTree && (
                    <span className="ide-search-twistie">
                      {collapsed.has(path) ? Icons.chevronRight : Icons.chevronDown}
                    </span>
                  )}
                  <span className="ide-search-file-icon">{setiFileIcon(path.split('/').pop() ?? '', false)}</span>
                  <span className="ide-search-file-label">{path.split('/').pop()}</span>
                  <span className="ide-search-file-dir">{dirLabel(path, cwd)}</span>
                  <span className="ide-search-badge">{hits.length}</span>
                  <button
                    className="ide-search-file-replace"
                    data-testid={'ide-search-replace-file-' + path}
                    title={t('search.replaceInFile')}
                    disabled={replacing}
                    onClick={(e) => { e.stopPropagation(); void runReplace(path) }}
                  >{t('search.replaceShort')}</button>
                </div>
                {(!asTree || !collapsed.has(path)) && hits.map((hit) => (
                  <button
                    key={hit.lineNumber + ':' + hit.line.slice(0, 32)}
                    className="ide-search-linematch"
                    onClick={() => onOpenFile(absolutize(hit.path, cwd), hit.lineNumber)}
                    onContextMenu={(e) => {
                      if (onRevealFile === undefined) return
                      e.preventDefault()
                      showContextMenu(e.clientX, e.clientY, [
                        { id: 'open', label: t('search.openHit'), icon: Icons.goToFile, onClick: () => onOpenFile(absolutize(hit.path, cwd), hit.lineNumber) },
                        { id: 'reveal', label: t('context.revealInExplorer'), icon: Icons.explorer, onClick: () => onRevealFile(hit.path) },
                        { id: 'copy', label: t('search.copyPath'), icon: Icons.copy, onClick: () => { void navigator.clipboard?.writeText(absolutize(hit.path, cwd)) } },
                      ])
                    }}
                  >
                    <span className="ide-search-matchlinenum">{hit.lineNumber}</span>
                    <span className="ide-search-match">{renderMatchLine(hit.line.trim(), pattern, regex, caseSensitive)}</span>
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** Highlight the query inside a result line, like VS Code's .match span.
 *  Falls back to plain text when the pattern is not a safe literal match. */
function renderMatchLine(line: string, pattern: string, regex: boolean, caseSensitive: boolean): ReactNode {
  const query = pattern.trim()
  if (query.length === 0) return line
  let re: RegExp
  try {
    re = new RegExp(regex ? query : escapeRegExpText(query), caseSensitive ? 'g' : 'gi')
  } catch {
    return line
  }
  const parts: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let guard = 0
  while ((m = re.exec(line)) !== null && guard++ < 100) {
    if (m[0].length === 0) { re.lastIndex += 1; continue }
    if (m.index > last) parts.push(line.slice(last, m.index))
    parts.push(<span key={m.index} className="ide-search-matchhl">{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (parts.length === 0) return line
  if (last < line.length) parts.push(line.slice(last))
  return parts
}

function escapeRegExpText(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Display the directory part of a workspace-relative hit path. */
function dirLabel(path: string, cwd: string | undefined): string {
  const idx = path.lastIndexOf('/')
  const dir = idx > 0 ? path.slice(0, idx) : ''
  if (cwd !== undefined && dir.length > 0) {
    const root = normalize(cwd) + '/'
    if (path.startsWith(root)) return path.slice(root.length, idx)
  }
  return dir
}

/** rg prints paths relative to the workdir (the workspace root); make the
 * hit absolute before handing it to openFile. */
function absolutize(path: string, cwd: string | undefined): string {
  if (path.startsWith('/')) return path
  if (cwd === undefined) return path
  return normalize(cwd) + '/' + path
}
