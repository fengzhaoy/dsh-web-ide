/**
 * Self-contained Markdown → HTML renderer for the IDE's .md preview pane.
 *
 * No external dependencies (the client bundle must stay self-hosting), so
 * this implements the CommonMark subset that README-style documents use:
 * ATX headings, paragraphs, fenced + indented code, blockquotes, ordered /
 * unordered lists (nested, with task-list checkboxes), tables, horizontal
 * rules, and the inline set (bold, italic, strike, inline code, links,
 * images, autolinks). YAML front matter renders as a code block, matching
 * the VS Code markdown preview.
 *
 * Security model: all source text is HTML-escaped FIRST and every tag is
 * produced by this file — raw HTML in the document renders as text, never
 * markup. Link/image targets are restricted to http(s), mailto, data URIs
 * and in-page anchors; workspace-relative targets are emitted with
 * data-md-href / data-md-img attributes and resolved by the preview
 * component against the workspace (open file / read image bytes).
 */

/** True when the path looks like a Markdown document. */
export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown|mdown|mkd)$/i.test(path)
}

/** Escape a string for safe interpolation as HTML text or attribute value. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** GitHub-style slug for heading anchors. */
function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-')
}

/** Join a possibly-relative link/image target against the document's dir. */
export function joinRelativePath(baseDir: string, target: string): string {
  const clean = target.replace(/\\/g, '/').split('#')[0]
  if (clean === '') return ''
  const parts = (baseDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + clean).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** Image MIME type for a browser-renderable extension, else null. */
export function imageMimeOf(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  switch (path.slice(dot + 1).toLowerCase()) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'ico': return 'image/x-icon'
    case 'avif': return 'image/avif'
    case 'svg': return 'image/svg+xml'
    default: return null
  }
}

// ── inline pipeline ─────────────────────────────────────────────────────
// Inline formatting runs on ALREADY-ESCAPED text. Constructs whose content
// must not be transformed further (code spans, images, links) are lifted
// into placeholder holes first and restored verbatim at the end.

const STX = '\uE000'
const ETX = '\uE001'

function renderInline(escaped: string): string {
  const holes: string[] = []
  const put = (html: string): string => { holes.push(html); return STX + String(holes.length - 1) + ETX }
  let text = escaped

  // 1. Code spans — literal content.
  text = text.replace(/(`+)([^`]+?)\1(?!`)/g, (_m, _ticks, inner: string) => {
    return put('<code>' + inner.replace(/\n/g, ' ').trim() + '</code>')
  })

  // 2. Images — relative targets are resolved later against the workspace.
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[\s\S]*?&quot;)?\)/g, (_m, alt: string, src: string) => {
    const external = src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')
    const resolved = external ? src : 'ide-resolve:' + src
    return put('<img alt="' + alt + '" src="' + resolved + '" loading="lazy" data-md-img="' + src + '">')
  })

  // 3. Links — [text](target); workspace-relative targets open in the IDE.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[\s\S]*?&quot;)?\)/g, (_m, label: string, href: string) => {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
      return put('<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>')
    }
    if (href.startsWith('#')) return put('<a class="ide-md-anchor" href="' + href + '">' + label + '</a>')
    return put('<a class="ide-md-link" href="#" data-md-href="' + href + '">' + label + '</a>')
  })

  // 4. Bare autolinks.
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/g, (_m, lead: string, url: string) => {
    return lead + put('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>')
  })

  // 5. Emphasis.
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  text = text.replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>')
  text = text.replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>')
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  // Restore placeholders.
  return text.replace(new RegExp(STX + '(\\d+)' + ETX, 'g'), (_m, i: string) => holes[Number(i)] ?? '')
}

// ── block pipeline ──────────────────────────────────────────────────────

function isBlank(s: string): boolean {
  return s.trim() === ''
}

function isHr(s: string): boolean {
  return /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(s)
}

function indentOf(s: string): number {
  const m = s.match(/^\s*/)
  return m === null ? 0 : m[0].replace(/\t/g, '    ').length
}

function listItemOf(s: string): RegExpMatchArray | null {
  return s.match(/^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/)
}

/** Render one (possibly nested) list starting at lines[start]; setI receives
 *  the first line index after the list. */
function renderList(lines: string[], start: number, setI: (n: number) => void): string {
  const baseIndent = indentOf(lines[start])
  const ordered = /^\s*\d/.test(lines[start])
  const items: string[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      // A blank line keeps the list open only while list content follows.
      const nxt = lines[i + 1]
      if (nxt !== undefined && !isBlank(nxt) && indentOf(nxt) >= baseIndent && (listItemOf(nxt) !== null || indentOf(nxt) > baseIndent)) {
        i += 1
        continue
      }
      break
    }
    const m = listItemOf(line)
    if (m !== null && indentOf(line) === baseIndent && /^\s*\d/.test(line) === ordered) {
      let content = m[4]
      i += 1
      // Lazy continuation lines belong to this item.
      while (i < lines.length && !isBlank(lines[i]) && indentOf(lines[i]) > baseIndent && listItemOf(lines[i]) === null) {
        content += '\n' + lines[i].trim()
        i += 1
      }
      // A deeper-indented list item starts a nested list.
      let nested = ''
      if (i < lines.length && !isBlank(lines[i]) && listItemOf(lines[i]) !== null && indentOf(lines[i]) > baseIndent) {
        nested = renderList(lines, i, (next) => { i = next })
      }
      const task = content.match(/^\[([ xX])\]\s+([\s\S]*)$/)
      if (task !== null) {
        const checked = task[1] !== ' '
        items.push('<li class="ide-md-task"><input type="checkbox" disabled' + (checked ? ' checked' : '') + '><span>' + renderInline(escapeHtml(task[2])) + '</span>' + nested + '</li>')
      } else {
        items.push('<li>' + renderInline(escapeHtml(content)) + nested + '</li>')
      }
      continue
    }
    break
  }
  setI(i)
  const tag = ordered ? 'ol' : 'ul'
  return '<' + tag + '>' + items.join('') + '</' + tag + '>'
}

function splitTableRow(row: string): string[] {
  let s = row.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

function renderBlocks(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (isBlank(line)) { i += 1; continue }

    // Fenced code block.
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/)
    if (fence !== null) {
      const marker = fence[1]
      const lang = fence[2].trim()
      const body: string[] = []
      i += 1
      const close = new RegExp('^ {0,3}' + (marker.charAt(0) === '`' ? '`' : '~') + '{' + marker.length + ',}\s*$')
      while (i < lines.length && !close.test(lines[i])) { body.push(lines[i]); i += 1 }
      if (i < lines.length) i += 1
      out.push('<pre data-lang="' + escapeHtml(lang) + '"><code>' + escapeHtml(body.join('\n')) + '</code></pre>')
      continue
    }

    // YAML front matter (leading --- … ---).
    if (i === 0 && /^ {0,3}---\s*$/.test(line)) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^ {0,3}(?:---|\.\.\.)\s*$/.test(lines[i])) { body.push(lines[i]); i += 1 }
      if (i < lines.length) i += 1
      out.push('<pre data-lang="yaml"><code>' + escapeHtml(body.join('\n')) + '</code></pre>')
      continue
    }

    // ATX heading.
    const h = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h !== null) {
      const level = String(h[1].length)
      const raw = h[2]
      out.push('<h' + level + ' id="' + slugify(raw) + '">' + renderInline(escapeHtml(raw)) + '</h' + level + '>')
      i += 1
      continue
    }

    // Horizontal rule.
    if (isHr(line)) { out.push('<hr>'); i += 1; continue }

    // Blockquote: gather > lines (plus lazy continuations), recurse.
    if (/^ {0,3}>/.test(line)) {
      const body: string[] = []
      while (i < lines.length) {
        const l = lines[i]
        if (/^ {0,3}>/.test(l)) { body.push(l.replace(/^ {0,3}> ?/, '')); i += 1; continue }
        if (!isBlank(l) && body.length > 0 && listItemOf(l) === null && !/^ {0,3}(`{3,}|~{3,})/.test(l)) { body.push(l); i += 1; continue }
        break
      }
      out.push('<blockquote>' + renderBlocks(body.join('\n')) + '</blockquote>')
      continue
    }

    // Table: header row with |, then a delimiter row.
    if (line.includes('|') && i + 1 < lines.length && /^ {0,3}\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const aligns = splitTableRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '')
      const alignAttr = (idx: number): string => aligns[idx] !== undefined && aligns[idx] !== '' ? ' style="text-align:' + aligns[idx] + '"' : ''
      const thead = '<tr>' + splitTableRow(line).map((c, ci) => '<th' + alignAttr(ci) + '>' + renderInline(escapeHtml(c)) + '</th>').join('') + '</tr>'
      i += 2
      const rows: string[] = []
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) {
        rows.push('<tr>' + splitTableRow(lines[i]).map((c, ci) => '<td' + alignAttr(ci) + '>' + renderInline(escapeHtml(c)) + '</td>').join('') + '</tr>')
        i += 1
      }
      out.push('<table><thead>' + thead + '</thead><tbody>' + rows.join('') + '</tbody></table>')
      continue
    }

    // Lists (nested via indentation).
    if (listItemOf(line) !== null) {
      out.push(renderList(lines, i, (next) => { i = next }))
      continue
    }

    // Indented code block (4+ spaces at block start).
    if (indentOf(line) >= 4) {
      const body: string[] = []
      while (i < lines.length && (isBlank(lines[i]) || indentOf(lines[i]) >= 4)) {
        body.push(isBlank(lines[i]) ? '' : lines[i].replace(/^(?: {4}|\t)/, ''))
        i += 1
      }
      while (body.length > 0 && isBlank(body[body.length - 1])) body.pop()
      out.push('<pre><code>' + escapeHtml(body.join('\n')) + '</code></pre>')
      continue
    }

    // Paragraph: gather until blank or a new block starts.
    const para: string[] = []
    while (i < lines.length && !isBlank(lines[i]) && !/^ {0,3}#{1,6}\s/.test(lines[i]) && !/^ {0,3}>/.test(lines[i]) && !isHr(lines[i]) && !/^ {0,3}(`{3,}|~{3,})/.test(lines[i]) && listItemOf(lines[i]) === null) {
      para.push(lines[i].trim())
      i += 1
    }
    if (para.length > 0) out.push('<p>' + renderInline(escapeHtml(para.join('\n'))) + '</p>')
    else i += 1
  }
  return out.join('\n')
}

/** Render a Markdown source string into a self-contained HTML fragment. */
export function renderMarkdown(src: string): string {
  return renderBlocks(src)
}
