/**
 * Workspace-wide grep panel, backed by the ideTools.search Remote (the host
 * reuses dsh-tool-fs-search's ripgrep argv builder, runner, and --json
 * parser). Results group by file; clicking a hit opens the file at the line.
 */
import { useCallback, useRef, useState } from 'react'
import type { IdeSearchMatch, IdeToolsRemote, SessionId } from '../types.js'

export interface SearchPanelProps {
  sessionId: SessionId
  cwd: string | undefined
  ideTools: IdeToolsRemote
  /** Open one absolute path in the editor. */
  onOpenFile: (path: string, line?: number) => void
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

export function SearchPanel({ sessionId, cwd, ideTools, onOpenFile, t }: SearchPanelProps) {
  const [pattern, setPattern] = useState('')
  const [include, setInclude] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(true)
  const [state, setState] = useState<SearchState>(IDLE)
  const searchSeq = useRef(0)

  const runSearch = useCallback(async () => {
    const query = pattern.trim()
    if (query.length === 0) return
    const seq = ++searchSeq.current
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
      })
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
  }, [pattern, include, caseSensitive, sessionId, ideTools])

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
                <div className="ide-search-file-name" title={path}>
                  {path.split('/').pop()}
                  <span className="ide-search-file-dir">{dirLabel(path, cwd)}</span>
                </div>
                {hits.map((hit) => (
                  <button
                    key={hit.lineNumber + ':' + hit.line.slice(0, 32)}
                    className="ide-search-hit"
                    onClick={() => onOpenFile(absolutize(hit.path, cwd), hit.lineNumber)}
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
