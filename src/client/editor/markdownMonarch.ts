/**
 * Custom markdown Monarch lexer emitting VS Code TextMate-style token names
 * (markup.heading / markup.quote / markup.list / markup.bold / markup.italic /
 * markup.inline.raw / markup.strikethrough / markup.fenced-code.block).
 *
 * WHY: Monaco's built-in markdown lexer emits NO token at all for headings,
 * quotes and list bullets (verified: '# x' -> empty token), so no theme rule
 * can ever give them a color. Re-registering the provider replaces it (last
 * registration wins relative to the lazy basic-language factory), and the
 * markup.* rules in theme.ts finally hit.
 *
 * Two Monarch details this file depends on:
 * 1. Token names are sanitized: underscores become '-'. Emitting
 *    'markup.fenced_code.block' would arrive in the theme as
 *    'markup.fenced-code.block', so the dashed name is used deliberately.
 * 2. nextEmbedded must name a REAL registered language id and only the rule
 *    that ENTERS a state may set it; a state entered without an embedding
 *    must not carry nextEmbedded: '@pop' (Monarch throws). That is why there
 *    are two fence states: 'fence' (embedded) and 'fencePlain' (flat).
 */
import type * as Monaco from 'monaco-editor'

/**
 * Fence language aliases -> real Monaco language ids. 'bash' is only an alias
 * of 'shell' and 'jsonc' of 'json'; handing Monarch an alias makes it emit an
 * empty token for every line inside the fence, i.e. an uncolored code block.
 */
const FENCE_LANGUAGE_IDS: Record<string, string> = {
  bash: 'shell', sh: 'shell', zsh: 'shell', shell: 'shell', console: 'shell', fish: 'shell',
  jsonc: 'json', json5: 'json', json: 'json',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', javascript: 'javascript',
  ts: 'typescript', tsx: 'typescript', typescript: 'typescript',
  py: 'python', python: 'python', rb: 'ruby', ruby: 'ruby', rs: 'rust', rust: 'rust',
  go: 'go', java: 'java', kt: 'kotlin', kotlin: 'kotlin', swift: 'swift', php: 'php',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini',
  html: 'html', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', md: 'markdown', markdown: 'markdown', dockerfile: 'dockerfile',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  text: 'plaintext', txt: 'plaintext', plaintext: 'plaintext',
}

type MonarchRule = Monaco.languages.IMonarchLanguageRule

/** Fences whose language maps to a real tokenizer, so the body is highlighted. */
const embeddedFenceRules: MonarchRule[] = Object.entries(FENCE_LANGUAGE_IDS).map(([alias, id]) => [
  new RegExp('^\\s*(`{3,}|~{3,})\\s*' + alias + '\\s*$'),
  { token: 'markup.fenced-code.block', next: '@fence', nextEmbedded: id },
] as MonarchRule)

export function registerMarkdownMonarch(monaco: typeof Monaco): void {
  if (registerMarkdownMonarch.done) return
  registerMarkdownMonarch.done = true
  monaco.languages.setMonarchTokensProvider('markdown', {
    defaultToken: '',
    tokenPostfix: '.md',
    escapes: /\\(?:[`*{}\[\]()#+\-.!_]|@escapes)/,
    tokenizer: {
      root: [
        // ATX heading. No capture groups: a leading (\\s{0,3}) group with an
        // empty match made Monarch paint the whole line with its first token.
        [/^\s{0,3}#+\s?[^\n]*/, 'markup.heading'],
        // Setext headings.
        [/^\s*=+\s*$/, 'markup.heading'],
        [/^\s*-+\s*$/, 'markup.heading'],
        // Thematic break.
        [/^\s*((?:\*[ ]?\*){3,}|(?:-[ ]?-){3,}|(?:_[ ]?_){3,})\s*$/, 'meta.separator'],
        // Blockquote marker only. VS Code scopes the '>' as
        // punctuation.definition.quote.begin.markdown (dark_vs #6A9955) and
        // leaves the quoted TEXT in the body color - coloring the whole line
        // is visibly different from VS Code. No capture groups: group actions
        // with a leading empty match paint the whole match with token[0].
        [/^\s*>{1,3}\s?/, 'punctuation.definition.quote.begin'],
        // List marker only: punctuation.definition.list.begin.markdown
        // (dark_vs #6796e6, light_vs #0451a5).
        [/^\s{0,3}(?:[-+*]|\d+[.)])(?=\s)/, 'punctuation.definition.list.begin'],
        // Indented code block.
        [/^(?:\t| {4})[^ ].*$/, 'markup.raw.content'],
        // Fenced code with a known language: run that language inside.
        ...embeddedFenceRules,
        // Fenced code with an unknown language (or none): flat raw block.
        [/^\s*(`{3,}|~{3,})\s*\S*\s*$/, { token: 'markup.fenced-code.block', next: '@fencePlain' }],
        // Table row.
        [/^\s*\|/, '@rematch', '@table_header'],
        { include: '@inline' },
      ],
      fence: [
        [/^\s*(`{3,}|~{3,})\s*$/, { token: 'markup.fenced-code.block', next: '@pop', nextEmbedded: '@pop' }],
        [/^.*$/, 'markup.raw.content'],
      ],
      fencePlain: [
        [/^\s*(`{3,}|~{3,})\s*$/, { token: 'markup.fenced-code.block', next: '@pop' }],
        [/^.*$/, 'markup.raw.content'],
      ],
      table_header: [
        { include: '@table_common' },
        [/[^\|]+/, 'keyword.table.header'],
      ],
      table_body: [
        { include: '@table_common' },
        { include: '@inline' },
      ],
      table_common: [
        [/\s*[-:]+\s*/, { token: 'keyword', switchTo: '@table_body' }],
        [/^\s*\|/, 'keyword.table.left'],
        [/^\s*[^\|]/, '@rematch', '@pop'],
        [/^\s*$/, '@rematch', '@pop'],
        [/\|/, { cases: { '@eos': 'keyword.table.right', '@default': 'keyword.table.middle' } }],
      ],
      inline: [
        [/@escapes/, 'escape'],
        // GFM strikethrough.
        [/~~([^~]|~~?(?!~))+~~/, 'markup.strikethrough'],
        // Bold / italic.
        [/\*\*\*([^*]|@escapes|\*?(?!\*\*))+\*\*\*/, 'markup.bold'],
        [/\*\*([^*]|@escapes|\*(?!\*))+\*\*/, 'markup.bold'],
        [/\b__([^_]|@escapes)+__\b/, 'markup.bold'],
        [/\*([^*]|@escapes)+\*/, 'markup.italic'],
        [/\b_([^_]|@escapes)+_\b/, 'markup.italic'],
        // Inline code.
        [/`([^`]|@escapes)+`/, 'markup.inline.raw'],
        // Links and images: title and target share the link tone in the
        // built-in themes, so the whole run is one token.
        [/(!?\[)((?:[^\]\\]|@escapes)*(\]\\([^)]+\\)))/, 'string.other.link'],
        // Bare URL.
        [/https?:\/\/[^ )\n]+/, 'string.other.link'],
        // Inline HTML, kept from the built-in lexer.
        [/<(\w+)[^>]*>/, 'tag'],
        [/<\/(\w+)>/, 'tag'],
        [/<!--/, 'comment', '@comment'],
      ],
      comment: [
        [/[^<-]+/, 'comment.content'],
        [/-->/, 'comment', '@pop'],
        [/<!--/, 'comment.content.invalid'],
        [/[<-]/, 'comment.content'],
      ],
    },
  } satisfies Monaco.languages.IMonarchLanguage)
  // Bracket-pair colorization off for markdown, exactly like VS Code:
  // extensions/markdown-basics/language-configuration.json ships
  // "colorizedBracketPairs": [], so VS Code paints ( [ { in the plain text
  // color. Monaco's default would colorize them gold/orchid instead.
  monaco.languages.setLanguageConfiguration('markdown', {
    comments: { blockComment: ['<!--', '-->'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    colorizedBracketPairs: [],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '<', close: '>', notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '`', close: '`' },
    ],
    folding: {
      markers: {
        start: new RegExp('^\\s*<!--\\s*#?region\\b.*-->'),
        end: new RegExp('^\\s*<!--\\s*#?endregion\\b.*-->'),
      },
    },
  })
  // Models created before this registration keep the old tokenization until
  // something re-tokenizes them; poking the language makes every markdown
  // model rebuild against the new lexer.
  for (const model of monaco.editor.getModels()) {
    if (model.getLanguageId() === 'markdown') {
      monaco.editor.setModelLanguage(model, 'plaintext')
      monaco.editor.setModelLanguage(model, 'markdown')
    }
  }
}
registerMarkdownMonarch.done = false