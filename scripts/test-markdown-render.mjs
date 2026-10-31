// Renderer regression suite for the IDE .md preview.
// Run: node --experimental-strip-types scripts/test-markdown-render.mjs
//
// Guards the two defects that made READMEs look nothing like DSH's native
// preview: raw HTML blocks were escaped into visible text (so a banner <img>
// never appeared), and the inline hole placeholders were silently eaten by
// the emphasis pass (so every badge/link inside a link rendered empty).
import { renderMarkdown } from '../src/client/editor/markdown.ts'

let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed += 1
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  → ' + detail))
}

// ── raw HTML ────────────────────────────────────────────────────────────
{
  const html = renderMarkdown('<p align="center">\n  <img src="assets/banner.png" alt="B" width="100%">\n</p>')
  check('raw <p> block survives as markup', !html.includes('&lt;img'), html)
  // The preview resolves images through data-md-src only. A raw HTML <img>
  // must be handed over the same way, or its relative URL resolves against
  // the app origin and the banner silently 404s.
  check('raw <img> src is routed to the workspace loader', html.includes('data-md-src="assets/banner.png"'), html)
  check('raw <img> keeps no browser-relative src', !/<img[^>]*\ssrc="assets\//.test(html), html)
  check('attr kept on the wrapper', html.includes('<p align="center">'), html)
}
{
  const html = renderMarkdown('<img src="https://cdn.example/x.png" alt="X">')
  check('absolute raw <img> keeps its remote src', html.includes('src="https://cdn.example/x.png"'), html)
}
{
  const html = renderMarkdown('<img src="javascript:alert(1)">')
  check('raw <img> with a script URL is disarmed', !html.includes('javascript:'), html)
}
{
  const html = renderMarkdown('<div align="center">\n\n  # Title\n\n  **bold**\n\n</div>')
  check('markdown parses inside a raw <div> wrapper', html.includes('<h1') && html.includes('<strong>bold</strong>'), html)
  check('wrapper is closed once', (html.match(/<div/g) || []).length === 1 && (html.match(/<\/div>/g) || []).length === 1, html)
}
{
  const html = renderMarkdown('<details>\n\n**x**\n\n</details>')
  check('<details> keeps its markdown body', html.startsWith('<details>') && html.includes('<strong>x</strong>'), html)
}

// ── images and links ────────────────────────────────────────────────────
{
  const html = renderMarkdown('[![License](https://img.example/l.svg)](LICENSE)')
  check('badge link keeps its image', /<a [^>]*><img [^>]*src="https:\/\/img\.example\/l\.svg"/.test(html), html)
  check('badge link resolves the workspace target', html.includes('data-md-href="LICENSE"'), html)
}
{
  const html = renderMarkdown('![alt](assets/my shot.png)')
  check('image path with a space is kept whole', html.includes('data-md-src="assets/my shot.png"'), html)
  const titled = renderMarkdown('![alt](assets/a.png "the title")')
  check('image title is not folded into the src', titled.includes('data-md-src="assets/a.png"'), titled)
}
{
  const html = renderMarkdown('[![L](https://i/x.svg "License")](LICENSE)')
  check('image title in a badge is not folded into src', html.includes('src="https://i/x.svg"'), html)
}
{
  const html = renderMarkdown('[x](https://e.com?a=1&b=2)')
  check('query string is escaped exactly once', html.includes('href="https://e.com?a=1&amp;b=2"'), html)
}
{
  const html = renderMarkdown('a [missing] b')
  check('a bare bracket stays text', html.includes('a [missing] b'), html)
}

// ── inline structure ────────────────────────────────────────────────────
{
  const html = renderMarkdown('**bold** and *em* and ~~gone~~ and \`code\`')
  check('emphasis and code spans', ['<strong>bold</strong>', '<em>em</em>', '<del>gone</del>', '<code>code</code>'].every((t) => html.includes(t)), html)
}
{
  const html = renderMarkdown('use \`a < b\` here')
  check('code span content is escaped, tag stays literal', html.includes('<code>a &lt; b</code>'), html)
}
{
  const html = renderMarkdown('inline <kbd>Ctrl</kbd> key')
  check('inline HTML renders as markup', html.includes('<kbd>Ctrl</kbd>'), html)
}
{
  const html = renderMarkdown('one\ntwo')
  check('single newline is a hard break', html.includes('<br>'), html)
}
{
  const html = renderMarkdown('- [x] done\n- [ ] todo')
  check('task list checkboxes', html.includes('checked') && html.includes('ide-md-task'), html)
}

// ── sanitisation ────────────────────────────────────────────────────────
{
  const html = renderMarkdown('<script>alert(1)</scr' + 'ipt>safe')
  check('script body is dropped', !html.includes('alert(1)') && html.includes('safe'), html)
}
{
  const html = renderMarkdown('<img src=x onerror=alert(1)>')
  check('event handlers are stripped', !html.includes('onerror'), html)
}
{
  const html = renderMarkdown('[x](javascript:alert(1))')
  check('javascript: links are disarmed', !html.includes('javascript:'), html)
}
{
  const html = renderMarkdown('[![x](javascript:alert(1))](LICENSE)')
  check('javascript: image sources are disarmed', !html.includes('javascript:'), html)
}

// ── no leftovers ────────────────────────────────────────────────────────
{
  const html = renderMarkdown('# T\n\n[a](b) ![c](d.png) <p align="center">x</p>\n\n- [x] y\n\n> q')
  check('no placeholder markers leak', !/[\uE000\uE001]/.test(html), html)
}

console.log(failed === 0 ? '\nall markdown renderer checks passed' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)
