/**
 * SHA-256 hex of a UTF-8 string — the content identity used for
 * replaceIfUnchanged saves.
 *
 * Why content instead of the fs "version" token: the token
 * (dev:ino:size:mtimeNs:ctimeNs) is minted by two different subsystems —
 * workspaceFiles.stat() on open, ctx.fs.writeText() on save — and their
 * normalizations disagreed, so an untouched file was reported as "changed on
 * disk" on every second save. A content digest answers the question the user
 * actually cares about: are the bytes still the ones this buffer started from?
 */
export async function sha256HexText(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
