/**
 * Text encoding detection and transcoding for the IDE editor.
 *
 * The workspace-files read path hands back raw bytes, and the editor used to
 * decode them as UTF-8 no matter what. A GBK or Latin-1 file therefore opened
 * as mojibake (every invalid byte became U+FFFD, which is lossy), and saving
 * wrote that corrupted text back as UTF-8 — destroying the original file.
 *
 * The strategy here mirrors what VS Code does in practice:
 *   1. Honour a BOM when present (UTF-8 / UTF-16LE / UTF-16BE) — unambiguous.
 *   2. Otherwise require the bytes to be VALID UTF-8; if they are, it is UTF-8.
 *      (Almost all source files are, so this is the fast and safe default.)
 *   3. If the bytes are not valid UTF-8, fall back to a legacy single/double
 *      byte encoding, chosen by the same heuristics a human would use: the
 *      encoding that decodes with the fewest replacement characters wins.
 *
 * Only a round-trip-safe decode is ever treated as editable. Because the
 * editor's save path can only re-encode what it knows, a file whose encoding
 * cannot be re-produced byte-for-byte is opened read-only rather than being
 * silently corrupted on the first Ctrl+S.
 */

/** Encodings the editor can both decode AND re-encode losslessly. */
export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'gbk' | 'latin1'

export interface DecodedFile {
  /** Text with any BOM stripped (the editor never sees it). */
  readonly text: string
  readonly encoding: TextEncoding
  /** True when re-encoding `text` with `encoding` reproduces the input bytes
   *  exactly. A false value means the file must NOT be written back: the
   *  editor would destroy it. */
  readonly lossless: boolean
}

const REPLACEMENT = '\uFFFD'

function hasBom(data: Uint8Array, bytes: readonly number[]): boolean {
  if (data.length < bytes.length) return false
  return bytes.every((b, i) => data[i] === b)
}

/** Decode with the given label; undefined when the platform lacks it. */
function tryDecode(data: Uint8Array, label: string, fatal: boolean): string | undefined {
  try {
    return new TextDecoder(label, { fatal }).decode(data)
  } catch {
    return undefined
  }
}

function countReplacement(s: string): number {
  let n = 0
  let i = s.indexOf(REPLACEMENT)
  while (i !== -1) { n += 1; i = s.indexOf(REPLACEMENT, i + 1) }
  return n
}

/** Number of bytes that are >= 0x80 (a cheap "is this ASCII?" probe). */
function highByteCount(data: Uint8Array): number {
  let n = 0
  for (let i = 0; i < data.length; i++) if (data[i] >= 0x80) n += 1
  return n
}

/** True when the whole buffer is valid UTF-8. */
function isValidUtf8(data: Uint8Array): boolean {
  return tryDecode(data, 'utf-8', true) !== undefined
}

/**
 * Encode text back to the bytes of `encoding`. Returns undefined for an
 * encoding this module cannot produce (there is no GBK encoder in the
 * platform's TextEncoder, so GBK is decode-only here).
 */
export function encodeText(text: string, encoding: TextEncoding): Uint8Array | undefined {
  switch (encoding) {
    case 'utf-8':
      return new TextEncoder().encode(text)
    case 'utf-8-bom': {
      const body = new TextEncoder().encode(text)
      const out = new Uint8Array(body.length + 3)
      out.set([0xEF, 0xBB, 0xBF], 0)
      out.set(body, 3)
      return out
    }
    case 'utf-16le': {
      const out = new Uint8Array(text.length * 2)
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        out[i * 2] = c & 0xff
        out[i * 2 + 1] = (c >> 8) & 0xff
      }
      return out
    }
    case 'utf-16be': {
      const out = new Uint8Array(text.length * 2)
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        out[i * 2] = (c >> 8) & 0xff
        out[i * 2 + 1] = c & 0xff
      }
      return out
    }
    case 'latin1': {
      const out = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        // Outside Latin-1 there is no byte for the character.
        if (c > 0xff) return undefined
        out[i] = c
      }
      return out
    }
    case 'gbk':
      // TextEncoder is UTF-8 only; without an explicit GBK encoder we cannot
      // faithfully reproduce the file.
      return undefined
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Detect the encoding of `data` and decode it.
 *
 * The returned `lossless` flag is the safety interlock for saving: it is only
 * true when re-encoding the decoded text reproduces the original bytes, which
 * is precisely the condition under which writing back cannot corrupt the file.
 */
export function decodeFile(data: Uint8Array): DecodedFile {
  // Empty file: nothing to detect, and any encoding round-trips to empty.
  if (data.length === 0) return { text: '', encoding: 'utf-8', lossless: true }

  // 1. BOM-first. A BOM is an explicit declaration, so it wins outright.
  if (hasBom(data, [0xEF, 0xBB, 0xBF])) {
    const body = data.subarray(3)
    const text = tryDecode(body, 'utf-8', false) ?? ''
    return { text, encoding: 'utf-8-bom', lossless: isValidUtf8(body) }
  }
  if (hasBom(data, [0xFF, 0xFE])) {
    const body = data.subarray(2)
    const text = tryDecode(body, 'utf-16le', false) ?? ''
    return { text, encoding: 'utf-16le', lossless: encodeMatches(text, 'utf-16le', body) }
  }
  if (hasBom(data, [0xFE, 0xFF])) {
    const body = data.subarray(2)
    const text = tryDecode(body, 'utf-16be', false) ?? ''
    return { text, encoding: 'utf-16be', lossless: encodeMatches(text, 'utf-16be', body) }
  }

  // 2. Pure ASCII: UTF-8 by definition, and every legacy encoding agrees, so
  //    keep UTF-8 (the editor's native encoding) to avoid churn on save.
  if (highByteCount(data) === 0) {
    return { text: tryDecode(data, 'utf-8', false) ?? '', encoding: 'utf-8', lossless: true }
  }

  // 3. Valid UTF-8 with non-ASCII bytes: it is UTF-8. Multi-byte sequences
  //    that decode cleanly are essentially never valid in a legacy encoding.
  if (isValidUtf8(data)) {
    const text = tryDecode(data, 'utf-8', false) ?? ''
    return { text, encoding: 'utf-8', lossless: encodeMatches(text, 'utf-8', data) }
  }

  // 4. Not valid UTF-8 — try the legacy candidates and keep the cleanest.
  //    GBK (a strict superset of GB2312/GB18030 for common text) is the
  //    dominant CJK legacy encoding; Latin-1 decodes ANY byte sequence
  //    without error, so it is only accepted when it beats GBK on noise.
  const candidates: TextEncoding[] = ['gbk', 'latin1']
  let best: DecodedFile | undefined
  let bestScore = Number.POSITIVE_INFINITY
  for (const encoding of candidates) {
    const label = encoding === 'latin1' ? 'windows-1252' : encoding
    const decoded = tryDecode(data, label, false)
    if (decoded === undefined) continue
    // windows-1252 maps a few bytes to control chars; treat U+FFFD and the
    // C1 control range as "noise" so genuinely broken data scores worst.
    const noise = countReplacement(decoded) + (decoded.match(/[\u0080-\u009F]/g)?.length ?? 0)
    if (noise < bestScore) {
      bestScore = noise
      best = { text: decoded, encoding, lossless: encodeMatches(decoded, encoding, data) }
    }
  }
  if (best !== undefined && bestScore === 0) return best

  // 5. Nothing decoded cleanly. Present whatever is least damaged, but mark
  //    it non-lossless so the editor refuses to write it back.
  const fallbackText = tryDecode(data, 'utf-8', false) ?? ''
  return { text: fallbackText, encoding: 'utf-8', lossless: false }
}

/** True when encoding `text` with `encoding` reproduces `original` exactly. */
function encodeMatches(text: string, encoding: TextEncoding, original: Uint8Array): boolean {
  const encoded = encodeText(text, encoding)
  if (encoded === undefined) return false
  return bytesEqual(encoded, original)
}

/** Human label for the status bar (VS Code wording). */
export function encodingLabel(encoding: TextEncoding): string {
  switch (encoding) {
    case 'utf-8': return 'UTF-8'
    case 'utf-8-bom': return 'UTF-8 with BOM'
    case 'utf-16le': return 'UTF-16 LE'
    case 'utf-16be': return 'UTF-16 BE'
    case 'gbk': return 'GBK'
    case 'latin1': return 'Western (Windows 1252)'
  }
}
