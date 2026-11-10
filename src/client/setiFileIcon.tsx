/**
 * Seti 文件图标 — 资源管理器 / 源代码管理 / 搜索 / 提交图共用的文件级图标。
 *
 * 与 VS Code / code-server 内置的 "Seti Icon Theme" 同源：seti.woff webfont
 * （MIT，jesseweed/seti-ui）+ 主题映射（src/client/seti-icon-theme.ts，由
 * icons/seti/vs-seti-icon-theme.json 投影生成）。每个图标 = 一个 PUA 码点 +
 * 一个主题色；渲染就是一个着色的文本字符。
 *
 * 匹配优先级与 VS Code 一致：完整文件名（大小写不敏感）> 扩展名 > 默认 file。
 * 文件夹图标不在 seti 字体里（主题 JSON 无 folder 码点），继续用 codicon
 * folder / folderOpen SVG。
 */
import type { ReactNode } from 'react'
import setiFontBase64 from './generated/seti-font-source.js'
import { Icons } from './icons.js'
import { SETI_DEFAULT_FILE_KEY, SETI_FILE_EXTENSIONS, SETI_FILE_NAMES, SETI_ICON_DEFS } from './seti-icon-theme.js'

let fontInstalled = false

/** 注入 Seti webfont @font-face（base64 数据 URI）。幂等；IdeView 挂载时调用一次。 */
export function installSetiFont(): void {
  if (fontInstalled) return
  fontInstalled = true
  const doc = document
  const style = doc.createElement('style')
  style.setAttribute('data-dsh-ide-seti', '')
  style.textContent =
    '@font-face{font-family:"seti";font-display:block;' +
    'src:url(data:font/woff;base64,' + setiFontBase64 + ') format("woff")}'
  ;(doc.head ?? doc.documentElement).appendChild(style)
}

/** 文件名（含扩展名）→ Seti iconDefinitions 键。公开给测试。
 *
 * 匹配语义与 VS Code 的 getIconClasses + fileIconThemeData 对齐：
 * 1. 完整文件名（lowercase）精确匹配 fileNames（VS Code: .{name}-name-file-icon，
 *    特异性最高）。
 * 2. 扩展名：VS Code 会给文件名里「每个点开始的后缀组合」都挂 class
 *    （a.b.spec.ts → b.spec.ts-ext、spec.ts-ext、ts-ext），主题侧的 fileExtensions
 *    多段键（js.map / spec.ts）因此命中；这里等价地按长→短逐个试。
 *    >255 字符的文件名跳过扩展名组合（VS Code issue #116199 同款保护）。
 * 3. 都未命中 → 默认 file 图标。
 */
export function setiKeyFor(name: string): string {
  const lower = name.toLowerCase()
  const byName = SETI_FILE_NAMES[lower]
  if (byName !== undefined) return byName
  if (lower.length <= 255) {
    const segs = lower.split('.')
    for (let i = 1; i < segs.length; i++) {
      const suffix = segs.slice(i).join('.')
      const byExt = SETI_FILE_EXTENSIONS[suffix]
      if (byExt !== undefined) return byExt
    }
  }
  return SETI_DEFAULT_FILE_KEY
}

/** 单个文件图标节点：码点字符 + 主题色。必须已调用 installSetiFont()。 */
export function setiFileIcon(name: string, isDir: boolean, isOpen?: boolean): ReactNode {
  if (isDir) return isOpen ? Icons.folderOpen : Icons.folder
  const def = SETI_ICON_DEFS[setiKeyFor(name)]
  if (def === undefined) return Icons.file
  return <span className="ide-seti-icon" style={{ color: def.color }}>{def.char}</span>
}
