/**
 * Explorer's Timeline section, mirroring VS Code's Timeline view
 * (src/vs/workbench/contrib/timeline/browser/timelinePane.ts) fed by the git
 * provider (extensions/git/src/timelineProvider.ts): one row per commit
 * touching the active file, git-commit glyph, "subject" label and an
 * "author • relative time" description, newest first, click opens the
 * commit's diff for the file.
 */
import { useEffect, useMemo, useState } from 'react'
import type { GitTimelineEntry } from '../types.js'

/** VS Code's fromNow() granularity (vs/base/common/date): recent times get
 *  "x seconds/minutes/hours/days ago", older ones fall back to dates. */
export function fromNow(unixSeconds: number): string {
  const seconds = Math.round(Date.now() / 1000 - unixSeconds)
  if (seconds < 30) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago')
  const days = Math.round(hours / 24)
  if (days < 31) return days + (days === 1 ? ' day ago' : ' days ago')
  const months = Math.round(days / 30)
  if (months < 12) return months + (months === 1 ? ' month ago' : ' months ago')
  const years = Math.round(months / 12)
  return years + (years === 1 ? ' year ago' : ' years ago')
}

export function TimelinePanel({ entries, loading, hasFile, isRepo, onOpenCommit, t }: {
  entries: readonly GitTimelineEntry[]
  loading: boolean
  hasFile: boolean
  isRepo: boolean
  onOpenCommit: (sha: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
}): React.ReactElement {
  const rows = useMemo(() => entries, [entries])
  if (!hasFile) {
    return <div className="ide-panel-empty" data-testid="ide-timeline-empty">{t('timeline.noFile')}</div>
  }
  if (loading) {
    return <div className="ide-panel-empty" data-testid="ide-timeline-loading">{t('timeline.loading')}</div>
  }
  if (!isRepo) {
    return <div className="ide-panel-empty" data-testid="ide-timeline-empty">{t('timeline.notARepo')}</div>
  }
  if (rows.length === 0) {
    return <div className="ide-panel-empty" data-testid="ide-timeline-empty">{t('timeline.noCommits')}</div>
  }
  return (
    <div className="ide-timeline-list" role="list" data-testid="ide-timeline-list">
      {rows.map((entry) => (
        <div
          key={entry.hash}
          className="ide-tree-row"
          role="listitem"
          title={entry.subject}
          onClick={() => onOpenCommit(entry.hash)}
        >
          <span className="ide-tree-icon ide-timeline-glyph" aria-hidden>
            {/* codicon git-commit: the same glyph VS Code's git provider sets */}
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.2">
              <circle cx="8" cy="8" r="2.6" />
              <path d="M1.5 8h3.4M11.1 8h3.4" />
            </svg>
          </span>
          <span className="ide-tree-name">{entry.subject}</span>
          <span className="ide-timeline-desc">{entry.author} • {fromNow(entry.authorDate)}</span>
        </div>
      ))}
    </div>
  )
}
