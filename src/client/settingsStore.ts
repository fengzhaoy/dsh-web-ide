/**
 * IDE user settings store (VS Code Settings parity): localStorage-backed,
 * subscribe/notify, hot-applied to Monaco (editor options), xterm (terminal
 * options) and the CSS-variable theme. Pure module, no React — components
 * subscribe via useSyncExternalStore-friendly subscribe()/getSnapshot().
 *
 * Keys intentionally mirror VS Code's user settings semantics (but flat, and
 * namespaced): theme, editor.*, terminal.*.
 */
import type * as Monaco from 'monaco-editor'

export interface IdeSettings {
  /** Color theme: 'dark-modern' (default) or 'light-modern'. */
  theme: 'dark-modern' | 'light-modern'
  /** Editor font size in px (Monaco fontSize). */
  'editor.fontSize': number
  /** Editor line height in px (Monaco lineHeight; 0 = auto). */
  'editor.lineHeight': number
  /** Show the minimap (Monaco minimap.enabled). */
  'editor.minimap': boolean
  /** Word wrap (Monaco wordWrap: 'on' | 'off'). */
  'editor.wordWrap': 'on' | 'off'
  /** Render whitespace (Monaco renderWhitespace). */
  'editor.renderWhitespace': 'none' | 'boundary' | 'selection' | 'all'
  /** Show line numbers (Monaco lineNumbers). */
  'editor.lineNumbers': boolean
  /** Cursor blink style (Monaco cursorBlinking). */
  'editor.cursorBlinking': 'blink' | 'smooth' | 'phase' | 'expand' | 'solid'
  /** Smooth scrolling (Monaco smoothScrolling). */
  'editor.smoothScrolling': boolean
  /** Terminal font size in px (xterm fontSize). */
  'terminal.fontSize': number
  /** Terminal cursor blink (xterm cursorBlink). */
  'terminal.cursorBlink': boolean
  /** Terminal scrollback lines (xterm scrollback). */
  'terminal.scrollback': number
  /** Enable FIM inline completion (experimental; needs DEEPSEEK_API_KEY). */
  'fim.enabled': boolean
  /** FIM debounce in ms (how long after the cursor stops before requesting). */
  'fim.debounceMs': number
}

export const DEFAULT_SETTINGS: IdeSettings = {
  theme: 'dark-modern',
  'editor.fontSize': 13,
  'editor.lineHeight': 20,
  'editor.minimap': true,
  'editor.wordWrap': 'off',
  'editor.renderWhitespace': 'selection',
  'editor.lineNumbers': true,
  'editor.cursorBlinking': 'smooth',
  'editor.smoothScrolling': true,
  'terminal.fontSize': 13,
  'terminal.cursorBlink': true,
  'terminal.scrollback': 5000,
  'fim.enabled': false,
  'fim.debounceMs': 250,
}

const STORAGE_KEY = 'dsh-ide.settings'

/** Window-parked store so a client hot-reload (pnpm run bundle) keeps the
 *  in-memory settings and subscribers — same lifetime trick as
 *  __dshIdeSessionTerminals in IdeView. */
interface SettingsWindow { __dshIdeSettingsStore?: SettingsStore }
const win = window as unknown as SettingsWindow

type Listener = (s: IdeSettings) => void

class SettingsStore {
  private listeners = new Set<Listener>()
  private data: IdeSettings

  constructor() {
    this.data = { ...DEFAULT_SETTINGS, ...loadPersisted() }
  }

  getSnapshot = (): IdeSettings => { return this.data }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  update(patch: Partial<IdeSettings>): void {
    this.data = { ...this.data, ...patch }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)) } catch { /* denied */ }
    for (const fn of this.listeners) fn(this.data)
  }

  /** Replace wholesale (import). Invalid fields fall back to defaults. */
  replace(raw: unknown): void {
    const next = sanitize(raw)
    this.data = next
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* denied */ }
    for (const fn of this.listeners) fn(this.data)
  }

  /** Exportable JSON (round-trips through replace). */
  export(): string { return JSON.stringify(this.data, null, 2) }
}

function loadPersisted(): Partial<IdeSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return sanitize(JSON.parse(raw))
  } catch { return {} }
}

function sanitize(raw: unknown): IdeSettings {
  const out = { ...DEFAULT_SETTINGS }
  if (raw == null || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (r['theme'] === 'light-modern' || r['theme'] === 'dark-modern') out['theme'] = r['theme']
  const fontSize = clampInt(r['editor.fontSize'], 6, 40)
  if (fontSize !== undefined) out['editor.fontSize'] = fontSize
  const lineHeight = clampInt(r['editor.lineHeight'], 0, 80)
  if (lineHeight !== undefined) out['editor.lineHeight'] = lineHeight
  if (typeof r['editor.minimap'] === 'boolean') out['editor.minimap'] = r['editor.minimap']
  if (r['editor.wordWrap'] === 'on' || r['editor.wordWrap'] === 'off') out['editor.wordWrap'] = r['editor.wordWrap']
  const ws = r['editor.renderWhitespace']
  if (ws === 'none' || ws === 'boundary' || ws === 'selection' || ws === 'all') out['editor.renderWhitespace'] = ws
  if (typeof r['editor.lineNumbers'] === 'boolean') out['editor.lineNumbers'] = r['editor.lineNumbers']
  const cb = r['editor.cursorBlinking']
  if (cb === 'blink' || cb === 'smooth' || cb === 'phase' || cb === 'expand' || cb === 'solid') out['editor.cursorBlinking'] = cb
  if (typeof r['editor.smoothScrolling'] === 'boolean') out['editor.smoothScrolling'] = r['editor.smoothScrolling']
  const tf = clampInt(r['terminal.fontSize'], 6, 40)
  if (tf !== undefined) out['terminal.fontSize'] = tf
  if (typeof r['terminal.cursorBlink'] === 'boolean') out['terminal.cursorBlink'] = r['terminal.cursorBlink']
  const sb = clampInt(r['terminal.scrollback'], 100, 100000)
  if (sb !== undefined) out['terminal.scrollback'] = sb
  return out
}

function clampInt(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return undefined
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** The single settings store instance (window-parked across hot reloads). */
export const ideSettings: SettingsStore = win.__dshIdeSettingsStore ??= new SettingsStore()

/** Apply the editor-related settings to a Monaco editor instance. */
export function applyEditorOptions(editor: Monaco.editor.ICodeEditor, s: IdeSettings): void {
  editor.updateOptions({
    fontSize: s['editor.fontSize'],
    lineHeight: s['editor.lineHeight'] === 0 ? 0 : s['editor.lineHeight'],
    minimap: { enabled: s['editor.minimap'] },
    wordWrap: s['editor.wordWrap'],
    renderWhitespace: s['editor.renderWhitespace'],
    lineNumbers: s['editor.lineNumbers'] ? 'on' : 'off',
    cursorBlinking: s['editor.cursorBlinking'],
    smoothScrolling: s['editor.smoothScrolling'],
  })
}

/** Terminal options projection (consumed by TerminalPanel at attach time and
 *  on settings change via term.options). */
export function terminalXtermOptions(s: IdeSettings): {
  fontSize: number
  cursorBlink: boolean
  scrollback: number
} {
  return {
    fontSize: s['terminal.fontSize'],
    cursorBlink: s['terminal.cursorBlink'],
    scrollback: s['terminal.scrollback'],
  }
}

/** xterm.js colour theme for an IDE theme id. The terminal panel used to
 *  hardcode the dark palette regardless of the active theme: on the light
 *  theme the shell's own default-foreground output (and anything it repainted)
 *  came out as near-white-on-white, which is what users read as "grey/faded
 *  leftover history" text. */
export function xtermThemeFor(theme: IdeSettings['theme']): Record<string, string> {
  const light = theme === 'light-modern'
  const background = light ? '#ffffff' : '#1f1f1f'
  return {
    background,
    foreground: light ? '#3b3b3b' : '#cccccc',
    cursor: light ? '#000000' : '#aeafad',
    cursorAccent: background,
    selectionBackground: light ? 'rgba(0,0,0,0.18)' : '#264f78',
    selectionForeground: light ? '#1f1f1f' : '#ffffff',
    // Standard ANSI 16-color palette (Dark+ / Light+ variants).
    black: light ? '#000000' : '#000000',
    red: light ? '#cd3131' : '#cd3131',
    green: light ? '#0dbc79' : '#0dbc79',
    yellow: light ? '#949800' : '#e5e510',
    blue: light ? '#0451a5' : '#2472c8',
    magenta: light ? '#bc05bc' : '#bc3fbc',
    cyan: light ? '#0598bc' : '#11a8cd',
    white: light ? '#555555' : '#e5e5e5',
    brightBlack: light ? '#666666' : '#666666',
    brightRed: light ? '#cd3131' : '#f14c4c',
    brightGreen: light ? '#14ce14' : '#23d18b',
    brightYellow: light ? '#b5ba00' : '#f5f543',
    brightBlue: light ? '#0451a5' : '#3b8eea',
    brightMagenta: light ? '#bc05bc' : '#d670d6',
    brightCyan: light ? '#0598bc' : '#29b8db',
    brightWhite: light ? '#a5a5a5' : '#e5e5e5',
  }
}

/**
 * ── Keybindings (VS Code Keyboard Shortcuts parity) ─────────────────────
 * Command ids match the command registry (commands.ts). Defaults mirror the
 * VS Code chords (Cmd/Ctrl overridable per binding).
 */
export interface Keybinding { command: string; keys: string }

const KB_STORAGE_KEY = 'dsh-ide.keybindings'

/** Default bindings: serialized key chords, platform-agnostic "Mod" prefix
 *  (Mod = Cmd on macOS, Ctrl elsewhere). */
export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  { command: 'ide.find', keys: 'Mod+F' },
  { command: 'ide.commandPalette', keys: 'Mod+Shift+P' },
  { command: 'ide.settings', keys: 'Mod+,' },
  { command: 'ide.keybindings', keys: 'Mod+K Mod+S' },
  { command: 'ide.save', keys: 'Mod+S' },
  { command: 'ide.toggleTerminal', keys: 'Mod+`' },
  { command: 'ide.toggleSidebar', keys: 'Mod+B' },
  { command: 'ide.problems', keys: 'Mod+Shift+M' },
]

class KeybindingStore {
  private listeners = new Set<(kb: Keybinding[]) => void>()
  private data: Keybinding[]

  constructor() { this.data = loadKb() }

  getSnapshot = (): Keybinding[] => { return this.data }

  subscribe = (fn: (kb: Keybinding[]) => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** Set one command's binding. keys='' clears it (falls back to command
   *  palette only). Duplicate chords on other commands are removed. */
  set(command: string, keys: string): void {
    const rest = this.data.filter((k) => k.command !== command && k.keys !== keys)
    this.data = [...rest, { command, keys }]
    try { localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(this.data)) } catch { /* denied */ }
    for (const fn of this.listeners) fn(this.data)
  }

  reset(command: string): void {
    const def = DEFAULT_KEYBINDINGS.find((k) => k.command === command)
    const rest = this.data.filter((k) => k.command !== command && !(def && k.keys === def.keys))
    this.data = [...rest, def ?? { command, keys: '' }]
    try { localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(this.data)) } catch { /* denied */ }
    for (const fn of this.listeners) fn(this.data)
  }

  resetAll(): void {
    this.data = DEFAULT_KEYBINDINGS.map((k) => ({ ...k }))
    try { localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(this.data)) } catch { /* denied */ }
    for (const fn of this.listeners) fn(this.data)
  }

  exportAll(): string { return JSON.stringify({ keybindings: this.data }, null, 2) }

  keysFor(command: string): string {
    return this.data.find((k) => k.command === command)?.keys ?? ''
  }
}

function loadKb(): Keybinding[] {
  try {
    const raw = localStorage.getItem(KB_STORAGE_KEY)
    if (!raw) return DEFAULT_KEYBINDINGS.map((k) => ({ ...k }))
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_KEYBINDINGS.map((k) => ({ ...k }))
    const out: Keybinding[] = []
    for (const e of parsed) {
      if (e && typeof e === 'object' && typeof e.command === 'string' && typeof e.keys === 'string') out.push({ command: e.command, keys: e.keys })
    }
    return out
  } catch { return DEFAULT_KEYBINDINGS.map((k) => ({ ...k })) }
}

interface KbWindow { __dshIdeKeybindings?: KeybindingStore }
const kbWin = window as unknown as KbWindow
export const ideKeybindings: KeybindingStore = kbWin.__dshIdeKeybindings ??= new KeybindingStore()

/** Normalize a KeyboardEvent into a serialized chord like "Mod+Shift+P".
 *  Mod resolves to Cmd on macOS, Ctrl elsewhere. Returns '' for unprintable
 *  solo modifiers. */
export function eventToChord(e: KeyboardEvent, isMac: boolean): string {
  // Mod = Cmd on mac / Ctrl elsewhere; on mac an explicit Ctrl chord is also
  // accepted (VS Code lets both Cmd and Ctrl combos be bound).
  const mod = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey
  const parts: string[] = []
  if (mod) parts.push('Mod')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  const k = e.key
  if (k === 'Shift' || k === 'Control' || k === 'Meta' || k === 'Alt' || k === 'Dead') return ''
  let key = k
  if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

/** Match a keydown event against a serialized chord. */
export function chordMatches(chord: string, e: KeyboardEvent, isMac: boolean): boolean {
  if (!chord) return false
  return eventToChord(e, isMac) === chord
}

/**
 * ── Snippets (VS Code User Snippets parity) ─────────────────────────────
 * Per-language JSON snippet maps, persisted in localStorage. Shape mirrors
 * VS Code: { [prefix]: { prefix, body: string[], description } }.
 */
export interface SnippetDef { prefix: string; body: string[]; description?: string }

const SN_STORAGE_KEY = 'dsh-ide.snippets'

class SnippetStore {
  private listeners = new Set<() => void>()
  private data: Record<string, Record<string, SnippetDef>>

  constructor() {
    this.data = loadSnippets()
  }

  getSnapshot = (): Record<string, Record<string, SnippetDef>> => { return this.data }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** Set one language's snippet map (parsed JSON or {}). */
  setLanguage(languageId: string, map: Record<string, SnippetDef>): void {
    const next = { ...this.data }
    if (Object.keys(map).length === 0) delete next[languageId]
    else next[languageId] = map
    this.data = next
    try { localStorage.setItem(SN_STORAGE_KEY, JSON.stringify(next)) } catch { /* denied */ }
    for (const fn of this.listeners) fn()
  }

  snippetsFor(languageId: string): SnippetDef[] {
    const map = this.data[languageId]
    return map ? Object.values(map) : []
  }
}

function loadSnippets(): Record<string, Record<string, SnippetDef>> {
  try {
    const raw = localStorage.getItem(SN_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, Record<string, SnippetDef>>
  } catch { return {} }
}

interface SnWindow { __dshIdeSnippets?: SnippetStore }
const snWin = window as unknown as SnWindow
export const ideSnippets: SnippetStore = snWin.__dshIdeSnippets ??= new SnippetStore()
