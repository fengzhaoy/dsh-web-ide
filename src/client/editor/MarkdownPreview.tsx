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
import { DiagramManager } from './mermaidDiagram.js'
import { mermaidToolbarIcons } from './mermaidIcons.js'

/** Embedded mermaid IIFE source (virtual:dsh-ide-mermaid-iife, see
 * tsdown.config.ts embedMermaidIife): the official prebuilt browser bundle of
 * mermaid, inlined as a string so it never touches the bundler's CJS interop
 * and needs no extra served file. */
import { MERMAID_IIFE } from 'virtual:dsh-ide-mermaid-iife'

/** Shape of the window.mermaid API the preview uses. */
interface MermaidLike {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, text: string) => Promise<{ svg: string }>
}

/**
 * Fenced-code language aliases → Monaco language ids (VS Code preview
 * resolves the same aliases through markdown-it's info string). Anything not
 * in the map is left unhighlighted rather than guessed.
 */
const LANG_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  sh: 'shell', bash: 'shell', zsh: 'shell', shellscript: 'shell', console: 'shell',
  py: 'python', python3: 'python', rb: 'ruby', golang: 'go', rs: 'rust',
  yml: 'yaml', md: 'markdown', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp',
  kt: 'kotlin', objc: 'objective-c', 'objective-c': 'objective-c',
  ps: 'powershell', pwsh: 'powershell', postgres: 'pgsql', mysql: 'mysql',
  docker: 'dockerfile', tex: 'latex', text: '', txt: '', plaintext: '', plain: '',
  '': '',
}

/** Resolve a fenced info string to a Monaco language id ('' = none). */
function monacoLangOf(info: string): string {
  const first = info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (first === '') return ''
  if (LANG_ALIASES[first] !== undefined) return LANG_ALIASES[first]
  return first
}

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
  /** Report the scroll ratio [0,1] of the preview body (preview → editor sync). */
  onScrollRatio?: (ratio: number) => void
  /** Render mermaid diagrams with the dark theme variant. */
  dark?: boolean
  /** Open a resolved workspace file target in the editor area. */
  onOpenPath?: (absolutePath: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

export function MarkdownPreview({ sessionId, workspaceFiles, basePath, content, nonce = 0, scrollRef, onScrollRatio, dark = false, onOpenPath, t }: MarkdownPreviewProps) {
  const html = useMemo(() => renderMarkdown(content), [content])
  const baseDir = useMemo(() => {
    const idx = basePath.replace(/\\/g, '/').lastIndexOf('/')
    return idx > 0 ? basePath.slice(0, idx) : basePath
  }, [basePath])

  const bodyRef = useRef<HTMLDivElement | null>(null)
  /** Resolved image targets: relative source → data URI ('' = failed/hidden). */
  const resolvedRef = useRef<Map<string, string>>(new Map())
  const [, setResolveTick] = useState(0)
  /** Interactive mermaid chrome (toolbar / pan-zoom / resize); one manager
   *  per preview instance keeps pan/zoom state alive across re-renders. */
  const diagramsRef = useRef<DiagramManager>(null as unknown as DiagramManager)
  if (diagramsRef.current === null) {
    diagramsRef.current = new DiagramManager()
  }

  // A manual refresh re-reads images even when the markup did not change.
  useEffect(() => {
    resolvedRef.current.clear()
  }, [nonce])

  // Preview → editor scroll sync: report the scroll ratio. The listener is
  // bound to this component's own live DOM node, so it survives every remount
  // of the preview pane (IdeView only receives the ratio).
  useEffect(() => {
    const el = bodyRef.current
    if (el === null || onScrollRatio === undefined) return
    const report = () => {
      const range = el.scrollHeight - el.clientHeight
      onScrollRatio(range > 0 ? el.scrollTop / range : 0)
    }
    el.addEventListener('scroll', report, { passive: true })
    return () => { el.removeEventListener('scroll', report) }
  }, [onScrollRatio, html])

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

  // VS Code preview parity: syntax-highlight fenced code blocks with the
  // active Monaco theme (the same tokenizer the editor uses, so colors match
  // exactly). Runs after the HTML settles; each block is colorized once per
  // html change, unknown languages stay plain.
  useEffect(() => {
    const host = bodyRef.current
    if (host === null) return
    let cancelled = false
    const blocks = Array.from(host.querySelectorAll('pre[data-lang] > code'))
    if (blocks.length === 0) return
    void (async () => {
      const monaco = await import('monaco-editor')
      if (cancelled || host.isConnected === false) return
      const langs = new Set(monaco.languages.getLanguages().map((l) => l.id))
      for (const code of blocks) {
        if (cancelled) return
        const pre = code.parentElement
        if (pre === null) continue
        const lang = monacoLangOf(pre.getAttribute('data-lang') ?? '')
        if (lang === '' || !langs.has(lang)) continue
        const text = code.textContent ?? ''
        if (text === '') continue
        try {
          const colored = await monaco.editor.colorize(text, lang, { tabSize: 2 })
          if (cancelled || code.isConnected === false) return
          code.innerHTML = colored
        } catch { /* unknown language — keep the plain escaped text */ }
      }
    })()
    return () => { cancelled = true }
  }, [html])

  // VS Code preview parity (mermaid extension behavior): fenced
  // ```mermaid blocks render as diagrams instead of highlighted code.
  // mermaid ships inside the bundle (self-hosting constraint) and is only
  // imported when a diagram is present, so documents without diagrams pay
  // nothing. A parse failure falls back to the plain source block.
  // After rendering, each diagram gets the interactive chrome of the VS Code
  // mermaid-markdown-features extension: pan/zoom (wheel, drag, keyboard),
  // a hover toolbar at the top-right corner (zoom out / zoom in / reset /
  // copy source / download SVG), a height resize handle, and pan/zoom state
  // preserved per diagram content across live re-renders.
  useEffect(() => {
    const host = bodyRef.current
    if (host === null) return
    const fences = Array.from(host.querySelectorAll<HTMLPreElement>('pre[data-lang="mermaid"], pre[data-lang="mmd"]'))
    if (fences.length === 0) return
    let cancelled = false
    // Keep the raw source: colorize above may have already rewritten code
    // innerHTML with token spans, so read textContent before rendering.
    const sources = fences.map((pre) => (pre.querySelector('code')?.textContent ?? '').trim())
    void (async () => {
      // The diagram engine ships as an embedded IIFE (self-hosting: no CDN,
      // no extra served files) that exposes window.mermaid once evaluated.
      // Loading is lazy: the string evaluates only when a diagram exists.
      let mermaid = (globalThis as { mermaid?: MermaidLike }).mermaid
      try {
        if (mermaid === undefined) {
          // The IIFE expects top-level var semantics (a script tag): its
          // namespace var must be the same globalThis property its tail
          // reads. new Function runs in a function scope, so alias the
          // global namespace object before evaluating the vendored source.
          const boot = 'var __esbuild_esm_mermaid_nm = (globalThis.__esbuild_esm_mermaid_nm = globalThis.__esbuild_esm_mermaid_nm || {});' + MERMAID_IIFE
          // eslint-disable-next-line no-new-func -- vendored first-party IIFE
          new Function(boot)()
          mermaid = (globalThis as { mermaid?: MermaidLike }).mermaid
        }
        if (mermaid === undefined) throw new Error('mermaid IIFE did not attach')
      } catch {
        if (!cancelled) fences.forEach((pre) => { pre.classList.add('ide-md-mermaid-error') })
        return
      }
      if (cancelled) return
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
      // Stable per-content diagram ids (extension renderMermaidElement):
      // pan/zoom state survives live re-renders keyed by content hash, and
      // duplicate diagrams in one document get distinct suffixes.
      const usedIds = new Set<string>()
      const activeIds = new Set<string>()
      const labels = {
        zoomIn: t('md.mermaid.zoomIn'),
        zoomOut: t('md.mermaid.zoomOut'),
        reset: t('md.mermaid.reset'),
        copySource: t('md.mermaid.copySource'),
        downloadSvg: t('md.mermaid.downloadSvg'),
        panHint: t('md.mermaid.panHint'),
      }
      const icons = mermaidToolbarIcons()
      for (let i = 0; i < fences.length; i++) {
        if (cancelled) return
        const pre = fences[i]
        const src = sources[i]
        if (src === '') continue
        let hash = 0
        for (let c = 0; c < src.length; c++) hash = ((hash << 5) - hash + src.charCodeAt(c)) | 0
        let contentId = 'ide-md-mermaid-' + (hash >>> 0).toString(16)
        for (let n = 0; usedIds.has(contentId); n++) contentId = 'ide-md-mermaid-' + (hash >>> 0).toString(16) + '-' + n
        usedIds.add(contentId)
        const id = contentId + '-' + Math.random().toString(36).slice(2, 8)
        try {
          const { svg } = await mermaid.render(id, src)
          if (cancelled || pre.isConnected === false) return
          const box = document.createElement('div')
          box.className = 'ide-md-mermaid'
          box.innerHTML = svg
          pre.replaceWith(box)
          activeIds.add(contentId)
          diagramsRef.current.setup(contentId, box, { icons, labels, source: src })
        } catch {
          if (cancelled || pre.isConnected === false) return
          pre.classList.add('ide-md-mermaid-error')
        }
      }
      if (!cancelled) diagramsRef.current.retainStates(activeIds)
    })()
    return () => { cancelled = true }
  }, [html, dark, t])

  // Tear all diagram chrome down when the preview unmounts.
  useEffect(() => () => { diagramsRef.current.disposeAll() }, [])

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
