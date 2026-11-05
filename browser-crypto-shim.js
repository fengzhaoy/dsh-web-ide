/** Browser shim for node:crypto — covers exactly what the bundled dependency
 * tree (uuid) needs: randomUUID (WebCrypto) and createHash('md5'|'sha1') for
 * v3/v5 UUID parsing (small pure-JS implementations). Anything else throws. */

export const randomUUID = () => globalThis.crypto.randomUUID()

/* ---- md5 (RFC 1321) ---- */
function md5(input) {
  const rl = (v, s) => (v << s) | (v >>> (32 - s))
  const au = (x, y) => (x + y) | 0
  const cmn = (q, a, b, x, s, t) => au(rl(au(au(a, q), au(x, t)), s), b)
  const ff = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t)
  const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t)
  const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t)
  const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t)
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : Uint8Array.from(input)
  const n = bytes.length
  const words = new Array(((n + 8) >> 6) + 1).fill(0).map(() => new Uint32Array(16))
  for (let i = 0; i < n; i++) words[i >> 6][(i >> 2) & 15] |= bytes[i] << (((i & 3) << 3) & 31)
  words[n >> 6][(n >> 2) & 15] |= 0x80 << (((n & 3) << 3) & 31)
  words[words.length - 1][14] = n * 8
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878
  for (const blk of words) {
    const [x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14, x15] = blk
    a = ff(a, b, c, d, x0, 7, -680876936); d = ff(d, a, b, c, x1, 12, -389564586)
    c = ff(c, d, a, b, x2, 17, 606105819); b = ff(b, c, d, a, x3, 22, -1044525330)
    a = ff(a, b, c, d, x4, 7, -176418897); d = ff(d, a, b, c, x5, 12, 1200080426)
    c = ff(c, d, a, b, x6, 17, -1473231341); b = ff(b, c, d, a, x7, 22, -45705983)
    a = ff(a, b, c, d, x8, 7, 1770035416); d = ff(d, a, b, c, x9, 12, -1958414417)
    c = ff(c, d, a, b, x10, 17, -42063); b = ff(b, c, d, a, x11, 22, -1990404162)
    a = ff(a, b, c, d, x12, 7, 1804603682); d = ff(d, a, b, c, x13, 12, -40341101)
    c = ff(c, d, a, b, x14, 17, -1502002290); b = ff(b, c, d, a, x15, 22, 1236535329)
    a = gg(a, b, c, d, x1, 5, -165796510); d = gg(d, a, b, c, x6, 9, -1069501632)
    c = gg(c, d, a, b, x11, 14, 643717713); b = gg(b, c, d, a, x0, 20, -373897302)
    a = gg(a, b, c, d, x5, 5, -701558691); d = gg(d, a, b, c, x10, 9, 38016083)
    c = gg(c, d, a, b, x15, 14, -660478335); b = gg(b, c, d, a, x4, 20, -405537848)
    a = gg(a, b, c, d, x9, 5, 568446438); d = gg(d, a, b, c, x14, 9, -1019803690)
    c = gg(c, d, a, b, x3, 14, -187363961); b = gg(b, c, d, a, x8, 20, 1163531501)
    a = gg(a, b, c, d, x13, 5, -1444681467); d = gg(d, a, b, c, x2, 9, -51403784)
    c = gg(c, d, a, b, x7, 14, 1735328473); b = gg(b, c, d, a, x12, 20, -1926607734)
    a = hh(a, b, c, d, x5, 4, -378558); d = hh(d, a, b, c, x8, 11, -2022574463)
    c = hh(c, d, a, b, x11, 16, 1839030562); b = hh(b, c, d, a, x14, 23, -35309556)
    a = hh(a, b, c, d, x1, 4, -1530992060); d = hh(d, a, b, c, x4, 11, 1272893353)
    c = hh(c, d, a, b, x7, 16, -155497632); b = hh(b, c, d, a, x10, 23, -1094730640)
    a = hh(a, b, c, d, x13, 4, 681279174); d = hh(d, a, b, c, x0, 11, -358537222)
    c = hh(c, d, a, b, x3, 16, -722521979); b = hh(b, c, d, a, x6, 23, 76029189)
    a = hh(a, b, c, d, x9, 4, -640364487); d = hh(d, a, b, c, x12, 11, -421815835)
    c = hh(c, d, a, b, x15, 16, 530742520); b = hh(b, c, d, a, x2, 23, -995338651)
    a = ii(a, b, c, d, x0, 6, -198630844); d = ii(d, a, b, c, x7, 10, 1126891415)
    c = ii(c, d, a, b, x14, 15, -1416354905); b = ii(b, c, d, a, x5, 21, -57434055)
    a = ii(a, b, c, d, x12, 6, 1700485571); d = ii(d, a, b, c, x3, 10, -1894986606)
    c = ii(c, d, a, b, x10, 15, -1051523); b = ii(b, c, d, a, x1, 21, -2054922799)
    a = ii(a, b, c, d, x8, 6, 1873313359); d = ii(d, a, b, c, x15, 10, -30611744)
    c = ii(c, d, a, b, x6, 15, -1560198380); b = ii(b, c, d, a, x13, 21, 1309151649)
    a = ii(a, b, c, d, x4, 6, -145523070); d = ii(d, a, b, c, x11, 10, -1120210379)
    c = ii(c, d, a, b, x2, 15, 718787259); b = ii(b, c, d, a, x9, 21, -343485551)
    a = au(a, 1732584193); b = au(b, -271733879); c = au(c, -1732584194); d = au(d, 271733878)
  }
  const out = new Uint8Array(16)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, a, true); dv.setUint32(4, b, true); dv.setUint32(8, c, true); dv.setUint32(12, d, true)
  return out
}

/* ---- sha1 (FIPS 180-1) ---- */
function sha1(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : Uint8Array.from(input)
  const n = bytes.length
  const words = []
  for (let i = 0; i < n; i++) words[i >> 2] |= bytes[i] << ((3 - (i & 3)) << 3)
  words[n >> 2] |= 0x80 << ((3 - (n & 3)) << 3)
  const total = (((n + 8) >> 6) + 1) << 4
  for (let i = words.length; i < total; i++) words[i] = 0
  words[total - 1] = n * 8
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0
  const rl = (v, s) => (v << s) | (v >>> (32 - s))
  for (let off = 0; off < total; off += 16) {
    const w = words.slice(off, off + 16)
    for (let i = 16; i < 80; i++) {
      const v = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = rl(v, 1)
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      let f, k
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC }
      else { f = b ^ c ^ d; k = 0xCA62C1D6 }
      const t = (rl(a, 5) + f + e + k + w[i]) | 0
      e = d; d = c; c = rl(b, 30); b = a; a = t
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0
  }
  const out = new Uint8Array(20)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, h0); dv.setUint32(4, h1); dv.setUint32(8, h2); dv.setUint32(12, h3); dv.setUint32(16, h4)
  return out
}

/** Minimal node:crypto.createHash for 'md5' and 'sha1' (uuid v3/v5 use). */
export function createHash(algo) {
  if (algo !== 'md5' && algo !== 'sha1') throw new Error('browser-crypto-shim: unsupported hash ' + algo)
  const parts = []
  return {
    update(data) { parts.push(data); return this },
    digest() {
      const bytes = parts.length === 1 ? parts[0] : parts.flatMap((p) => Array.from(typeof p === 'string' ? new TextEncoder().encode(p) : p))
      return algo === 'md5' ? md5(bytes) : sha1(bytes)
    },
  }
}

export default { randomUUID, createHash }
