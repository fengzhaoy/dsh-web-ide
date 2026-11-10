// gen-seti-icons.mjs — 从 vs-seti-icon-theme.json 投影出 TypeScript 映射模块。
//
// Seti 图标主题（MIT，源自 jesseweed/seti-ui，由 vscode-theme-seti 打包）是 VS Code
// 内置的文件图标主题：单色 webfont（seti.woff）+ 每个图标一个 fontCharacter 码点与
// fontColor。本生成器把 icons/seti/vs-seti-icon-theme.json 里的
//   iconDefinitions / fileExtensions / fileNames / languageIds
// 投影成 src/client/seti-icon-theme.ts（纯数据，无运行时 JSON 解析），字体在构建期由
// scripts/build-monaco-worker.mjs base64 内联为 generated/seti-font-source.js
// （与 codicon.ttf 同机制，见 src/client/codiconFontBootstrap.ts）。
//
// 重新生成：node src/client/icons/gen-seti-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const THEME_JSON = join(here, 'seti', 'vs-seti-icon-theme.json')
const OUT = join(here, '..', 'seti-icon-theme.ts')

const theme = JSON.parse(readFileSync(THEME_JSON, 'utf8'))
const BS = String.fromCharCode(92) // single backslash

// fontCharacter 在主题 JSON 里是 CSS 转义序列字符串（JSON 解析后为字面 \E001，
// 即反斜杠 + 十六进制，而非真实码点）。VS Code 把它原样塞进 CSS content；本项目
// 直接以文本字符渲染，所以这里解析为真正的 PUA 码点。
function cssEscapeToChar(seq) {
  if (typeof seq !== 'string') return null
  const m = new RegExp('^' + BS + BS + '([0-9a-fA-F]{1,6})$').exec(seq)
  if (m === null) return null
  return String.fromCodePoint(parseInt(m[1], 16))
}

// iconDefinitions 里的键形如 _xml（深色）/_xml_light（浅色）；只取深色版本。
const defs = {}
for (const [key, def] of Object.entries(theme.iconDefinitions ?? {})) {
  if (key.endsWith('_light')) continue
  const char = cssEscapeToChar(def.fontCharacter)
  if (char === null) continue
  defs[key] = { char, color: def.fontColor ?? '#dcdcdc' }
}

// fileExtensions 值是 iconDefinitions 的键（深色版）；键统一 lowercase（VS Code 匹配规则）。
const exts = {}
for (const [ext, defKey] of Object.entries(theme.fileExtensions ?? {})) {
  if (defs[defKey] === undefined) continue
  exts[ext.toLowerCase()] = defKey
}

// fileNames 是完整文件名匹配（大小写不敏感），如 readme.md → _info；优先级最高。
const names = {}
for (const [name, defKey] of Object.entries(theme.fileNames ?? {})) {
  if (defs[defKey] === undefined) continue
  names[name.toLowerCase()] = defKey
}

// languageIds 在 VS Code 里经由语言贡献点匹配；这张表（VS Code 内置扩展的 languages
// 贡献点投影，ext → languageId）把它们折算进 exts（fileExtensions 优先）。
const langExts = {
  ascx:  "xml",
  asp:  "html",
  aspx:  "html",
  atom:  "xml",
  axaml:  "xml",
  axml:  "xml",
  babelrc:  "jsonc",
  bas:  "vb",
  bash:  "shellscript",
  bashrc:  "shellscript",
  bat:  "bat",
  bbx:  "tex",
  bib:  "bibtex",
  bowerrc:  "json",
  bpmn:  "xml",
  brs:  "vb",
  cake:  "csharp",
  cbx:  "tex",
  cc:  "cpp",
  ccm:  "cpp",
  cff:  "yaml",
  cfg:  "properties",
  cginc:  "hlsl",
  cjs:  "javascript",
  clj:  "clojure",
  cljc:  "clojure",
  cljs:  "clojure",
  cljx:  "clojure",
  clojure:  "clojure",
  cls:  "tex",
  cmd:  "bat",
  coffee:  "coffeescript",
  compute:  "hlsl",
  conf:  "properties",
  containerfile:  "dockerfile",
  copilotmd:  "markdown",
  cpp:  "cpp",
  cppm:  "cpp",
  cpt:  "xml",
  cpy:  "python",
  c:  "c",
  cs:  "csharp",
  csh:  "shellscript",
  cshrc:  "shellscript",
  cshtml:  "razor",
  csl:  "xml",
  cson:  "coffeescript",
  csproj:  "xml",
  "csproj.user": "xml",
  css:  "css",
  "css.map": "json",
  csx:  "csharp",
  ctp:  "php",
  cts:  "typescript",
  ctx:  "latex",
  cu:  "cuda-cpp",
  cuh:  "cuda-cpp",
  cxx:  "cpp",
  cxxm:  "cpp",
  dart:  "dart",
  diff:  "diff",
  directory:  "properties",
  dita:  "xml",
  ditamap:  "xml",
  dockerfile:  "dockerfile",
  dsql:  "sql",
  dtd:  "xml",
  dtml:  "xml",
  ebuild:  "shellscript",
  eclass:  "shellscript",
  editorconfig:  "properties",
  edn:  "clojure",
  ejs:  "html",
  ent:  "xml",
  env:  "dotenv",
  erb:  "ruby",
  es6:  "javascript",
  eslintrc:  "jsonc",
  "eslintrc.json": "jsonc",
  eyaml:  "yaml",
  eyml:  "yaml",
  fish:  "shellscript",
  fs:  "fsharp",
  fsi:  "fsharp",
  fsproj:  "xml",
  fsscript:  "fsharp",
  fsx:  "fsharp",
  fx:  "hlsl",
  fxh:  "hlsl",
  fxml:  "xml",
  gemspec:  "ruby",
  geojson:  "json",
  gitattributes:  "properties",
  gitconfig:  "properties",
  gitignore:  "ignore",
  gitmodules:  "properties",
  go:  "go",
  gradle:  "groovy",
  groovy:  "groovy",
  gvy:  "groovy",
  gyp:  "python",
  gypi:  "python",
  "h.in": "cpp",
  handlebars:  "handlebars",
  har:  "json",
  hbs:  "handlebars",
  hh:  "cpp",
  hintrc:  "jsonc",
  hjs:  "handlebars",
  hlsl:  "hlsl",
  hlsli:  "hlsl",
  hpp:  "cpp",
  "hpp.in": "cpp",
  htm:  "html",
  html:  "html",
  hxx:  "cpp",
  iced:  "coffeescript",
  ii:  "cpp",
  iml:  "xml",
  ini:  "ini",
  inl:  "cpp",
  ino:  "cpp",
  ipp:  "cpp",
  ipy:  "python",
  ipynb:  "json",
  isml:  "xml",
  ixx:  "cpp",
  jade:  "jade",
  jav:  "java",
  java:  "java",
  jenkinsfile:  "groovy",
  jl:  "julia",
  jmd:  "juliamarkdown",
  jmx:  "xml",
  js:  "javascript",
  "js.map": "json",
  jscsrc:  "json",
  jsfmtrc:  "jsonc",
  jshintrc:  "jsonc",
  jshtm:  "html",
  jslintrc:  "json",
  json:  "json",
  jsonc:  "jsonc",
  jsonl:  "jsonl",
  jsonld:  "json",
  jsp:  "html",
  jsx:  "javascriptreact",
  ksh:  "shellscript",
  launch:  "xml",
  less:  "less",
  litcoffee:  "markdown",
  log:  "log",
  ltx:  "latex",
  lua:  "lua",
  mak:  "makefile",
  markdn:  "markdown",
  markdown:  "markdown",
  md:  "markdown",
  mdoc:  "html",
  mdown:  "markdown",
  mdtext:  "markdown",
  mdtxt:  "markdown",
  mdwn:  "markdown",
  menu:  "xml",
  mjs:  "javascript",
  mk:  "makefile",
  mkd:  "markdown",
  mkdn:  "markdown",
  mm:  "objective-cpp",
  mod:  "xml",
  mpp:  "cpp",
  mts:  "typescript",
  mxml:  "xml",
  mxx:  "cpp",
  ndjson:  "jsonl",
  nf:  "groovy",
  npmignore:  "ignore",
  npmrc:  "properties",
  nqp:  "raku",
  nuspec:  "xml",
  opml:  "xml",
  owl:  "xml",
  p6:  "raku",
  pac:  "javascript",
  patch:  "diff",
  php:  "php",
  php4:  "php",
  php5:  "php",
  phtml:  "php",
  pl:  "perl",
  pl6:  "raku",
  pm:  "perl",
  pm6:  "raku",
  pod:  "perl",
  podspec:  "ruby",
  profile:  "shellscript",
  proj:  "xml",
  properties:  "properties",
  props:  "xml",
  ps1:  "powershell",
  psd1:  "powershell",
  psgi:  "perl",
  psh:  "hlsl",
  psm1:  "powershell",
  psrc:  "powershell",
  pssc:  "powershell",
  pt:  "xml",
  publishsettings:  "xml",
  pubxml:  "xml",
  "pubxml.user": "xml",
  pug:  "jade",
  py:  "python",
  pyi:  "python",
  pyt:  "python",
  pyw:  "python",
  rake:  "ruby",
  raku:  "raku",
  rakudoc:  "raku",
  rakumod:  "raku",
  rakutest:  "raku",
  razor:  "razor",
  rb:  "ruby",
  rbi:  "ruby",
  rbx:  "ruby",
  rbxlx:  "xml",
  rbxmx:  "xml",
  rdf:  "xml",
  rej:  "diff",
  repo:  "properties",
  rhistory:  "r",
  rhtml:  "html",
  rjs:  "ruby",
  rng:  "xml",
  ron:  "markdown",
  ronn:  "markdown",
  rprofile:  "r",
  rpy:  "python",
  rs:  "rust",
  rss:  "xml",
  rst:  "restructuredtext",
  rt:  "r",
  ru:  "ruby",
  scss:  "scss",
  sh:  "shellscript",
  shader:  "shaderlab",
  shproj:  "xml",
  shtml:  "html",
  slnx:  "xml",
  sql:  "sql",
  storyboard:  "xml",
  sty:  "tex",
  svg:  "xml",
  swcrc:  "jsonc",
  swift:  "swift",
  targets:  "xml",
  tcshrc:  "shellscript",
  tex:  "latex",
  tld:  "xml",
  tmx:  "xml",
  "toolset.jsonc": "jsonc",
  tpp:  "cpp",
  ts:  "typescript",
  "ts.map": "json",
  tsbuildinfo:  "json",
  tsx:  "typescriptreact",
  txx:  "cpp",
  vb:  "vb",
  vba:  "vb",
  vbproj:  "xml",
  "vbproj.user": "xml",
  vbs:  "vb",
  vcxproj:  "xml",
  "vcxproj.filters": "xml",
  volt:  "html",
  vsh:  "hlsl",
  vuerc:  "json",
  wasm:  "wat",
  wat:  "wat",
  webmanifest:  "json",
  winget:  "yaml",
  wixproj:  "xml",
  workbook:  "markdown",
  wsdl:  "xml",
  wxi:  "xml",
  wxl:  "xml",
  wxs:  "xml",
  xaml:  "xml",
  xbl:  "xml",
  xht:  "html",
  xhtml:  "html",
  xib:  "xml",
  xlf:  "xml",
  xliff:  "xml",
  xml:  "xml",
  xoml:  "xml",
  xpdl:  "xml",
  xprofile:  "shellscript",
  xsd:  "xml",
  xsession:  "shellscript",
  xsessionrc:  "shellscript",
  xsl:  "xsl",
  xslt:  "xsl",
  xul:  "xml",
  yaml:  "yaml",
  yashrc:  "shellscript",
  yml:  "yaml",
  zlogin:  "shellscript",
  zlogout:  "shellscript",
  zprofile:  "shellscript",
  zsh:  "shellscript",
  zshenv:  "shellscript",
  zshrc:  "shellscript"
}
for (const [ext, langId] of Object.entries(langExts)) {
  const defKey = (theme.languageIds ?? {})[langId]
  if (defKey === undefined || defs[defKey] === undefined) continue
  if (exts[ext] === undefined) exts[ext] = defKey
}

const DEFAULT_FILE = theme.file ?? '_default'

// PUA 码点 → TS 源码转义字面 "\\uXXXX"（单反斜杠，TS 解析回码点）。避免文件里出现
// 不可见字符（git diff / 编辑器 / review 全部友好）。颜色键已是安全十六进制。
function charLiteral(char) {
  return '"' + BS + 'u' + char.codePointAt(0).toString(16).toUpperCase() + '"'
}

function defLines(map) {
  return Object.entries(map).map(([k, v]) => '  ' + JSON.stringify(k) + ': { char: ' + charLiteral(v.char) + ', color: ' + JSON.stringify(v.color) + ' }').join(',\n')
}

function strMapLines(map) {
  return Object.entries(map).map(([k, v]) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n')
}

const out = [
  '/**',
  ' * GENERATED FILE — DO NOT EDIT.',
  ' *',
  ' * Seti 文件图标主题投影，数据源 icons/seti/vs-seti-icon-theme.json（MIT，',
  ' * jesseweed/seti-ui，经 vscode-theme-seti 打包，与 VS Code / code-server 内置的',
  ' * Seti Icon Theme 完全同一份）。由 gen-seti-icons.mjs 生成；改数据请改 JSON 后重跑生成器。',
  ' *',
  ' * 渲染机制：seti.woff webfont + fontCharacter 码点 + fontColor 单色着色，',
  ' * 见 setiFileIcon.tsx。文件夹不用字体图标（主题 JSON 没有 folder 码点），',
  ' * 沿用 codicon folder/folderOpen SVG。',
  ' */',
  '',
  '/** 单个 Seti 图标：woff 码点（Private Use Area）与深色主题前景色。 */',
  'export interface SetiIconDef { readonly char: string; readonly color: string }',
  '',
  '/** iconDefinitions 深色版（_xxx 键 → 码点+颜色），_xxx_light 已剔除。 */',
  'export const SETI_ICON_DEFS: Readonly<Record<string, SetiIconDef>> = {',
  defLines(defs),
  '}',
  '',
  '/** 小写扩展名 → iconDefinitions 键（fileExtensions + languageIds 折算的别名）。 */',
  'export const SETI_FILE_EXTENSIONS: Readonly<Record<string, string>> = {',
  strMapLines(exts),
  '}',
  '',
  '/** 小写完整文件名 → iconDefinitions 键（fileNames，优先级高于扩展名）。 */',
  'export const SETI_FILE_NAMES: Readonly<Record<string, string>> = {',
  strMapLines(names),
  '}',
  '',
  '/** file 根图标（无任何匹配时）对应的 iconDefinitions 键。 */',
  'export const SETI_DEFAULT_FILE_KEY = ' + JSON.stringify(DEFAULT_FILE),
  '',
].join('\n')

writeFileSync(OUT, out)
console.log('generated ' + OUT + ': ' + Object.keys(defs).length + ' icon defs, ' + Object.keys(exts).length + ' extensions, ' + Object.keys(names).length + ' file names')
