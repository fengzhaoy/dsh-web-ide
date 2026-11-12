/**
 * Workspace-wide grep panel, backed by the ideTools.search Remote (the host
 * reuses dsh-tool-fs-search's ripgrep argv builder, runner, and --json
 * parser). Results group by file; clicking a hit opens the file at the line.
 */
import { showContextMenu } from '../ContextMenu.js'
import { useCallback, useRef, useState, useEffect } from 'react'
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
  // VS Code's search is case-INsensitive by default (its Aa toggle starts off).
  const [caseSensitive, setCaseSensitive] = useState(false)
  /** VS Code .* toggle: interpret the pattern as a regular expression. */
  const [regex, setRegex] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [replaceNote, setReplaceNote] = useState<string | null>(null)
  const [state, setState] = useState<SearchState>(IDLE)
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
  }, [pattern, include, caseSensitive, regex, sessionId, ideTools])

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
        path: onlyPath,
        caseSensitive,
        regex,
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
  }, [pattern, replacement, include, caseSensitive, regex, sessionId, ideTools, replacing, runSearch, t])

  // Abort the in-flight grep when the panel goes away (tab switch, session
  // change): the host would otherwise keep ripgrep running to completion.
  useEffect(() => () => { searchAbortRef.current?.abort() }, [])

  // Group matches by file, preserving first-seen order.
  const groups = new Map<string, IdeSearchMatch[]>()
  for (const match of state.matches) {
    const list = groups.get(match.path)
    if (list !== undefined) list.push(match)
    else groups.set(match.path, [match])
  }

  return (
    <div className="ide-search-panel">
      <div className="ide-search-inputs">
        <div className="ide-search-row">
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
        <div className="ide-search-row">
          <input
            className="ide-search-input ide-search-include"
            data-testid="ide-search-include"
            placeholder={t('search.includePlaceholder')}
            value={include}
            onChange={(e) => setInclude(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
          />
          <button className="ide-search-run" data-testid="ide-search-run" title={t('search.run')} onClick={() => { void runSearch() }} disabled={state.status === 'running' || pattern.trim().length === 0}>
            {state.status === 'running' ? '...' : t('search.runButton')}
          </button>
        </div>
        {/* VS Code's replace row: type the replacement, then act globally. */}
        <div className="ide-search-row">
          <input
            className="ide-search-input ide-search-replace"
            data-testid="ide-search-replacement"
            placeholder={t('search.replacePlaceholder')}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
          />
          <button
            className="ide-search-run"
            data-testid="ide-search-replace-all"
            title={t('search.replaceAll')}
            disabled={replacing || state.status !== 'done'}
            onClick={() => { void runReplace() }}
          >{replacing ? '...' : t('search.replaceAllButton')}</button>
        </div>
        {replaceNote !== null && (
          <div className="ide-search-note" data-testid="ide-search-replace-note">{replaceNote}</div>
        )}
      </div>
      <div className="ide-search-results" data-testid="ide-search-results">
        {state.status === 'idle' && <div className="ide-search-hint">{t('search.hint')}</div>}
        {state.status === 'running' && <div className="ide-search-hint">{t('search.running')}</div>}
        {state.status === 'failed' && <div className="ide-search-error">{t('search.failed', { message: state.error ?? '' })}</div>}
        {state.status === 'done' && state.totalMatches === 0 && <div className="ide-search-hint">{t('search.noResults')}</div>}
        {state.status === 'done' && state.totalMatches > 0 && (
          <>
            <div className="ide-search-summary">
              {t('search.summary', { count: state.totalMatches })}
              {state.truncated ? t('search.truncated', { kept: state.matches.length }) : ''}
            </div>
            {[...groups.entries()].map(([path, hits]) => (
              <div key={path} className="ide-search-file">
                <div
                  className="ide-search-file-name"
                  title={path}
                  onContextMenu={(e) => {
                    if (onRevealFile === undefined) return
                    e.preventDefault()
                    showContextMenu(e.clientX, e.clientY, [
                      { id: 'reveal', label: t('context.revealInExplorer'), icon: Icons.explorer, onClick: () => onRevealFile(absolutize(path, cwd)) },
                    ])
                  }}
                >
                  <span className="ide-tree-icon">{setiFileIcon(path.split('/').pop() ?? '', false)}</span>
                  <span className="ide-search-file-label">{path.split('/').pop()}</span>
                  <span className="ide-search-file-dir">{dirLabel(path, cwd)}</span>
                  <button
                    className="ide-search-file-replace"
                    data-testid={'ide-search-replace-file-' + path}
                    title={t('search.replaceInFile')}
                    disabled={replacing}
                    onClick={(e) => { e.stopPropagation(); void runReplace(path) }}
                  >{t('search.replaceShort')}</button>
                </div>
                {hits.map((hit) => (
                  <button
                    key={hit.lineNumber + ':' + hit.line.slice(0, 32)}
                    className="ide-search-hit"
                    onClick={() => onOpenFile(absolutize(hit.path, cwd), hit.lineNumber)}
                    onContextMenu={(e) => {
                      if (onRevealFile === undefined) return
                      e.preventDefault()
                      showContextMenu(e.clientX, e.clientY, [
                        { id: 'open', label: t('search.openHit'), icon: Icons.goToFile, onClick: () => onOpenFile(absolutize(hit.path, cwd), hit.lineNumber) },
                        { id: 'reveal', label: t('context.revealInExplorer'), icon: Icons.explorer, onClick: () => onRevealFile(absolutize(hit.path, cwd)) },
                      ])
                    }}
                  >
                    <span className="ide-search-hit-line">{hit.lineNumber}</span>
                    <span className="ide-search-hit-text">{hit.line.trim().slice(0, 200)}</span>
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
