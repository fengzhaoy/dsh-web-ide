/**
 * Problems panel (VS Code Problems parity): bottom-panel tab listing Monaco
 * markers grouped by file, with click-to-jump. The parent owns the marker
 * snapshot; this component is presentational.
 */
import { Icons } from '../icons.js'

export interface ProblemItem {
  /** Workspace-relative path. */
  path: string
  line: number
  column: number
  severity: 'error' | 'warning' | 'info'
  message: string
}

type T = (key: string, params?: Record<string, string | number>) => string

export function ProblemsPanel({ problems, onOpen, t }: {
  problems: readonly ProblemItem[]
  /** Open the file and reveal the line (editor jump). */
  onOpen: (path: string, line: number) => void
  t: T
}) {
  if (problems.length === 0) {
    return <div className="ide-problems-empty" data-testid="ide-problems-empty">{t('problems.empty')}</div>
  }
  // Group by path, preserving first-seen order.
  const groups = new Map<string, ProblemItem[]>()
  for (const p of problems) {
    const arr = groups.get(p.path)
    if (arr) arr.push(p)
    else groups.set(p.path, [p])
  }
  return (
    <div className="ide-problems" data-testid="ide-problems">
      {Array.from(groups.entries()).map(([path, items]) => (
        <div key={path} className="ide-problems-group" data-testid="ide-problems-group">
          <div className="ide-problems-file">
            <span className="ide-problems-file-name">{path.split('/').pop()}</span>
            <span className="ide-problems-file-path">{path}</span>
            <span className="ide-problems-file-count">{items.length}</span>
          </div>
          {items.map((p, i) => (
            <div
              key={i}
              className="ide-problems-item"
              data-testid="ide-problems-item"
              onClick={() => onOpen(p.path, p.line)}
              title={p.message}
            >
              <span className={'ide-problems-icon ide-problems-' + p.severity}>
                {p.severity === 'error' ? Icons.close : p.severity === 'warning' ? Icons.discard : Icons.eye}
              </span>
              <span className="ide-problems-message">{p.message}</span>
              <span className="ide-problems-pos">[{p.line}, {p.column}]</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
