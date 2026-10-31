/**
 * Self-contained Markdown → HTML renderer for the IDE's .md preview pane.
 *
 * No external dependencies (the client bundle must stay self-hosting), so
 * this implements the GitHub-flavoured CommonMark subset that README-style
 * documents use: ATX + setext headings, paragraphs (hard-break aware),
 * fenced + indented code, blockquotes, ordered / unordered lists (nested,
 * with task-list checkboxes), GFM tables, horizontal rules, GitHub alerts,
 * and the inline set (bold, italic, strike, inline code, links, reference
 * links, images, autolinks, escapes). YAML front matter renders as a code
 * block, matching the VS Code markdown preview.
 *
 * Raw HTML in the document IS rendered, as DSH's native conversation
 * markdown does — README banners (a centred <p> wrapping an <img>), centred
 * <div align="center"> blocks and <details> collapsibles are ordinary README
 * furniture and must look like they do natively. The security model is
 * therefore sanitisation, not escaping:
 *
 *   - blocks that begin with a raw HTML tag are emitted as markup, and
 *     markdown inside an open raw-HTML wrapper (<div align="center"> …
 *     </div>) is still parsed;
 *   - inline HTML passes through, minus comments;
 *   - every tag stream (raw and generated) goes through sanitizeHtml(), which
 *     drops scripts, embedded frames/objects, inline event handlers and
 *     javascript: / vbscript: / data:text URLs (data:image stays allowed);
 *   - markdown-generated attributes are escaped by this file.
 *
 * Images: every relative target is emitted as data-md-src (the exact source
 * text, quotes and spaces included) so the preview component can resolve it
 * against the workspace; title-derived attributes are never appended to the
 * src value.
 */

/** True when the path looks like a Markdown document. */
export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown|mdown|mkd)$/i.test(path)
}

/** Escape a string for safe interpolation as HTML text or attribute value. */
export function escapeHtml(s: string): string {
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

/**
 * Join a possibly-relative link/image target against the document's dir.
 * Rooted bases keep their root: an absolute baseDir must yield an absolute
 * result (the workspace-files Remote treats a slash-less path as relative to
 * the workspace root, which silently misresolves every absolute join).
 */
export function joinRelativePath(baseDir: string, target: string): string {
  const clean = target.replace(/\\/g, '/').split('#')[0]
  if (clean === '') return ''
  if (clean.startsWith('/') || /^[a-z]:\//i.test(clean)) return clean
  const norm = baseDir.replace(/\\/g, '/')
  const drive = /^[a-z]:\//i.exec(norm)?.[0] ?? ''
  const root = norm.startsWith('/') ? '/' : drive
  const base = norm.replace(/\/+$/, '')
  const body = drive !== '' && root === drive ? base.slice(drive.length) : base
  const parts = (body + '/' + clean).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return root + out.join('/')
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

// ── sanitizer ───────────────────────────────────────────────────────────
// Allowlist > denylist: README markup legitimately uses <p align>, <div
// align>, <details>/<summary>, <picture>/<source>, <sub>/<sup>, <br>, styled
// spans. Everything that can execute drops, as do event handlers and
// non-image data:/script URLs. Applied to raw HTML and to the markdown this
// file generates (its own attributes are already escaped, so re-running them
// is a no-op).

const DROP_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'link', 'meta', 'base', 'form', 'textarea', 'select', 'option',
  'button', 'template', 'svg', 'math', 'noscript', 'noembed', 'noframes',
  'param', 'video', 'audio', 'source', 'track', 'canvas', 'portal', 'dialog',
])

/** Attributes removed everywhere (event handlers, srcdoc, ping, …). */
function isDroppedAttr(name: string, value: string): boolean {
  const lower = name.toLowerCase()
  if (lower.startsWith('on')) return true
  if (lower === 'srcdoc' || lower === 'ping' || lower === 'formaction') return true
  if (lower === 'href' || lower === 'src' || lower === 'action' || lower === 'xlink:href') {
    // Decode entities before the scheme test: &#106;avascript: is still JS.
    const v = value.replace(/&#(\d+);?/g, (_m, d: string) => String.fromCharCode(Number(d)))
      .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&colon;/gi, ':')
      .replace(/[\s\u0000-\u001f]/g, '')
      .toLowerCase()
    if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return true
    if (v.startsWith('data:') && !v.startsWith('data:image/')) return true
  }
  return false
}

/** Sanitize an HTML fragment (raw document markup). Safe by allowlist of
 *  attributes per behaviour, never by trusting the author. */
export function sanitizeHtml(html: string): string {
  if (html === '') return ''
  let out = ''
  let i = 0
  const len = html.length
  while (i < len) {
    const lt = html.indexOf('<', i)
    if (lt < 0) { out += html.slice(i); break }
    out += html.slice(i, lt)
    // Comment, CDATA, doctype, processing instruction.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end < 0 ? len : end + 3
      continue
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9)
      i = end < 0 ? len : end + 3
      continue
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt)
      i = end < 0 ? len : end + 1
      continue
    }
    const tagEnd = findTagEnd(html, lt)
    if (tagEnd < 0) { out += html.slice(lt); break }
    const inner = html.slice(lt + 1, tagEnd)
    const closing = inner.startsWith('/')
    const nameMatch = /^\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(inner)
    if (nameMatch === null) { out += html.slice(lt, tagEnd + 1); i = tagEnd + 1; continue }
    const name = nameMatch[1].toLowerCase()
    if (DROP_TAGS.has(name)) {
      i = tagEnd + 1
      // Consume the element body up to its closing tag so text inside a
      // <script> or <style> can never leak into the document.
      const closeRe = new RegExp('</\\s*' + name + '\\s*>', 'i')
      const m = closeRe.exec(html.slice(i))
      if (m !== null) i += m.index + m[0].length
      continue
    }
    out += closing ? '</' + name + '>' : '<' + name + rewriteAttrs(inner.slice(nameMatch[0].length), name) + '>'
    i = tagEnd + 1
  }
  return out
}

/** Index of the '>' that closes the tag starting at `lt`, or -1. Quotes are
 *  honoured so a title containing '>' does not end the tag early. */
function findTagEnd(html: string, lt: number): number {
  let quote = ''
  for (let i = lt + 1; i < html.length; i++) {
    const c = html[i]
    if (quote !== '') { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '>') return i
  }
  return -1
}

/** Rewrite a raw tag's attributes: drop the dangerous ones and route image
 *  sources through the same workspace resolution as markdown images. Without
 *  that hand-off a README banner written as <img src="assets/banner.png">
 *  would keep a browser-relative URL and 404 against the app origin. */
function rewriteAttrs(rest: string, tagName = ''): string {
  const selfClose = /\/\s*$/.test(rest)
  const body = selfClose ? rest.replace(/\/\s*$/, '') : rest
  let out = ''
  // Unquoted values may contain parentheses and slashes (onerror=alert(1));
  // they end at whitespace or the closing bracket. A '/' only ends a tag
  // when it is the self-closing slash, already stripped above.
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const attr = m[1]
    if (attr === '') { re.lastIndex += 1; continue }
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    if (isDroppedAttr(attr, value)) continue
    // A raw image with a relative source becomes a data-md-src marker, the
    // exact inverse of what the markdown image path emits.
    if (attr.toLowerCase() === 'src' && tagName === 'img' && value !== '' && !isExternal(value) && !isUnsafeDest(value)) {
      out += ' data-md-src="' + value + '"'
      continue
    }
    out += m[2] !== undefined || m[3] !== undefined
      ? ' ' + attr + '="' + value + '"'
      : (m[4] !== undefined ? ' ' + attr + '="' + m[4] + '"' : ' ' + attr)
    if (re.lastIndex === m.index) re.lastIndex += 1
  }
  return out + (selfClose ? ' /' : '')
}

// ── inline pipeline ─────────────────────────────────────────────────────

const STX = '\uE000'
const ETX = '\uE001'
// Separators are horizontal whitespace only: a newline carries real layout
// (hard breaks become <br> later), so a hole must never absorb it.
// Whitespace is spelled as an alternation, never as a character class
// ending in a space: a class whose last member is a literal space merges
// with the following private-use marker into a range, and the hole stops
// matching. Separators are horizontal only — a newline is real layout
// (it becomes <br> later), so a hole must never swallow one.
// A hole is STX + index + index + ETX, and nothing else. Two lessons are
// baked into that shape:
//   - no whitespace may sit inside a hole: an emphasis pass can wrap one as
//     '<em>hole _x_</em>', and a trailing separator would eat the newline
//     that becomes the paragraph's hard break;
//   - no variable-length pattern (digit class, whitespace class) may precede
//     the index. Next to a private-use character V8 folds such a class into
//     a character range, and the match silently fails — the placeholder then
//     stays in the output. Fixed-width groups cannot be folded.
const HOLE_RE = new RegExp(STX + '(\\d{2})(\\d{2})' + ETX, 'g')

/** Link destinations: <angle-bracketed> or a run without spaces/pointy
 *  brackets. Image sources additionally accept quoted paths with spaces,
 *  which is what IDE workspaces produce whenever a file name contains one. */
const LINK_DEST = '<[^<>\\n]*>|[^\\s()<>](?:[^()<>\\n]*[^\\s()<>])?'
const IMG_DEST = '<[^<>\\n]*>|[^\\s()<>](?:[^()<>\\n]*[^\\s()<>])?|\'[^\'\\n]*\'|"[^"\\n]*"'
const IMG_RE = new RegExp('!\\[([^\\]\\n]*)\\]\\(\\s*(' + IMG_DEST + ')(?:\\s+(?:"[^"\\n]*"|\'[^\'\\n]*\'|\\([^()\\n]*\\)))?\\s*\\)', 'y')
const LINK_RE = new RegExp('\\[([^\\]\\n]+)\\]\\(\\s*(' + LINK_DEST + ')(?:\\s+(?:"[^"\\n]*"|\'[^\'\\n]*\'|\\([^()\\n]*\\)))?\\s*\\)', 'y')
/** Autolinks (<https://…>) are lifted out of the SOURCE, before escaping. */
const AUTOLINK_RE = /<((?:https?|ftp|mailto):[^\s<>]+)>/g
const BARE_URL_RE = /(^|[\s(（，。、；：>])((?:https?:\/\/|www\.)[^\s<>()（）\[\]{}]*[^\s<>()（）\[\]{}.,;:!?'"、。，；：！？】」』）])/

function isExternal(href: string): boolean {
  return /^(?:https?:|ftp:|mailto:|tel:|data:image\/)/i.test(href)
}

/** Strip optional <angle> brackets and surrounding quotes from a target. */
/** Undo the entity pass applied to source text, so destinations (and the
 *  quotes/titles around them) are read as the author wrote them. */
function unescapeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function cleanDest(dest: string): string {
  let d = unescapeEntities(dest.trim())
  if (d.startsWith('<') && d.endsWith('>')) d = d.slice(1, -1)
  else if ((d.startsWith('"') && d.endsWith('"')) || (d.startsWith("'") && d.endsWith("'"))) d = d.slice(1, -1)
  return d
}

/** Render an image tag. Relative targets carry the exact source text so the
 *  preview can resolve them against the workspace. */
/** A destination whose scheme can execute is not a destination at all. */
function isUnsafeDest(dest: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(dest.replace(/[\s\u0000-\u001f]/g, ''))
  if (scheme === null) return false
  const s = scheme[1].toLowerCase()
  if (s === 'javascript' || s === 'vbscript' || s === 'file') return true
  return s === 'data' && !/^data:image\//i.test(dest)
}

function imageTag(alt: string, dest: string): string {
  // The source is already entity-escaped by the caller; unescape once so a
  // URL with &query=params does not come back as &amp;amp;.
  const src = cleanDest(dest)
  if (isUnsafeDest(src)) return escapeHtml(alt)
  if (isExternal(src)) return '<img alt="' + alt + '" src="' + escapeHtml(src) + '" loading="lazy">'
  return '<img alt="' + alt + '" data-md-src="' + escapeHtml(src) + '" loading="lazy">'
}

/** Render a link. External targets keep their URL; in-page anchors scroll;
 *  workspace-relative targets open in the editor through onOpenPath. */
function linkTag(label: string, dest: string): string {
  const href = cleanDest(dest)
  if (isUnsafeDest(href)) return label
  if (isExternal(href)) return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
  if (href.startsWith('#')) return '<a class="ide-md-anchor" href="' + escapeHtml(href) + '">' + label + '</a>'
  return '<a class="ide-md-link" href="#" data-md-href="' + escapeHtml(href) + '">' + label + '</a>'
}

/** Split a destination plus optional title into the destination. Images
 *  additionally accept a quoted destination and an unquoted path holding
 *  spaces (only when the whole remainder is a file name — a title stays a
 *  title), so ![x](my shot.png) and ![x](my shot.png "title") both resolve. */
function splitDest(inner: string, allowSpaces = false): string | null {
  // Callers pass RAW source text; unescape entities first so quotes inside a
  // title and a URL's & separator are read the way the author wrote them.
  const trimmed = unescapeEntities(inner.trim())
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>')
    return close < 0 ? null : trimmed.slice(0, close + 1)
  }
  // Image destinations may hold spaces. A trailing quoted title is stripped
  // first; what remains is the destination (already quoted or bare).
  if (allowSpaces) {
    // Strip ONE trailing quoted title, then take everything before it as the
    // destination.
    const noTitle = /^(.+)\s+(?:"[^"]*"|'[^']*')\s*$/.exec(trimmed)
    const candidate = (noTitle !== null ? noTitle[1] : trimmed).trim()
    if (candidate === '') return null
    // A fully quoted destination is just the path inside the quotes.
    const quoted = /^"([\s\S]*)"$|^'([\s\S]*)'$/.exec(candidate)
    if (quoted !== null) return quoted[1] ?? quoted[2]
    return candidate
  }
  const m = /^(\S+?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/.exec(trimmed)
  return m === null ? null : m[1]
}

/**
 * Inline formatting over ESCAPED text.
 *
 * Constructs whose content must survive untouched (code spans, images,
 * links, raw HTML, bare URLs) are lifted into holes numbered with two-digit
 * zero-padded ids and NO delimiters: text written after them (emphasis
 * markers close to a hole) cannot swallow the next digit. A STX+index+ETX
 * scheme lost every [![badge](…)](…) to exactly that bug.
 */
/** Inline-format a nested label (a link whose text is an image, emphasis
 *  inside link text). Each call owns its hole table, so the outer table's
 *  indices are never touched while a label is being formatted. */
/** Scan inline links and images left to right. The callback receives the
 *  kind (image / link), label text, inline destination (or null) and the
 *  reference label for reference forms; returning null leaves the source
 *  text untouched (an undefined reference renders literally, as in CommonMark).
 *  Balanced parentheses in the destination are supported without the
 *  backtracking a nested-quantifier regex needs. */
function scanLinks(
  text: string,
  emit: (isImage: boolean, label: string, dest: string | null, ref: string) => string | null,
): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const start = text.indexOf('[', i)
    if (start < 0) { out += text.slice(i); break }
    const isImage = start > 0 && text[start - 1] === '!'
    const labelEnd = findLabelEnd(text, start + 1)
    if (labelEnd < 0) { out += text.slice(i, isImage ? start - 1 : start + 1); i = isImage ? start + 1 : start + 1; continue }
    const label = text.slice(start + 1, labelEnd)
    let consumed = -1
    let dest: string | null = null
    let ref = ''
    if (text[labelEnd + 1] === '(') {
      const close = findParenClose(text, labelEnd + 2, isImage)
      if (close > 0) {
        // Keep the raw inner text (destination AND title): splitDest needs
        // both to tell ![a](path "title") apart from ![a](my shot.png).
        dest = text.slice(labelEnd + 2, close)
        consumed = close + 1
      }
    } else if (text[labelEnd + 1] === '[') {
      const refEnd = text.indexOf(']', labelEnd + 2)
      if (refEnd > 0 && !text.slice(labelEnd + 2, refEnd).includes('\n')) {
        ref = text.slice(labelEnd + 2, refEnd)
        consumed = refEnd + 1
      }
    }
    if (consumed < 0) {
      // No destination: emit the '[' and keep scanning (a bare '[' is text).
      out += text.slice(i, start + 1)
      i = start + 1
      continue
    }
    const replacement = emit(isImage, label, dest, ref)
    if (replacement === null) {
      out += text.slice(i, consumed)
      i = consumed
      continue
    }
    // The leading '!' belongs to the image and must be dropped.
    out += text.slice(i, isImage ? start - 1 : start) + replacement
    i = consumed
  }
  return out
}

/** Index of the ']' closing a label that starts at `from`, honouring
 *  nesting (a link label may contain an image's [ ... ]). */
function findLabelEnd(text: string, from: number): number {
  let depth = 1
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '\n') return -1
    if (c === '\\') { i += 1; continue }
    if (c === '[') depth += 1
    else if (c === ']') { depth -= 1; if (depth === 0) return i }
  }
  return -1
}

/** Index of the ')' closing a destination that starts at `from`. With
 *  `quoted` (images), a leading quote makes the destination opaque until the
 *  matching quote, and any ')' inside it is content — that is what lets
 *  ![shot](assets/my shot (1).png) resolve instead of truncating at the space. */
function findParenClose(text: string, from: number, quoted: boolean): number {
  let depth = 1
  let quote = ''
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (quote !== '') { if (c === quote) quote = ''; continue }
    if (quoted && (c === '"' || c === "'") && depth === 1 && /^\s*$/.test(text.slice(from, i))) { quote = c; continue }
    if (c === '\n') return -1
    if (c === '(') depth += 1
    else if (c === ')') { depth -= 1; if (depth === 0) return i }
  }
  return -1
}

function formatLabel(label: string, refs?: Map<string, { url: string }>): string {
  return renderInline(label, refs)
}

function renderInline(source: string, refs?: Map<string, { url: string }>): string {
  const holes: string[] = []
  const put = (html: string): string => {
    holes.push(html)
    const index = String(holes.length - 1).padStart(2, '0')
    return STX + index + index + ETX
  }
  let text = source

  // 0. Code spans come first and capture the RAW text between the ticks, so
  //    a tag written inside code stays literal and is escaped exactly once.
  text = text.replace(/(`+)([^`]+?)\1(?!`)/g, (_m, _ticks, inner: string) => {
    return put('<code>' + escapeHtml(inner.replace(/\n/g, ' ').trim()) + '</code>')
  })

  // 1. Links and images, scanned on the RAW source: a link whose label is
  //    an image ([![badge](…)](url)) finds the image first and wraps that
  //    hole, and a destination keeps its original quotes for splitDest.
  //    Code spans above are already holes, so backticked brackets are inert.
  text = scanLinks(text, (isImage, label, dest, ref) => {
    if (dest !== null) {
      const target = splitDest(dest, isImage)
      if (target === null) return null
      return put(isImage ? imageTag(escapeHtml(label), target) : linkTag(formatLabel(label, refs), target))
    }
    const key = (ref === '' ? label : ref).trim().toUpperCase()
    const def = refs?.get(key)
    if (def === undefined) return null
    return put(isImage ? imageTag(escapeHtml(label), def.url) : linkTag(formatLabel(label, refs), def.url))
  })

  // 2. Autolinks and inline HTML are lifted out of the source: escapeHtml
  //    would otherwise turn <kbd>, <sub> and <https://…> into visible text.
  text = text.replace(AUTOLINK_RE, (_m, url: string) => {
    return put('<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a>')
  })
  //    Code or script bodies never reach the DOM as text: <script>…</script>
  //    is removed whole, and a tag left alone in a code span is escaped.
  text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, () => put(''))
  text = text.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g, (tag: string) => put(sanitizeHtml(tag)))

  // 3. Backslash escapes.
  text = text.replace(/\\([\\`*_{}\[\]()#+\-.!|~>])/g, (_m, ch: string) => put(escapeHtml(ch)))

  // 4. Everything still literal is document text: escape it once, here. The
  //    holes hold finished HTML, so they must not be escaped again — hence
  //    the split around the markers.
  text = text.split(STX).map((chunk: string, idx: number) => idx === 0 ? escapeHtml(chunk) : chunk.slice(0, 5) + escapeHtml(chunk.slice(5))).join(STX)

  // 5. Bare URLs (GFM autolink extension).
  text = text.replace(BARE_URL_RE, (_m, lead: string, url: string) => {
    const href = url.startsWith('www.') ? 'https://' + url : url
    return lead + put('<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + url + '</a>')
  })

  // 6. Emphasis.
  text = text.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/(^|[^\w_])__([^_]+)__(?!\w)/g, '$1<strong>$2</strong>')
  text = text.replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>')
  text = text.replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>')
  text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')

  // Restore placeholders. A hole can hold another hole (a link label that
  // is an image, inline markup passed through sanitizeHtml), so sweep until
  // the text is hole-free — each sweep resolves the next nesting level.
  let restored = text
  for (let pass = 0; pass < 4 && restored.includes(STX); pass++) {
    restored = restored.replace(HOLE_RE, (_m, i: string) => holes[Number(i)] ?? '')
  }
  return restored
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

const BLOCK_TAGS = 'p|div|center|details|summary|section|article|header|footer|nav|aside|figure|figcaption|picture|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|blockquote|h[1-6]|dl|dt|dd|main|span'
/** Opening raw-HTML wrapper whose block may contain markdown. */
const OPEN_WRAPPER_RE = new RegExp('^ {0,3}<(' + BLOCK_TAGS + ')(\\s[^>]*)?>\\s*$', 'i')
const CLOSE_WRAPPER_RE = new RegExp('^ {0,3}</(?:' + BLOCK_TAGS + ')>\\s*$', 'i')
/** A line that starts a raw HTML block (CommonMark type 6/7). */
const RAW_BLOCK_RE = new RegExp('^ {0,3}<(?:' + BLOCK_TAGS + ')(?:\\s|/?>)', 'i')
const RAW_CLOSE_RE = new RegExp('^ {0,3}</(?:' + BLOCK_TAGS + ')\\s*>$', 'i')
const HTML_COMMENT_RE = /^ {0,3}<!--/
const ALERT_RE = /^ {0,3}> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i

export interface MarkdownContext {
  /** Reference definitions (\[label\]: url) collected across the document. */
  refs?: Map<string, { url: string }>
}

function collectRefs(lines: string[]): Map<string, { url: string }> {
  const refs = new Map<string, { url: string }>()
  for (const line of lines) {
    const m = /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+["'(][^"')]*["')])?\s*$/.exec(line)
    if (m !== null && !refs.has(m[1].trim().toUpperCase())) refs.set(m[1].trim().toUpperCase(), { url: m[2] })
  }
  return refs
}

function renderList(lines: string[], start: number, setI: (n: number) => void, ctx: MarkdownContext): string {
  const baseIndent = indentOf(lines[start])
  const ordered = /^\s*\d/.test(lines[start])
  const startNo = ordered ? Number(/^(\s*)(\d{1,9})/.exec(lines[start])?.[2] ?? '1') : 1
  const items: string[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      const nxt = lines[i + 1]
      if (nxt !== undefined && !isBlank(nxt) && indentOf(nxt) >= baseIndent && (listItemOf(nxt) !== null || indentOf(nxt) > baseIndent)) {
        i += 1
        continue
      }
      break
    }
    const m = listItemOf(line)
    if (m !== null && indentOf(line) === baseIndent && /^\s*\d/.test(line) === ordered) {
      const contentWidth = m[1].length + m[2].length + Math.min(m[3].length, 4)
      const itemLines = [m[4]]
      i += 1
      // Continuation lines keep their relative indentation, so nested lists
      // and fenced code inside an item still parse as blocks.
      while (i < lines.length) {
        const l = lines[i]
        if (isBlank(l)) {
          const nxt = lines[i + 1]
          if (nxt !== undefined && indentOf(nxt) > baseIndent) { itemLines.push(''); i += 1; continue }
          break
        }
        if (indentOf(l) > baseIndent) {
          itemLines.push(l.replace(new RegExp('^\\s{' + Math.min(contentWidth, indentOf(l)) + '}'), ''))
          i += 1
          continue
        }
        // Lazy paragraph continuation.
        if (listItemOf(l) === null && !/^ {0,3}(?:#{1,6}\s|>|`{3,}|~{3,})/.test(l) && itemLines[itemLines.length - 1] !== '') {
          itemLines.push(l.trim())
          i += 1
          continue
        }
        break
      }
      const task = itemLines[0].match(/^\[([ xX])\]\s+([\s\S]*)$/)
      if (task !== null) {
        itemLines[0] = task[2]
        const box = '<input type="checkbox" disabled' + (task[1] !== ' ' ? ' checked' : '') + '>'
        const body = renderBlocks(itemLines.join('\n'), ctx)
        // Fold the checkbox into the first paragraph so the row stays inline.
        const inner = body.startsWith('<p>') ? '<p>' + box + body.slice(3) : box + body
        items.push('<li class="ide-md-task">' + inner + '</li>')
      } else {
        items.push('<li>' + renderBlocks(itemLines.join('\n'), ctx) + '</li>')
      }
      continue
    }
    break
  }
  setI(i)
  const tag = ordered ? 'ol' : 'ul'
  const startAttr = ordered && startNo !== 1 ? ' start="' + startNo + '"' : ''
  return '<' + tag + startAttr + '>' + items.join('') + '</' + tag + '>'
}

function splitTableRow(row: string): string[] {
  let s = row.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  // A '|' inside a code span is table content, not a cell separator.
  const cells: string[] = []
  let buf = ''
  let inCode = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') { buf += '|'; i += 1; continue }
    if (c === '`') { inCode = !inCode; buf += c; continue }
    if (c === '|' && !inCode) { cells.push(buf.trim()); buf = ''; continue }
    buf += c
  }
  cells.push(buf.trim())
  return cells
}

function renderBlocks(src: string, ctx: MarkdownContext = {}): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const refs = ctx.refs ?? new Map()
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (isBlank(line)) { i += 1; continue }

    // HTML comment block.
    if (HTML_COMMENT_RE.test(line)) {
      while (i < lines.length && !lines[i].includes('-->')) i += 1
      if (i < lines.length) i += 1
      continue
    }

    // Fenced code block.
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/)
    if (fence !== null) {
      const marker = fence[1]
      const lang = fence[2].trim()
      const body: string[] = []
      i += 1
      const close = new RegExp('^ {0,3}' + (marker.charAt(0) === '`' ? '`' : '~') + '{' + marker.length + ',}\\s*$')
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

    // Raw-HTML wrapper holding markdown (<div align="center"> … </div>,
    // <details>…</details>): emit the tag, parse the inside, close it.
    const open = OPEN_WRAPPER_RE.exec(line)
    // A <p> is inline content, not a markdown container: let the raw-HTML
    // block branch below hold the whole banner, <img> and all.
    if (open !== null && open[1].toLowerCase() !== 'p') {
      const tagName = open[1].toLowerCase()
      const closeSelf = new RegExp('^ {0,3}</' + tagName + '>\\s*$', 'i')
      const body: string[] = []
      i += 1
      while (i < lines.length && !closeSelf.test(lines[i])) { body.push(lines[i]); i += 1 }
      if (i < lines.length) i += 1
      const inner = body.join('\n').trim() === '' ? '' : renderBlocks(body.join('\n'), ctx)
      out.push(sanitizeHtml(open[0].trim()) + inner + '</' + tagName + '>')
      continue
    }

    // Raw HTML block, emitted as markup. This is what makes a README banner
    // (a centred <p> wrapping an <img>) render natively instead of as
    // escaped text. When the first tag is an OPENING tag whose closing tag
    // appears later, keep gathering through blank lines and markdown until
    // that closing tag — a <p> split at its inner <img> would nest wrongly.
    if (RAW_BLOCK_RE.test(line) || RAW_CLOSE_RE.test(line) || /^ {0,3}<!/.test(line)) {
      const body: string[] = []
      const first = RAW_BLOCK_RE.exec(line) ?? RAW_CLOSE_RE.exec(line)
      const tagName = first === null ? '' : (first[0].match(/<(\w+)/)?.[1] ?? '').toLowerCase()
      const closeRe = tagName === '' ? null : new RegExp('^ {0,3}</' + tagName + '>\\s*$', 'i')
      if (closeRe !== null && !closeRe.test(line) && lines.slice(i).some((l) => closeRe.test(l))) {
        while (i < lines.length && !closeRe.test(lines[i])) { body.push(lines[i]); i += 1 }
        if (i < lines.length) { body.push(lines[i]); i += 1 }
      } else {
        while (i < lines.length && !isBlank(lines[i])) { body.push(lines[i]); i += 1 }
      }
      out.push(sanitizeHtml(body.join('\n')))
      continue
    }

    // ATX heading.
    const h = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h !== null) {
      const level = String(h[1].length)
      const raw = h[2]
      out.push('<h' + level + ' id="' + escapeHtml(slugify(raw)) + '">' + renderInline(raw, refs) + '</h' + level + '>')
      i += 1
      continue
    }

    // Setext heading (paragraph text underlined with === or ---).
    if (i + 1 < lines.length && !isBlank(line) && !listItemOf(line) && /^ {0,3}=+\s*$/.test(lines[i + 1])) {
      const raw = line.trim()
      out.push('<h1 id="' + escapeHtml(slugify(raw)) + '">' + renderInline(raw, refs) + '</h1>')
      i += 2
      continue
    }

    // Horizontal rule.
    if (isHr(line)) { out.push('<hr>'); i += 1; continue }

    // Blockquote / GitHub alert.
    if (/^ {0,3}>/.test(line)) {
      const body: string[] = []
      while (i < lines.length) {
        const l = lines[i]
        if (/^ {0,3}>/.test(l)) { body.push(l.replace(/^ {0,3}> ?/, '')); i += 1; continue }
        if (!isBlank(l) && body.length > 0 && listItemOf(l) === null && !/^ {0,3}(`{3,}|~{3,})/.test(l)) { body.push(l); i += 1; continue }
        break
      }
      const alert = body.length > 0 ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(body[0]) : null
      if (alert !== null) {
        const kind = alert[1].toLowerCase()
        out.push('<div class="ide-md-alert ide-md-alert-' + kind + '"><p class="ide-md-alert-title">' + alert[1].toUpperCase() + '</p>'
          + renderBlocks(body.slice(1).join('\n'), ctx) + '</div>')
      } else {
        out.push('<blockquote>' + renderBlocks(body.join('\n'), ctx) + '</blockquote>')
      }
      continue
    }

    // Table: header row with |, then a delimiter row.
    if (line.includes('|') && i + 1 < lines.length && /^ {0,3}\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const aligns = splitTableRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '')
      const alignAttr = (idx: number): string => aligns[idx] !== undefined && aligns[idx] !== '' ? ' style="text-align:' + aligns[idx] + '"' : ''
      const thead = '<tr>' + splitTableRow(line).map((c, ci) => '<th' + alignAttr(ci) + '>' + renderInline(c, refs) + '</th>').join('') + '</tr>'
      i += 2
      const rows: string[] = []
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) {
        rows.push('<tr>' + splitTableRow(lines[i]).map((c, ci) => '<td' + alignAttr(ci) + '>' + renderInline(c, refs) + '</td>').join('') + '</tr>')
        i += 1
      }
      out.push('<table><thead>' + thead + '</thead><tbody>' + rows.join('') + '</tbody></table>')
      continue
    }

    // Lists (nested via indentation).
    if (listItemOf(line) !== null) {
      out.push(renderList(lines, i, (next) => { i = next }, ctx))
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

    // Reference definition — invisible in the output, collected up front.
    if (/^ {0,3}\[[^\]]+\]:\s*<?\S+>?(?:\s+["'(][^"')]*["')])?\s*$/.test(line)) { i += 1; continue }

    // Paragraph: gather until blank or a new block starts. Single newlines
    // are hard breaks, matching how GitHub and DSH render README prose.
    const para: string[] = []
    while (i < lines.length && !isBlank(lines[i]) && !/^ {0,3}#{1,6}\s/.test(lines[i]) && !/^ {0,3}>/.test(lines[i]) && !isHr(lines[i]) && !/^ {0,3}(`{3,}|~{3,})/.test(lines[i]) && listItemOf(lines[i]) === null && !RAW_BLOCK_RE.test(lines[i])) {
      para.push(lines[i].trim())
      i += 1
    }
    if (para.length > 0) out.push('<p>' + renderInline(para.join("\n"), refs).replace(/\n/g, '<br>') + '</p>')
    else i += 1
  }
  return out.join('\n')
}

/** Render a Markdown source string into a self-contained, sanitized HTML
 *  fragment. */
export function renderMarkdown(src: string): string {
  const refs = collectRefs(src.replace(/\r\n?/g, '\n').split('\n'))
  return sanitizeHtml(renderBlocks(src, { refs }))
}
