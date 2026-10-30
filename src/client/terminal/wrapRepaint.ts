/**
 * Repair for a zle redraw that assumes the edited line does NOT wrap.
 *
 * Measured against a real zsh driving a real xterm at a fixed width:
 * zsh's line editor repaints an edit by rewriting only the columns it
 * believes it owns, then parks the cursor with a horizontal move. When the
 * edited command is long enough to wrap, a deletion shortens the text by one
 * column and the tail must reflow onto the previous row. zle does not do
 * that. For a wrapped command it sends, in one chunk:
 *
 *     bell + <the whole new line> + CSI n D
 *
 * with no CR, no LF, and no erase. The terminal executes those bytes exactly
 * as sent, so the shortened text reflows one row earlier than the cells it
 * was painted over, and the cells the old text occupied stay on screen -- the
 * deleted text survives as a trailing fragment and as grey leftovers. The
 * shell's own model is correct; only the drawing is wrong.
 *
 * This module supplies the missing reflow. It detects that chunk shape, reads
 * the new line text out of the chunk itself (the authoritative copy), folds
 * it back onto the row the line started on, and emits the repaint sequence.
 *
 * Everything here is deliberately conservative. A false negative leaves
 * today's behaviour untouched, while a false positive would repaint rows that
 * an interactive application (vim, less, a REPL prompt) owns, so every
 * heuristic errs towards ignoring the chunk.
 */

/** Distance beyond which a cursor move cannot come from a line repaint. */
const MAX_CURSOR_BACK = 4000

/** Matches SGR (colour) sequences anywhere in a repaint chunk. */
const SGR = /\x1b\[[0-9;]*m/g

/** Matches one "move cursor left by n" sequence (n may be omitted). */
const CURSOR_BACK = /\x1b\[(\d*)D/g

/** Matches one "move cursor up by n" sequence (n may be omitted). */
const CURSOR_UP = /\x1b\[(\d*)A/g

/** What the repair discovered in one output chunk. */
export interface WrapRepaintPlan {
  /** The line text as painted by the chunk, without control sequences. */
  text: string
  /** Columns the cursor was moved back, i.e. the text after the edit point. */
  back: number
  /** Rows the cursor was walked up, which is 0 unless the repaint re-wrapped. */
  up: number
}

/**
 * Recognise a wrapped line repaint in one chunk and return its content.
 * Returns null for ordinary output, which is the overwhelmingly common case.
 */
export function detectWrapRepaint(chunk: string, cols: number): WrapRepaintPlan | null {
  if (cols <= 1 || chunk.length === 0) return null
  // A repaint never emits a line break: the shell expected the terminal to
  // reflow. Anything with CR/LF is ordinary output or a full-screen redraw.
  if (chunk.includes('\r') || chunk.includes('\n')) return null
  // The frame may carry a reset before and/or after the repaint (colour state
  // is often restored after a repaint), so strip SGR and bells before looking
  // at the sequence itself.
  const bare = chunk.replace(SGR, '').replace(/\x07/g, '')
  if (bare.length === 0) return null
  // Take the LAST cursor-back: a repaint parks the cursor once, at the end.
  CURSOR_BACK.lastIndex = 0
  let back = -1
  let match: RegExpExecArray | null
  let painted = ''
  while ((match = CURSOR_BACK.exec(bare)) !== null) {
    const distance = match[1] === '' ? 1 : Number.parseInt(match[1], 10)
    if (!Number.isFinite(distance) || distance <= 0 || distance > MAX_CURSOR_BACK) continue
    back = distance
    painted = bare.slice(0, match.index)
  }
  if (back < 0) return null
  // zsh walks back up to the line's first row with CUU when the repaint
  // re-wraps, then steps left within that row. Fold the CUU away: what matters
  // is that the remainder of the painted part is plain text.
  const upMatch = CURSOR_UP.exec(painted)
  const up = upMatch === null ? 0 : upMatch[1] === '' ? 1 : Number.parseInt(upMatch[1], 10)
  const withoutUp = painted.replace(CURSOR_UP, '')
  // Other escapes left in the painted part mean this is a screen manager
  // redrawing a region, not a line edit.
  if (withoutUp.includes('\x1b')) return null
  // The painted text plus the distance the cursor was walked back spans the
  // whole logical line, so a width of more than one row means it wrapped and
  // zle's single-row repaint cannot have been correct.
  const paintedWidth = withoutUp.length + back
  if (paintedWidth <= cols) return null
  // zle prefixes the repaint with a literal '~' (its "tab expansion" marker),
  // which it erases on the next keystroke; drop it so the repair does not
  // paint it back as content.
  const text = withoutUp.replace(/[\?\x07]/g, '').replace(/^~/, '')
  return { text, back, up: Number.isFinite(up) ? up : 0 }
}
/**
 * Build the repaint for a damaged wrapped-line edit.
 *
 * Before the chunk was written the cursor sat at ('curRow', 'curCol') on the
 * line the shell was about to repaint. That line holds 'prefix' (the prompt)
 * followed by the text the chunk carries, so its first row is
 *   curRow - floor((curCol + back) / cols)
 * because the chunk's text plus the distance the cursor was walked back spans
 * the whole line.
 *
 * 'afterRow'/'afterCol' are the cursor position once the chunk was consumed;
 * the repaint restores the cursor there so typing continues in place.
 * Returns the escape sequence to write, or null when no repaint is needed.
 */
export function buildWrapRepaint(
  prefix: string,
  plan: WrapRepaintPlan,
  cols: number,
  rows: number,
  curRow: number,
  curCol: number,
  afterRow: number,
  afterCol: number,
): string | null {
  if (cols <= 1 || rows <= 0 || curRow < 0 || curRow >= rows) return null
  // The chunk parks the cursor on the row the line begins: it walks up 'up'
  // rows first (zero unless the repaint re-wrapped) and then steps back 'back'
  // columns from wherever the repaint left it, which is the line's own row.
  const startRow = curRow - plan.up
  if (startRow < 0) return null
  const logical = (prefix + plan.text).replace(/\s+$/, '')
  if (logical.length === 0) return null
  const lines: string[] = []
  for (let i = 0; i < logical.length; i += cols) lines.push(logical.slice(i, i + cols))
  const endRow = startRow + lines.length - 1
  // Refuse to scroll: the repair must fit exactly where the text already was.
  // Needing more rows than the window has means the model is off, and guessing
  // would move text under the user's cursor.
  if (endRow >= rows) return null
  if (afterRow < 0 || afterRow >= rows) return null
  let out = ''
  // Clear one row past the end: when the line shrinks, the row it used to
  // reach must be blanked too or its old cells survive as residue.
  const clearTo = Math.min(Math.max(endRow + 1, afterRow, curRow), rows - 1)
  for (let row = startRow; row <= clearTo; row += 1) out += '\x1b[' + (row + 1) + ';1H\x1b[2K'
  for (let i = 0; i < lines.length; i += 1) out += '\x1b[' + (startRow + i + 1) + ';1H' + lines[i]
  out += '\x1b[' + (afterRow + 1) + ';' + (afterCol + 1) + 'H'
  return out
}
