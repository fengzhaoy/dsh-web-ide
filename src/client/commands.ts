/**
 * Command registry (VS Code Command Palette parity): one place where every
 * user-invocable IDE action is declared with an id, label (already localized
 * via t()), category and run(). The palette, keybindings and the Manage menu
 * all read from here, so a new command becomes reachable everywhere at once.
 */

export interface IdeCommand {
  /** Stable id (e.g. 'ide.settings'). Also the keybinding target. */
  id: string
  /** Category prefix shown in the palette (e.g. '查看'). */
  category: string
  /** Human label (localized). */
  label: string
  /** Run the command. */
  run: () => void
  /** Shown but not runnable (context missing). */
  disabled?: boolean
}

type Listener = () => void

class CommandRegistry {
  private commands: IdeCommand[] = []
  private listeners = new Set<Listener>()

  /** Replace the whole registry (the view rebuilds it each render because the
   *  run closures capture live state). The palette reads a snapshot. */
  setAll(commands: IdeCommand[]): void {
    this.commands = commands
    for (const fn of this.listeners) fn()
  }

  getSnapshot = (): readonly IdeCommand[] => { return this.commands }

  byId(id: string): IdeCommand | undefined { return this.commands.find((c) => c.id === id) }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}

interface CmdWindow { __dshIdeCommands?: CommandRegistry }
const win = window as unknown as CmdWindow
export const ideCommands: CommandRegistry = win.__dshIdeCommands ??= new CommandRegistry()

/** Simple subsequence fuzzy match: every char of q appears in s in order.
 *  Returns a score (higher = better) or -1 for no match. Case-insensitive;
 *  exact substring beats subsequence; word-start chars beat mid-word. */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const idx = t.indexOf(q)
  if (idx === 0) return 1000
  if (idx > 0) return 800 - idx
  let score = 0
  let ti = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) { found = i; break }
    }
    if (found === -1) return -1
    score += (found === 0 || t[found - 1] === ' ' || t[found - 1] === ':') ? 10 : 4
    ti = found + 1
  }
  return score
}
