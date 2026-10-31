/**
 * Rendered Markdown preview body (VS Code "Open Preview to the Side" parity).
 *
 * Pure presentation: the caller (IdeView) owns the split layout, the live
 * content feed from the Monaco model, and the header actions. This component
 * renders the HTML fragment from renderMarkdown, resolves workspace-relative
 * image targets into data URIs through the workspace-files Remote, and turns
 * relative markdown links into editor opens via onOpenPath. The scrollable
 * element is exposed through scrollRef so IdeView can sync editor scrolling.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IdeViewInjected, RemoteResult, WorkspaceFileBytes } from '../types.js'
import { imageMimeOf, joinRelativePath, renderMarkdown } from './markdown.js'

/** Encode native bytes to a base64 string (for image data URIs). readBytes
 *  returns a Uint8Array payload in DSH 0.1.7+. */
function bytesToBase64(data: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < data.byteLength; i++) bin += String.fromCharCode(data[i])
  return btoa(bin)
}

export interface MarkdownPreviewProps {
  sessionId: string | undefined
  workspaceFiles: IdeViewInjected['workspaceFiles']
  /** Absolute path of the markdown document (link/image resolution base). */
  basePath: string
  /** Current markdown source, fed live from the editor model. */
  content: string
  /** Bump to force re-resolution of images (manual refresh). */
  nonce?: number
  /** Register the scrollable element (editor → preview scroll sync). */
  scrollRef?: (el: HTMLDivElement | null) => void
  /** Open a resolved workspace file target in the editor area. */
  onOpenPath?: (absolutePath: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

export function MarkdownPreview({ sessionId, workspaceFiles, basePath, content, nonce = 0, scrollRef, onOpenPath, t }: MarkdownPreviewProps) {
  const html = useMemo(() => renderMarkdown(content), [content])
  const baseDir = useMemo(() => {
    const idx = basePath.replace(/\\/g, '/').lastIndexOf('/')
    return idx > 0 ? basePath.slice(0, idx) : basePath
  }, [basePath])

  const bodyRef = useRef<HTMLDivElement | null>(null)
  /** Resolved image targets: relative source → data URI ('' = failed/hidden). */
  const resolvedRef = useRef<Map<string, string>>(new Map())
  const [, setResolveTick] = useState(0)

  // A manual refresh re-reads images even when the markup did not change.
  useEffect(() => {
    resolvedRef.current.clear()
  }, [nonce])

  // Resolve every relative image target against the workspace.
  useEffect(() => {
    if (!sessionId) return
    const ctrl = new AbortController()
    let cancelled = false
    const probe = document.createElement('div')
    probe.innerHTML = html
    void (async () => {
      for (const img of Array.from(probe.querySelectorAll('img[data-md-src]'))) {
        const rel = img.getAttribute('data-md-src') ?? ''
        if (rel === '' || resolvedRef.current.has(rel)) continue
        if (rel.startsWith('http://') || rel.startsWith('https://') || rel.startsWith('data:')) {
          resolvedRef.current.set(rel, rel)
          continue
        }
        const abs = joinRelativePath(baseDir, rel)
        const mime = imageMimeOf(abs)
        if (mime === null) { resolvedRef.current.set(rel, ''); continue }
        try {
          const res: RemoteResult<WorkspaceFileBytes> = await workspaceFiles.readBytes(sessionId, abs, {}, ctrl.signal)
          if (cancelled) return
          resolvedRef.current.set(rel, res.ok ? 'data:' + mime + ';base64,' + bytesToBase64(res.value.data) : '')
        } catch {
          if (!cancelled) resolvedRef.current.set(rel, '')
        }
        setResolveTick((n) => n + 1)
      }
    })()
    return () => { cancelled = true; ctrl.abort() }
  }, [html, baseDir, sessionId, workspaceFiles])

  // Apply resolved sources onto the live DOM after every render (cheap pass).
  useEffect(() => {
    const host = bodyRef.current
    if (host === null) return
    for (const img of Array.from(host.querySelectorAll('img[data-md-src]'))) {
      const rel = img.getAttribute('data-md-src') ?? ''
      const resolved = resolvedRef.current.get(rel)
      if (resolved !== undefined && resolved !== '') img.setAttribute('src', resolved)
    }
  })

  // Route clicks: workspace-relative links open in the IDE, in-page anchors
  // smooth-scroll, external links keep their default behavior.
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a')
    if (anchor === null) return
    const mdHref = anchor.getAttribute('data-md-href')
    if (mdHref !== null) {
      e.preventDefault()
      onOpenPath?.(joinRelativePath(baseDir, mdHref))
      return
    }
    if (anchor.classList.contains('ide-md-anchor')) {
      e.preventDefault()
      const rawId = (anchor.getAttribute('href') ?? '').slice(1)
      const doc = bodyRef.current
      if (doc !== null && rawId !== '') {
        // Heading ids come from slugify() on the raw text, but a Markdown
        // anchor may be percent-encoded (`## 安装` → `[go](#%E5%AE%89%E8%A3%85)`),
        // which never matched. Decode first, then fall back to the raw form.
        let decoded = rawId
        try { decoded = decodeURIComponent(rawId) } catch { /* malformed escape — keep raw */ }
        const heading = doc.querySelector('#' + CSS.escape(decoded)) ?? doc.querySelector('#' + CSS.escape(rawId))
        heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [baseDir, onOpenPath])

  if (content.trim() === '') {
    return <div className="ide-md-body ide-md-empty">{t('md.empty')}</div>
  }

  return (
    <div
      ref={(el) => { bodyRef.current = el; scrollRef?.(el) }}
      className="ide-md-body"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
