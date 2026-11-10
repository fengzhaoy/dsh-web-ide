/**
 *
 * Architecture (mirrors VSCode's terminal tabbed view at a high level):
 * - The parent (IdeView) owns the list of terminal IDs and the active index.
 * - This panel owns one xterm.js Terminal instance per terminal ID, kept in a
 *   ref Map so they survive React re-renders. Each terminal has its own DOM
 *   host div; only the active one is visible (display:block), the rest are
 *   hidden (display:none) but keep their scrollback alive.
 * - The toolbar shows a tab list (one per terminal) on the left and action
 *   buttons on the right: new (+), split (split-horizontal), kill (trash),
 *   maximize/restore, minimize/expand, close.
 * - panelState controls the panel height: normal (220px), maximized (60vh),
 *   minimized (toolbar-only 35px).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { IdeToolsRemote, SessionId } from '../types.js'
import { Icons } from '../icons.js'
import { showContextMenu } from '../ContextMenu.js'
import { copyTextOrNotify, copyFailureNotifier } from '../clipboard.js'
import { ideSettings, terminalXtermOptions, xtermThemeFor } from '../settingsStore.js'
import { buildWrapRepaint, detectWrapRepaint } from './wrapRepaint.js'
import type { WrapRepaintPlan } from './wrapRepaint.js'
// xterm.js core styles: hides the helper textarea (the IME/keyboard capture
// element that otherwise shows as a stray input box), sizes the viewport/
// screen/rows layers, and sets the canvas/DOM renderer stacking. Without this
// the terminal's auxiliary <textarea> renders as a visible 14×21 input box.
import '@xterm/xterm/css/xterm.css'

export interface TerminalPanelProps {
  sessionId: SessionId
  ideTools: IdeToolsRemote
  /** All open terminal IDs (managed by the parent). */
  terminalIds: readonly string[]
  /** Index of the currently active terminal in terminalIds. */
  activeIdx: number
  /** A new terminal was opened on the host; parent should add it to the list. */
  onTerminalOpened: (id: string) => void
  /** The active terminal index changed; parent should update its state. */
  onActiveChange: (idx: number) => void
  /** A terminal was terminated; parent should remove it from the list. */
  onTerminalClosed: (idx: number) => void
  /** Close the entire panel (terminals keep running on the host). */
  onClose: () => void
  /** True while the hosting IDE tab is visible. Switching to the chat tab and
   *  back does NOT remount this panel (DSH hides the body), so without this
   *  signal the focus effect below never re-runs and the terminal silently
   *  stops accepting keystrokes after the user returns. */
  tabVisible?: boolean
  /** DOM mount point at the right end of the bottom panel's tab row. The
   *  action buttons are portaled into it so they sit at the top-right corner
   *  of the bottom panel, sharing the row with the 问题 / 终端 tabs. The
   *  terminal no longer renders a toolbar of its own. */
  actionsHost?: HTMLElement | null
  t: (key: string, params?: Record<string, string | number>) => string
}

type PanelState = 'normal' | 'maximized' | 'minimized'
type TermStatus = 'connecting' | 'ready' | 'exited' | 'failed'

/** Pixel height bounds for the draggable sizer. The panel lives at the bottom
 *  of the IDE column; dragging the top edge grows/shrinks it within these
 *  limits. Maximize/minimize buttons bypass these and use fixed sizes. */
const PANEL_HEIGHT_DEFAULT = 220
const PANEL_HEIGHT_MIN = 120
const PANEL_HEIGHT_MAX = 800

// VS Code-style per-terminal color palette: each terminal gets a color from
// this cycle, shown as a left bar on its sidebar entry. Matches VS Code's
// terminal tab color feature.
const TERMINAL_COLORS = [
  '#f14c4c', // red
  '#0dbc79', // green
  '#2472c8', // blue
  '#e5e510', // yellow
  '#bc3fbc', // magenta
  '#11a8cd', // cyan
  '#f5f543', // bright yellow
  '#d670d6', // bright magenta
] as const


type TerminalModule = typeof import('@xterm/xterm')
type FitModule = typeof import('@xterm/addon-fit')
type SearchModule = typeof import('@xterm/addon-search')
type WebLinksModule = typeof import('@xterm/addon-web-links')

let xtermLoader: Promise<{
  Terminal: TerminalModule['Terminal']
  FitAddon: FitModule['FitAddon']
  SearchAddon: SearchModule['SearchAddon']
  WebLinksAddon: WebLinksModule['WebLinksAddon']
}> | undefined

function loadXterm(): Promise<{
  Terminal: TerminalModule['Terminal']
  FitAddon: FitModule['FitAddon']
  SearchAddon: SearchModule['SearchAddon']
  WebLinksAddon: WebLinksModule['WebLinksAddon']
}> {
  xtermLoader ??= Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/addon-search'),
    import('@xterm/addon-web-links'),
  ]).then(([xterm, fit, search, webLinks]) => ({
    Terminal: xterm.Terminal,
    FitAddon: fit.FitAddon,
    SearchAddon: search.SearchAddon,
    WebLinksAddon: webLinks.WebLinksAddon,
  }))
  return xtermLoader
}

/**
 * Feed shell output to xterm, repairing zle's wrapped-line repaint.
 *
 * zsh repaints an edit by rewriting only the columns it believes it owns. On a
 * command long enough to wrap, a deletion shortens the text by a column and
 * the tail must reflow onto the previous row; zle never does that, so the cells
 * the old text occupied stay on screen and the deleted text appears to survive
 * (see wrapRepaint.ts for the measured byte stream). The shell's model is
 * right, only the drawing is wrong, so we let xterm consume the chunk and then
 * repaint the affected rows from the text the chunk itself carried.
 *
 * Chunks that do not look like a wrapped line edit are written untouched, so
 * ordinary output, full-screen applications, and shells other than zsh keep
 * exactly the behaviour they had before.
 */
function writeWithWrapRepair(term: InstanceType<TerminalModule['Terminal']>, data: Uint8Array): void {
  const text = new TextDecoder().decode(data)
  const plan = detectWrapRepaint(text, term.cols)
  if (plan === null) {
    term.write(data)
    return
  }
  // The cursor's current position is the end of the line zsh just repainted.
  // The chunk carries only the typed text, so the prompt is whatever the
  // line's first row already held; the repair walks up past the re-wrap.
  const buffer = term.buffer.active
  const curRow = buffer.cursorY
  const curCol = buffer.cursorX
  term.write(data, () => {
    const after = term.buffer.active
    const repair = buildWrapRepaint(
      readPrompt(term, plan, Math.max(0, curRow - plan.up)),
      plan,
      term.cols,
      term.rows,
      curRow,
      curCol,
      after.cursorY,
      after.cursorX,
    )
    if (repair !== null) term.write(repair)
  })
}

/**
 * The text already sitting in front of the typed line on its first row, i.e.
 * the prompt. Read AFTER the chunk so the row holds the repainted text: the
 * cells to the left of where that text begins are the prompt.
 */
function readPrompt(
  term: InstanceType<TerminalModule['Terminal']>,
  plan: WrapRepaintPlan,
  startRow: number,
): string {
  const cols = term.cols
  const buffer = term.buffer.active
  const line = buffer.getLine(buffer.baseY + startRow)
  if (line === undefined) return ''
  const text = line.translateToString(false, 0, cols)
  // The chunk's text begins at the line's start, so on a single-row line the
  // prompt is whatever sits left of it; on a wrapped line the first row was
  // never touched by the chunk and is prompt + the first part of the text.
  const keep = Math.max(0, text.length - Math.min(plan.text.length, cols))
  return text.slice(0, keep).replace(/\s+$/, '')
}
/** How long the bell badge stays on a terminal's sidebar entry — VS Code's
 *  terminal.integrated.bellDuration default is 1000 ms. */
const BELL_DURATION_MS = 1000

/** Search decoration colours shared by every find pass (VS Code maps its
 *  theme findMatch/findMatchHighlight onto the same addon fields — see
 *  xtermTerminal.ts _updateFindColors; these are the Dark Modern values). */
const findDeco: import('@xterm/addon-search').ISearchDecorationOptions = {
  matchOverviewRuler: '#623315',
  matchBackground: '#623315',
  matchBorder: '#c07a4d',
  activeMatchBackground: '#9e6a03',
  activeMatchBorder: '#ffbe5f',
  activeMatchColorOverviewRuler: '#9e6a03',
}

/** Soft two-tone terminal bell (VS Code plays a system sound; a short
 *  WebAudio oscillator is the plugin-page equivalent — no asset needed and
 *  it works even when the browser blocks autoplay until the first gesture). */
function playBellSound(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctx === undefined) return
    const ctx = bellAudioCtx ??= new Ctx()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 830
    gain.gain.setValueAtTime(0.06, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.25)
  } catch { /* audio unavailable: the flash badge still shows */ }
}
let bellAudioCtx: AudioContext | undefined

/** Is the terminal's viewport showing the bottom-most line? xterm exposes the
 *  buffer viewport via buffer.active.viewportY vs baseY + rows - 1; both are
 *  in absolute line coordinates. A one-line tolerance matches VS Code's own
 *  "is at bottom" check. */
function isViewportAtBottom(term: InstanceType<TerminalModule['Terminal']>): boolean {
  const b = term.buffer.active
  return b.viewportY >= b.baseY + term.rows - 1 - 1
}

/** Base64 → bytes; tolerates padding issues by re-encoding via Buffer-style
 * chunking. atob throws on strings with interior padding (=) that arise when
 * replay frames are accidentally joined; this variant strips and re-pads. */
function decodeBase64(data: string): Uint8Array {
  if (data.length === 0) return new Uint8Array(0)
  try {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    const clean = data.replace(/[^A-Za-z0-9+/]/g, '')
    const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4)
    try {
      const binary = atob(padded)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes
    } catch {
      return new Uint8Array(0)
    }
  }
}

/** Context menu with edge-flip: measures its rendered height and flips
 *  upward when it would overflow the viewport bottom (past the status bar). */
function ContextMenu({ cx, cy, items, onClose }: {
  cx: number
  cy: number
  items: { label: string; icon?: React.ReactNode; onClick: () => void }[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: cx, top: cy })
  useLayoutEffect(() => {
    const el = menuRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    let left = cx
    let top = cy
    // Flip up if the menu overflows the viewport bottom (leave 8px margin,
    // and account for the ~22px status bar at the very bottom).
    if (top + rect.height > window.innerHeight - 30) {
      top = Math.max(8, window.innerHeight - 30 - rect.height)
    }
    // Flip left if it overflows the right edge.
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - rect.width)
    }
    setPos({ left, top })
  }, [cx, cy])
  return (
    <>
      <div className="ide-terminal-context-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div ref={menuRef} className="ide-terminal-context-menu" style={{ left: pos.left, top: pos.top }} data-testid="ide-terminal-context-menu">
        {items.map((item, i) => (
          <button key={i} className="ide-terminal-context-item" onClick={item.onClick}>
            {item.icon !== undefined && <span className="ide-terminal-context-icon">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}

interface TermEntry {
  term: import('@xterm/xterm').Terminal
  fit: import('@xterm/addon-fit').FitAddon
  /** Search addon (VS Code "Find in terminal"); one per terminal so each
   *  pane's decorations stay scoped to its own viewport. */
  search?: import('@xterm/addon-search').SearchAddon
  dispose: () => void
}

/** Imperative surface exposed to the parent (command palette, context menus):
 *  every terminal-window action VS Code exposes as a command. */
export interface TerminalPanelHandle {
  /** Open the find bar bound to the active terminal. */
  openFind: () => void
  /** Spawn a terminal (optionally with a shell profile path). */
  newTerminal: (command?: string) => void
  /** Split the active terminal. */
  splitTerminal: () => void
  /** Kill the active terminal. */
  killActive: () => void
  /** Clear the active terminal's screen. */
  clearActive: () => void
  /** Focus the previous (-1) / next (+1) terminal. */
  stepTerminal: (delta: number) => void
  /** Scroll the active terminal to the newest output. */
  scrollToBottom: () => void
  /** Send Ctrl+C (SIGINT) to the active terminal. */
  interrupt: () => void
}

export const TerminalPanel = forwardRef(TerminalPanelImpl)

function TerminalPanelImpl({
  sessionId,
  ideTools,
  terminalIds,
  activeIdx,
  onTerminalOpened,
  onActiveChange,
  onTerminalClosed,
  onClose,
  tabVisible,
  actionsHost = null,
  t,
}: TerminalPanelProps, ref: React.ForwardedRef<TerminalPanelHandle>) {
  // One xterm instance per terminal ID, surviving re-renders.
  const termsRef = useRef<Map<string, TermEntry>>(new Map())
  // DOM host divs per terminal ID (created via ref callbacks).
  const hostsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  // The panel root element; read during a sizer drag to get the current
  // pixel height as the drag baseline (so dragging starts from the real
  // rendered size, not a possibly-stale state value).
  const panelRef = useRef<HTMLDivElement>(null)
  // Per-terminal status, keyed by terminal ID.
  const [statuses, setStatuses] = useState<Record<string, TermStatus>>({})
  // Per-terminal error message.
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Per-terminal custom name (user rename), keyed by terminal ID.
  const [names, setNames] = useState<Record<string, string>>({})
  // Per-terminal color index (cycled from TERMINAL_COLORS).
  const [colorIdx, setColorIdx] = useState<Record<string, number>>({})
  // Sidebar collapsed (VS Code can hide the terminal list).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // Which terminal is being renamed (inline edit).
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // Context menu position ("x y" string) for the right-click menu.
  const [contextMenu, setContextMenu] = useState<string | null>(null)
  // Split view: the terminal IDs currently shown side-by-side (VS Code style,
  // supports N panes). Empty = single view. Members that no longer exist are
  // filtered out on read; the split collapses when fewer than 2 remain.
  const [splitIds, setSplitIds] = useState<string[]>([])
  // Per-terminal shell exit code (when the terminal reached the exited state).
  const [exitCodes, setExitCodes] = useState<Record<string, number | null>>({})
  const [panelState, setPanelState] = useState<PanelState>('normal')
  // User-dragged pixel height for the 'normal' state. null means "use the CSS
  // default" (PANEL_HEIGHT_DEFAULT) so the panel still sizes correctly before
  // the user ever drags. Maximize/minimize ignore this and apply fixed sizes.
  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  // True only while a sizer drag is in progress; disables the height CSS
  // transition so the panel tracks the cursor 1:1 instead of animating.
  const [resizing, setResizing] = useState(false)
  // Track which terminal IDs we've already attached an xterm to, so the effect
  // below only runs once per terminal.
  const attachedRef = useRef<Set<string>>(new Set())
  // Per-terminal echo-back gate: false during replay (suppresses onData
  // → terminalWrite so DCS/CSI responses in the log never reach the shell
  // as commands), flipped true by the host's replay-marker frame.
  const echoBackRefs = useRef<Map<string, { enabled: boolean }>>(new Map())
  // Track active abort controllers per terminal for stream cancellation.
  const abortsRef = useRef<Map<string, AbortController>>(new Map())
  // Per-terminal input dispatcher (base64 chunk → ordered host write). Lets
  // the clipboard-paste handler below inject text without racing the
  // keystroke writes that term.onData issues.
  const termsDispatchRef = useRef<Map<string, (text: string) => void>>(new Map())
  // Latch for the "panel opened with no terminals" auto-spawn. The effect that
  // owns it re-runs on every parent re-render (onTerminalOpened is a fresh
  // closure each render) while terminalOpen is an async round-trip, so without
  // this latch one panel open spawned a shell per re-render.
  const ensuredInitialRef = useRef(false)
  // ── VS Code terminal-window parity state ────────────────────────────────
  // Find bar: which terminal it targets (the one focused when opened), the
  // query, and match navigation state. Target is pinned so switching panes
  // while typing does not redirect the search.
  const [findFor, setFindFor] = useState<string | null>(null)
  const [findQuery, setFindQuery] = useState('')
  const [findCaseSensitive, setFindCaseSensitive] = useState(false)
  const [findWholeWord, setFindWholeWord] = useState(false)
  const [findRegex, setFindRegex] = useState(false)
  const [findResult, setFindResult] = useState<{ index: number; count: number } | null>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  // Terminal IDs whose bell fired and has not been acknowledged by focus
  // (VS Code shows a bell decoration on the tab).
  const [bellIds, setBellIds] = useState<string[]>([])
  // Terminal IDs whose viewport is scrolled off the bottom while new output
  // keeps arriving (drives the "scroll to bottom" badge, VS Code parity).
  const offBottomRef = useRef<Set<string>>(new Set())
  const [offBottomTick, setOffBottomTick] = useState(0)
  // Shell profile picker (VS Code "+ ▾" dropdown): which shells the new
  // terminal button spawns. Detected once from the host platform.
  const [shellMenuOpen, setShellMenuOpen] = useState(false)
  const [shells, setShells] = useState<{ id: string; label: string }[]>([])
  // Stable bridges so xterm's attachCustomKeyEventHandler (created once per
  // terminal, inside the attach effect) can call actions defined later with
  // fresh closures.
  const newTerminalRef = useRef<(() => void) | null>(null)
  const openFindRef = useRef<(() => void) | null>(null)
  const stepTerminalRef = useRef<((delta: number) => void) | null>(null)
  // Latest activeId mirror readable from non-React callbacks (scroll tracker).
  const activeIdRef = useRef<string | undefined>(undefined)
  // Find-bar-open mirror readable from the attach-time onSelectionChange
  // handler (VS Code suspends copyOnSelection while the find widget is up).
  const findOpenRef = useRef(false)
  useEffect(() => { activeIdRef.current = terminalIds[activeIdx] }, [terminalIds, activeIdx])

  const activeId = terminalIds[activeIdx]
  const isMinimized = panelState === 'minimized'
  const isMaximized = panelState === 'maximized'
  // Split view derivation (N panes). The split group is PERSISTENT: focusing
  // a terminal outside it does NOT destroy the group (VS Code keeps it).
  // Only members that still exist count; fewer than 2 live members collapses
  // back to single view.
  const liveSplit = splitIds.filter((id) => terminalIds.includes(id))
  const isSplit = liveSplit.length >= 2
  // Visible terminals: the live group, plus the focused terminal when focus
  // sits outside the group (otherwise switching to a non-split terminal would
  // render nothing). DOM order follows terminalIds so panes do not jump.
  const visibleIds = isSplit
    ? terminalIds.filter((id) => liveSplit.includes(id) || id === activeId)
    : [activeId]
  // Stable key for the effect dependency: the array identity changes every
  // render, which would re-run the refit effect needlessly.
  const liveSplitKey = visibleIds.join('|')

  // --- Ensure exactly ONE terminal exists when the panel opens with an empty list ---
  useEffect(() => {
    if (ensuredInitialRef.current) return
    if (terminalIds.length > 0) { ensuredInitialRef.current = true; return }
    ensuredInitialRef.current = true
    void ideTools.terminalOpen(sessionId, { cols: 80, rows: 24 }).then((res) => {
      if (res.ok) onTerminalOpened(res.value.terminalId)
    }).catch(() => {
      // Leave the latch set: a failed spawn should not turn into a retry storm.
    })
  }, [sessionId, ideTools, terminalIds.length, onTerminalOpened])

  // --- Attach xterm + stream output for each terminal ID (once per ID) ---
  useEffect(() => {
    for (const id of terminalIds) {
      if (attachedRef.current.has(id)) continue
      attachedRef.current.add(id)
      // Assign a color to this terminal (cycled palette, VS Code style).
      setColorIdx((prev) => prev[id] !== undefined ? prev : { ...prev, [id]: Object.keys(prev).length % TERMINAL_COLORS.length })
      const ctrl = new AbortController()
      abortsRef.current.set(id, ctrl)
      let cancelled = false

      const attach = async () => {
        // Wait for the host div to appear (ref callback sets it).
        let host = hostsRef.current.get(id)
        for (let i = 0; i < 50 && host === undefined; i++) {
          await new Promise((r) => setTimeout(r, 20))
          if (cancelled) return
          host = hostsRef.current.get(id)
        }
        if (cancelled || host === undefined) return
        const { Terminal, FitAddon, SearchAddon, WebLinksAddon } = await loadXterm()
        if (cancelled) return

        // User settings (Settings → Terminal) used to be dead: the panel
        // hardcoded all three values and terminalXtermOptions() was never
        // called, so changing font size / cursor blink / scrollback did
        // nothing at all. Read them at construction and follow live updates
        // in the subscription effect below.
        const xtermSettings = terminalXtermOptions(ideSettings.getSnapshot())
        const term = new Terminal({
          // xterm.js measures character width via canvas at init time; CSS
          // var() references are NOT resolved by canvas, so the measured cell
          // width is wrong and characters render with excessive spacing.
          // Use a concrete font stack matching iTerm2 / VSCode defaults:
          // Menlo (macOS), Consolas (Windows), monospace (Linux fallback).
          fontFamily: 'Menlo, Consolas, \'DejaVu Sans Mono\', monospace',
          fontSize: xtermSettings.fontSize,
          lineHeight: xtermSettings.lineHeight,
          fontWeight: xtermSettings.fontWeight,
          letterSpacing: 0,
          cursorBlink: xtermSettings.cursorBlink,
          cursorStyle: 'bar',
          scrollback: xtermSettings.scrollback,
          allowProposedApi: true,
          macOptionIsMeta: true,
          // Full ANSI 16-color palette matching VSCode Dark+ so zsh prompts,
          // ls colors, syntax highlighters, and truecolor output render exactly
          // as they do in VSCode's integrated terminal.
          theme: xtermThemeFor(ideSettings.getSnapshot().theme),
        })
        const fit = new FitAddon()
        term.loadAddon(fit)

        // ── VS Code "Find in terminal" (addon-search) ─────────────────────
        // One addon per terminal; the panel-level find bar (opened with
        // Ctrl/Cmd+F while a terminal is focused, or the toolbar button)
        // drives the ACTIVE terminal's addon.
        const search = new SearchAddon()
        term.loadAddon(search)

        // ── VS Code clickable links (addon-web-links) ──────────────────────
        // URLs open in a new tab (noopener: the page must not be able to
        // reach back into the IDE via window.opener).
        term.loadAddon(new WebLinksAddon((event, uri) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return
          window.open(uri, '_blank', 'noopener,noreferrer')
        }))

        term.open(host)
        try { fit.fit() } catch { /* zero-size host during layout */ }

        termsRef.current.set(id, {
          term,
          fit,
          search,
          dispose: () => { search.dispose(); term.dispose(); termsRef.current.delete(id) },
        })

        // ── VS Code terminal bell: tab decoration + optional sound ────────
        // VS Code adds a bell status to the terminal tab for
        // terminal.integrated.bellDuration ms (default 1000) and then it
        // clears itself; the sound rides accessibility.signals.terminalBell.
        // We mirror both: a 🔔 badge on the sidebar entry that auto-clears
        // after BELL_DURATION_MS (focus clears it earlier), plus the optional
        // WebAudio beep when terminal.bellSound is on.
        term.onBell(() => {
          setBellIds((prev) => prev.includes(id) ? prev : [...prev, id])
          window.setTimeout(() => {
            setBellIds((prev) => prev.filter((x) => x !== id))
          }, BELL_DURATION_MS)
          if (ideSettings.getSnapshot()['terminal.bellSound']) playBellSound()
        })

        // ── VS Code terminal.copyOnSelection ───────────────────────────────
        // Copy the selection to the clipboard the moment it exists. The
        // clipboard write only succeeds in a secure context with a recent
        // user gesture; a silent catch keeps drag-selections non-fatal.
        term.onSelectionChange(() => {
          if (!ideSettings.getSnapshot()['terminal.copyOnSelection']) return
          if (findOpenRef.current) return
          const sel = term.getSelection()
          if (sel.length === 0) return
          void navigator.clipboard.writeText(sel).catch(() => undefined)
        })

        // ── Scroll-to-bottom affordance (VS Code "jump to latest output") ──
        // Track per-terminal viewport position: onWriteParsed fires after
        // output lands; a viewport that is NOT at the bottom (user scrolled
        // up) arms the badge, and onScroll re-checks the position.
        const trackScroll = (): void => {
          const wasOff = offBottomRef.current.has(id)
          const offBottom = !isViewportAtBottom(term)
          if (offBottom) offBottomRef.current.add(id)
          else offBottomRef.current.delete(id)
          if (wasOff !== offBottom) setOffBottomTick((v) => v + 1)
        }
        term.onScroll(() => { if (activeIdRef.current === id) trackScroll() })
        term.onWriteParsed(() => { if (activeIdRef.current === id) trackScroll() })

        // ── Terminal-scoped keybindings (VS Code parity) ────────────────────
        // attachCustomKeyEventHandler runs BEFORE xterm's own key handling;
        // returning false swallows the event so it never reaches the PTY.
        //   Ctrl/Cmd+Shift+`  → new terminal       (VS Code workbench.action.terminal.new)
        //   Ctrl/Cmd+F         → find in terminal   (workbench.action.terminal.focusFindWidget)
        //   Alt+←/→            → prev/next terminal (workbench.action.terminal.focusPrevious/Next)
        //   Cmd+Up/Down        → scroll (mac default is passed through to the
        //                        shell, so we only intercept the scroll pair)
        term.attachCustomKeyEventHandler((ev) => {
          if (ev.type !== 'keydown') return true
          const isMac = navigator.platform.toLowerCase().includes('mac')
          const mod = isMac ? ev.metaKey : ev.ctrlKey
          if (mod && ev.shiftKey && ev.key === '`') {
            ev.preventDefault()
            newTerminalRef.current?.()
            return false
          }
          if (mod && !ev.shiftKey && (ev.key === 'f' || ev.key === 'F')) {
            ev.preventDefault()
            openFindRef.current?.()
            return false
          }
          if (ev.altKey && !mod && ev.key === 'ArrowLeft') {
            ev.preventDefault()
            stepTerminalRef.current?.(-1)
            return false
          }
          if (ev.altKey && !mod && ev.key === 'ArrowRight') {
            ev.preventDefault()
            stepTerminalRef.current?.(1)
            return false
          }
          return true
        })

        // Sync the PTY size now, then keep it in step with the viewport via
        // ResizeObserver (panel resize, maximize/restore, sidebar drag, window
        // resize). Debounced so a drag fires one resize, not one per frame.
        fitAndResize(id)
        let resizeTimer: ReturnType<typeof setTimeout> | undefined
        const ro = new ResizeObserver(() => {
          if (resizeTimer !== undefined) clearTimeout(resizeTimer)
          resizeTimer = setTimeout(() => { resizeTimer = undefined; fitAndResize(id) }, 100)
        })
        ro.observe(host)
        const origDispose = termsRef.current.get(id)!.dispose
        termsRef.current.get(id)!.dispose = () => { ro.disconnect(); if (resizeTimer !== undefined) clearTimeout(resizeTimer); origDispose() }

        // Keystrokes → host write. Suppressed during replay: the replay log
        // carries the shell's own DCS/CSI query responses (cursor position,
        // color capabilities, etc.), and xterm echoes those back through
        // onData on re-attach — without this guard they reach the shell as
        // commands ("zsh: command not found: 2RR0"). The replay marker
        // frame from the host re-enables echo-back for live input.
        const echoBack = { enabled: false }
        echoBackRefs.current.set(id, echoBack)
        // Per-terminal queue + in-flight flag so input reaches the PTY in the
        // exact order it was typed.
        const pendingWrites: string[] = []
        let writing = false
        const flushWrites = async (): Promise<void> => {
          if (writing) return
          writing = true
          try {
            while (pendingWrites.length > 0 && !cancelled) {
              const text = pendingWrites.shift()!
              await ideTools.terminalWrite(sessionId, id, text).catch(() => undefined)
            }
          } finally {
            writing = false
          }
        }
        termsDispatchRef.current.set(id, (text: string) => {
          if (text.length === 0) return
          pendingWrites.push(btoa(unescape(encodeURIComponent(text))))
          void flushWrites()
        })
        term.onData((data) => {
          if (!echoBack.enabled) return
          termsDispatchRef.current.get(id)?.(data)
        })

        setStatuses((prev) => ({ ...prev, [id]: 'ready' }))

        // Stream output (replay + live) until exit or unmount.
        const stream = ideTools.terminalOutput(sessionId, id, ctrl.signal)
        void (async () => {
          try {
            for await (const frame of stream) {
              if (cancelled) break
              if (frame.replay === true) {
                // Replay done: re-enable echo-back for live input.
                echoBackRefs.current.get(id)!.enabled = true
                continue
              }
              if (frame.data.length > 0) {
                const entry = termsRef.current.get(id)
                if (entry !== undefined) writeWithWrapRepair(entry.term, decodeBase64(frame.data))
              }
              if (frame.exit) {
                setStatuses((prev) => ({ ...prev, [id]: 'exited' }))
                setExitCodes((prev) => ({ ...prev, [id]: frame.exitCode ?? null }))
                break
              }
            }
          } catch (streamError) {
            if (!cancelled) {
              setStatuses((prev) => ({ ...prev, [id]: 'failed' }))
              setErrors((prev) => ({ ...prev, [id]: streamError instanceof Error ? streamError.message : String(streamError) }))
            }
          }
        })()
      }
      void attach()
    }

    // Cleanup terminals that are no longer in terminalIds.
    const currentIds = new Set(terminalIds)
    for (const [id, entry] of termsRef.current) {
      if (!currentIds.has(id)) {
        entry.dispose()
        termsRef.current.delete(id)
        hostsRef.current.delete(id)
        attachedRef.current.delete(id)
        echoBackRefs.current.delete(id)
        termsDispatchRef.current.delete(id)
        abortsRef.current.get(id)?.abort()
        abortsRef.current.delete(id)
      }
    }

    return () => {
      // On unmount, abort all streams but keep xterm instances alive (they get
      // disposed by the per-ID cleanup above when terminalIds shrinks, or by
      // the full panel close effect). This avoids re-creating terminals on
      // every React re-render.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, ideTools, terminalIds.join(',')])

  /** Fit the xterm viewport to its host div and forward the new cols/rows
   *  to the host PTY so the shell's COLUMNS/LINES match what the user sees.
   *  Without the PTY resize the shell keeps rendering at the creation size
   *  (80×24) and prompt wrapping, line editing, and full-screen apps break. */
  const fitAndResize = useCallback((id: string) => {
    const entry = termsRef.current.get(id)
    if (entry === undefined) return
    try { entry.fit.fit() } catch { /* zero-size host during layout */ }
    const { cols, rows } = entry.term
    void ideTools.terminalResize(sessionId, id, cols, rows).catch(() => undefined)
  }, [sessionId, ideTools])

  // Live-apply terminal settings (Settings → Terminal) to every open xterm.
  // Font size changes the cell box, so each terminal is refitted afterwards —
  // without the refit the PTY keeps the old cols/rows and wrapping breaks.
  // The colour theme is re-applied too: switching IDE → Light used to leave
  // the terminal on the dark palette, so the shell's default-foreground text
  // (and any repainted line) became near-white on a white panel — read by
  // users as grey/faded leftovers of the previous command.
  useEffect(() => {
    return ideSettings.subscribe(() => {
      const snapshot = ideSettings.getSnapshot()
      const opts = terminalXtermOptions(snapshot)
      const theme = xtermThemeFor(snapshot.theme)
      for (const [id, entry] of termsRef.current) {
        entry.term.options.fontSize = opts.fontSize
        entry.term.options.cursorBlink = opts.cursorBlink
        entry.term.options.scrollback = opts.scrollback
        entry.term.options.lineHeight = opts.lineHeight
        entry.term.options.fontWeight = opts.fontWeight
        entry.term.options.theme = theme
        fitAndResize(id)
      }
    })
  }, [fitAndResize])

  // --- Ref callback: register each terminal's host div ---
  const setHostRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el !== null) hostsRef.current.set(id, el)
  }, [])

  // --- P1-7: copy/paste the terminal's selection (VS Code behaviour) ---
  // xterm keeps its selection on the Terminal instance, not in the DOM, so the
  // browser's own menu cannot copy it. This listener runs in the CAPTURE phase
  // on the panel so it wins before xterm's internal handler.
  useEffect(() => {
    const panel = panelRef.current
    if (panel === null) return
    const onContextMenu = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      if (target === null) return
      // Only inside a terminal viewport, never on the toolbar or tab strip.
      const hostEntry = Array.from(hostsRef.current.entries()).find(([, host]) => host.contains(target))
      if (hostEntry === undefined) return
      const [id] = hostEntry
      const term = termsRef.current.get(id)?.term
      if (term === undefined) return
      e.preventDefault()
      e.stopPropagation()
      const selection = term.getSelection()
      showContextMenu(e.clientX, e.clientY, [
        {
          id: 'copy',
          label: t('terminal.copy'),
          icon: Icons.copy,
          disabled: selection === '',
          onClick: () => { void copyTextOrNotify(selection, copyFailureNotifier(t, t('terminal.copy'))) },
        },
        {
          id: 'paste',
          label: t('terminal.paste'),
          icon: Icons.paste,
          onClick: () => {
            void navigator.clipboard.readText()
              .then((text) => { if (text !== '') term.paste(text) })
              .catch(() => { /* clipboard read denied: nothing to paste */ })
          },
        },
        { id: 'selectAll', label: t('terminal.selectAll'), icon: Icons.eye, onClick: () => { term.selectAll() } },
        { id: 'clear', label: t('terminal.clear'), icon: Icons.trash, onClick: () => { term.clear() } },
      ])
    }
    panel.addEventListener('contextmenu', onContextMenu, true)
    return () => { panel.removeEventListener('contextmenu', onContextMenu, true) }
  }, [t])

  // --- Clipboard paste (VS Code-style, replaces xterm's clipboard addon) ---
  // xterm's default Ctrl/Cmd+V path forwards the helper textarea's input event
  // and then resets the textarea. On macOS the Cmd+V keydown is NOT prevented
  // by the browser, so the native "paste" runs too: a second input event
  // arrives — often after the textarea was reset — and further input events
  // pile up while the pasteboard is being read. The accumulated text is
  // forwarded to the PTY again on the next keystroke, so characters the user
  // already deleted (the leading letter left on screen, or a character in the
  // middle of the line) get re-inserted into the shell's line editor. The
  // shell is then out of sync with what xterm shows, and the only visible
  // repair redraw paints those re-inserted characters with the wrong SGR
  // attributes — the grey leftovers.
  //
  // Handling the paste ourselves keeps ONE source of truth: the text goes
  // through the same ordered dispatcher as keystrokes, with bracketed-paste
  // wrapping when the shell asked for it (DECSET 2004, zsh does by default).
  useEffect(() => {
    const el = panelRef.current
    if (el === null) return
    const wrapped = (term: import('@xterm/xterm').Terminal, text: string): string => {
      const cr = text.replace(/\r?\n/g, '\r')
      // DECSET 2004 has no public getter; read the private mode state the
      // same way xterm's own paste path does, falling back to plain text.
      const modes = (term as unknown as { modes?: { bracketedPasteMode?: boolean } }).modes
      return modes?.bracketedPasteMode === true && !term.options.ignoreBracketedPasteMode
        ? '\x1b[200~' + cr + '\x1b[201~'
        : cr
    }
    // Capture phase on the panel runs BEFORE xterm's own bubble-phase paste
    // listener and stopImmediatePropagation() keeps that listener from firing,
    // so the clipboard text can never be delivered a second time through
    // xterm's helper-textarea path.
    const onPaste = (ev: ClipboardEvent): void => {
      const target = ev.target as HTMLElement | null
      const xtermEl = target?.closest('.xterm') as HTMLElement | null
      if (xtermEl === null) return
      const id = Array.from(hostsRef.current.entries()).find(([, host]) => host.contains(xtermEl))?.[0]
      if (id === undefined) return
      const entry = termsRef.current.get(id)
      const dispatch = termsDispatchRef.current.get(id)
      if (entry === undefined || dispatch === undefined) return
      const echoBack = echoBackRefs.current.get(id)
      // During replay echo-back is suppressed, exactly like keystrokes.
      if (echoBack !== undefined && !echoBack.enabled) return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      entry.term.focus()
      const text = ev.clipboardData?.getData('text/plain') ?? ''
      if (text.length === 0) return
      dispatch(wrapped(entry.term, text))
    }
    el.addEventListener('paste', onPaste, true)
    return () => { el.removeEventListener('paste', onPaste, true) }
  }, [])

  // --- Click-outside closes the shell-profile dropdown (VS Code parity) ---
  useEffect(() => {
    if (!shellMenuOpen) return
    const onDown = (ev: MouseEvent): void => {
      const target = ev.target as HTMLElement | null
      if (target === null) return
      if (target.closest('.ide-terminal-newmenu') === null) setShellMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => { window.removeEventListener('mousedown', onDown, true) }
  }, [shellMenuOpen])

  // Re-fit the active terminal when it becomes visible (tab switch unhides
  // its host) or when the panel height changes (maximize/restore/minimize,
  // sizer drag). A hidden host fits to zero; this runs after the display flip
  // so the fit sees the real size. Slight delay to let the browser lay out.
  //
  // Restoring from minimized is the critical case for the cursor bug: while
  // minimized the hosts container is hidden via CSS (NOT unmounted), so the
  // xterm canvas keeps its DOM binding but stops rendering. Once visible again
  // we refit AND call term.focus() — focus re-arms the blinking cursor and
  // re-paints the viewport, which is what was missing (cursor stayed hidden).
  //
  // Coming back from the chat tab is the OTHER critical case: DSH hides this
  // body rather than unmounting it, so nothing in the dependencies above
  // changes and the effect never re-ran — the terminal kept rendering but had
  // no keyboard focus, so typing went nowhere until the user clicked it.
  // `tabVisible` (from useTabInfo().tab.visible) flips false→true exactly on
  // that transition and is therefore part of the dependency list.
  useEffect(() => {
    if (activeId === undefined || isMinimized) return
    if (tabVisible === false) return
    const t = setTimeout(() => {
      fitAndResize(activeId)
      // In split view, refit the other member too.
      // Refit every visible pane (live group + focused-outside terminal), so
      // panes that just became visible get their real width before painting.
      if (isSplit) { for (const id of visibleIds) if (id !== activeId) fitAndResize(id) }
      // Refocus so the cursor (and keyboard input) come back after restore.
      try { termsRef.current.get(activeId)?.term.focus() } catch { /* disposed */ }
    }, 50)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, isMinimized, isMaximized, panelState, panelHeight, fitAndResize, isSplit, liveSplitKey, tabVisible])

  // --- Actions ---
  /** Spawn a new terminal, optionally with a specific shell (VS Code profile).
   *  "command" is the host-side shell path; the host runs it as a
   *  login+interactive shell exactly like the default one. */
  const newTerminal = useCallback((command?: string) => {
    void ideTools.terminalOpen(sessionId, { cols: 80, rows: 24, ...(command !== undefined ? { command } : {}) }).then((res) => {
      if (res.ok) {
        onTerminalOpened(res.value.terminalId)
        onActiveChange(terminalIds.length) // switch to the new one
      }
    })
  }, [sessionId, ideTools, onTerminalOpened, onActiveChange, terminalIds.length])

  const splitTerminal = useCallback(() => {
    if (activeId === undefined) return
    // Open a new terminal and ADD it to the split group. Splitting repeatedly
    // grows the group (VS Code supports N panes); the new terminal takes focus.
    void ideTools.terminalOpen(sessionId, { cols: 80, rows: 24 }).then((res) => {
      if (!res.ok) return
      onTerminalOpened(res.value.terminalId)
      setSplitIds((prev) => {
        // Ensure the terminal being split FROM is a group member too, otherwise
        // the focus lands on a terminal outside the group and isSplit goes
        // false (the freshly created pane would never render).
        const base = prev.includes(activeId) ? prev : [...prev, activeId]
        return base.includes(res.value.terminalId) ? base : [...base, res.value.terminalId]
      })
      onActiveChange(terminalIds.length)
    })
  }, [activeId, sessionId, ideTools, onTerminalOpened, onActiveChange, terminalIds.length])

  // ── VS Code "Find in terminal" ──────────────────────────────────────────
  /** Result counters are pushed by the addon's change event (fired on every
   *  find pass); the ref pair lets runFind read the freshest numbers without
   *  being a dependency of the callback. */
  const findResultIndexRef = useRef(-1)
  const findResultCountRef = useRef(0)

  /** Run one search pass on the find target with the current options.
   *  dir 1 = findNext, -1 = findPrevious; incremental expands the current
   *  match while typing (the addon's semantics, VS Code parity). */
  const runFind = useCallback((dir: 1 | -1, incremental = false) => {
    const target = findFor
    if (target === null) return
    const entry = termsRef.current.get(target)
    if (entry === undefined || entry.search === undefined) return
    const options: import('@xterm/addon-search').ISearchOptions = {
      caseSensitive: findCaseSensitive,
      wholeWord: findWholeWord,
      regex: findRegex,
    }
    if (dir === 1 && incremental) options.incremental = true
    // Decorations drive BOTH the highlight and the onDidChangeResults counter:
    // without them the addon never reports a result count, which the find
    // bar's n/total readout needs (VS Code parity).
    options.decorations = findDeco
    const okFlag = dir === 1 ? entry.search.findNext(findQuery, options) : entry.search.findPrevious(findQuery, options)
    setFindResult(okFlag ? { index: findResultIndexRef.current, count: findResultCountRef.current } : null)
  }, [findFor, findQuery, findCaseSensitive, findWholeWord, findRegex])

  /** runFind with an EXPLICIT query value: called right after setFindQuery so
   *  the pass uses the text the user just typed, not the previous render's
   *  state (the callback's closure still sees the old findQuery). */
  const runFindWith = useCallback((query: string, dir: 1 | -1, incremental = false) => {
    const target = findFor
    if (target === null) return
    const entry = termsRef.current.get(target)
    if (entry === undefined || entry.search === undefined) return
    if (query.length === 0) { entry.search.clearDecorations(); setFindResult(null); return }
    const okFlag = dir === 1
      ? entry.search.findNext(query, { caseSensitive: findCaseSensitive, wholeWord: findWholeWord, regex: findRegex, decorations: findDeco, ...(incremental ? { incremental: true } : {}) })
      : entry.search.findPrevious(query, { caseSensitive: findCaseSensitive, wholeWord: findWholeWord, regex: findRegex, decorations: findDeco })
    setFindResult(okFlag ? { index: findResultIndexRef.current, count: findResultCountRef.current } : null)
  }, [findFor, findCaseSensitive, findWholeWord, findRegex])

  /** Open the find bar bound to the ACTIVE terminal (VS Code focusFindWidget).
   *  Prefills with the selection when it is a single line, like the editor. */
  const openFind = useCallback(() => {
    if (activeId === undefined) return
    const entry = termsRef.current.get(activeId)
    const sel = entry?.term.getSelection()
    setFindFor(activeId)
    if (sel !== undefined && sel.length > 0 && sel.indexOf(String.fromCharCode(10)) === -1) setFindQuery(sel)
    setShellMenuOpen(false)
    findOpenRef.current = true
    if (entry !== undefined && entry.search !== undefined && sel !== undefined && sel.length > 0) {
      entry.search.findNext(sel, { caseSensitive: findCaseSensitive, wholeWord: findWholeWord, regex: findRegex, incremental: true, decorations: findDeco })
    }
    requestAnimationFrame(() => findInputRef.current?.focus())
  }, [activeId, findCaseSensitive, findWholeWord, findRegex])

  /** Close the bar, drop the decorations, and hand focus back to the pane. */
  const closeFind = useCallback(() => {
    const target = findFor
    setFindFor(null)
    findOpenRef.current = false
    if (target !== null) {
      termsRef.current.get(target)?.search?.clearDecorations()
      termsRef.current.get(target)?.term.focus()
    }
  }, [findFor])

  // --- Escape closes the shell dropdown / find bar (global fallback) ---
  // xterm swallows Escape inside its textarea, so the find bar's own
  // onKeyDown cannot fire while focus sits in the terminal. This capture
  // listener on the panel covers that case.
  useEffect(() => {
    if (findFor === null && !shellMenuOpen) return
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' || ev.altKey || ev.metaKey || ev.ctrlKey) return
      if (shellMenuOpen) { setShellMenuOpen(false); return }
      closeFind()
      ev.preventDefault()
      ev.stopPropagation()
    }
    panelRef.current?.addEventListener('keydown', onKey, true)
    return () => { panelRef.current?.removeEventListener('keydown', onKey, true) }
  }, [findFor, shellMenuOpen, closeFind])

  /** Toggle one of the three find modifiers (re-run happens in the effect). */
  const toggleFindOption = useCallback((which: 'caseSensitive' | 'wholeWord' | 'regex') => {
    if (which === 'caseSensitive') setFindCaseSensitive((v) => !v)
    if (which === 'wholeWord') setFindWholeWord((v) => !v)
    if (which === 'regex') setFindRegex((v) => !v)
  }, [])

  // Re-run the search whenever an option flips (VS Code re-searches on toggle).
  useEffect(() => {
    if (findFor === null) return
    const t2 = setTimeout(() => {
      runFind(1, true)
      requestAnimationFrame(() => findInputRef.current?.focus())
    }, 0)
    return () => clearTimeout(t2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findCaseSensitive, findWholeWord, findRegex])

  // Subscribe to the find target's search-result events for the counter.
  useEffect(() => {
    if (findFor === null) return
    const entry = termsRef.current.get(findFor)
    if (entry === undefined || entry.search === undefined) return
    const sub = entry.search.onDidChangeResults((e) => {
      findResultIndexRef.current = e.resultIndex
      findResultCountRef.current = e.resultCount
      setFindResult({ index: e.resultIndex, count: e.resultCount })
    })
    return () => sub.dispose()
  }, [findFor])

  /** VS Code "Focus Next/Previous Terminal" (Alt+Left / Alt+Right). */
  const stepTerminal = useCallback((delta: number) => {
    if (terminalIds.length === 0) return
    const next = (activeIdx + delta + terminalIds.length) % terminalIds.length
    onActiveChange(next)
  }, [terminalIds, activeIdx, onActiveChange])

  /** Jump the active terminal's viewport to the newest output (VS Code
   *  "Terminal: Scroll to Bottom" / the off-bottom badge button). */
  const scrollActiveToBottom = useCallback(() => {
    if (activeId === undefined) return
    const entry = termsRef.current.get(activeId)
    if (entry === undefined) return
    entry.term.scrollToBottom()
    offBottomRef.current.delete(activeId)
    setOffBottomTick((v) => v + 1)
  }, [activeId])

  // Keep the keybinding bridges pointing at the latest closures.
  useEffect(() => {
    newTerminalRef.current = () => { newTerminal() }
    openFindRef.current = openFind
    stepTerminalRef.current = stepTerminal
  }, [newTerminal, openFind, stepTerminal])

  // ── Shell profiles (VS Code "+ ▾" dropdown) ─────────────────────────────
  // The host terminalOpen accepts an explicit shell path. The candidate list
  // mirrors VS Code's default profiles; unavailable ones are hidden by the
  // host (spawn error → notification), so we only list the common set and let
  // the host's SHELL default stay first. Detected once per panel mount.
  useEffect(() => {
    const candidates: { id: string; label: string }[] = [
      { id: '/bin/zsh', label: 'zsh' },
      { id: '/bin/bash', label: 'bash' },
      { id: '/bin/sh', label: 'sh' },
      { id: '/usr/local/bin/fish', label: 'fish' },
      { id: '/opt/homebrew/bin/fish', label: 'fish' },
      { id: '/usr/bin/python3', label: 'python3' },
    ]
    // Deduplicate by LABEL (fish appears twice for its two install prefixes)
    // keeping the first-seen entry, so the menu shows one row per shell.
    const seen = new Set<string>()
    const list = candidates.filter((c) => (seen.has(c.label) ? false : (seen.add(c.label), true)))
    setShells(list)
  }, [])

  const killActive = useCallback(() => {
    if (activeId === undefined) return
    if (splitIds.includes(activeId)) setSplitIds((prev) => prev.filter((id) => id !== activeId))
    // Drop the tab first, kill in the background: gating the UI on the kill
    // round-trip made the click look dead until a second click.
    const idx = terminalIds.indexOf(activeId)
    if (idx >= 0) onTerminalClosed(idx)
    void ideTools.terminalTerminate(sessionId, activeId).catch(() => undefined)
  }, [sessionId, ideTools, activeId, terminalIds, onTerminalClosed, splitIds])

  const signalInterrupt = useCallback(() => {
    if (activeId === undefined) return
    void ideTools.terminalSignal(sessionId, activeId, 'SIGINT')
  }, [sessionId, ideTools, activeId])

  const toggleMinimize = useCallback(() => {
    setPanelState((prev) => (prev === 'minimized' ? 'normal' : 'minimized'))
  }, [])

  const toggleMaximize = useCallback(() => {
    setPanelState((prev) => (prev === 'maximized' ? 'normal' : 'maximized'))
  }, [])

  const closeTab = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const id = terminalIds[idx]
    if (id === undefined) return
    // Clear split if the closed terminal was a split member.
    if (splitIds.includes(id)) setSplitIds((prev) => prev.filter((x) => x !== id))
    // Same as killActive: remove immediately so one click closes the tab (and
    // the whole panel when it was the last terminal).
    onTerminalClosed(idx)
    void ideTools.terminalTerminate(sessionId, id).catch(() => undefined)
  }, [sessionId, ideTools, terminalIds, onTerminalClosed, splitIds])

  /** VS Code's 终端 restart: replace one dead terminal with a fresh shell.
   *  The new tab is appended and the dead one removed afterwards — appending
   *  FIRST keeps the panel alive even when the dead tab was the last one. */
  const restartTerminal = useCallback((deadId: string) => {
    const idx = terminalIds.indexOf(deadId)
    if (idx < 0) return
    void ideTools.terminalTerminate(sessionId, deadId).catch(() => undefined)
    // Detach the dead xterm now so its slot is free for the new stream.
    termsRef.current.get(deadId)?.dispose()
    attachedRef.current.delete(deadId)
    termsDispatchRef.current.delete(deadId)
    abortsRef.current.get(deadId)?.abort()
    abortsRef.current.delete(deadId)
    setStatuses((prev) => ({ ...prev, [deadId]: 'connecting' }))
    void ideTools.terminalOpen(sessionId, { cols: 80, rows: 24 }).then((res) => {
      if (!res.ok) return
      onTerminalOpened(res.value.terminalId)
      onTerminalClosed(idx)
    })
  }, [sessionId, ideTools, terminalIds, onTerminalOpened, onTerminalClosed])

  /** Clear the active terminal's screen (VS Code "Clear" command). */
  const clearActive = useCallback(() => {
    if (activeId === undefined) return
    const entry = termsRef.current.get(activeId)
    if (entry === undefined) return
    entry.term.clear()
  }, [activeId])

  // Imperative surface for the parent (command palette / editor context menu):
  // the same actions the toolbar buttons trigger. A ref-based bridge means the
  // parent's commands stay in sync with the panel's live closures even though
  // the panel remounts on bottom-tab switches.
  useImperativeHandle(ref, () => ({
    openFind,
    newTerminal,
    splitTerminal,
    killActive,
    clearActive,
    stepTerminal,
    scrollToBottom: scrollActiveToBottom,
    interrupt: signalInterrupt,
  }), [openFind, newTerminal, splitTerminal, killActive, clearActive, stepTerminal, scrollActiveToBottom, signalInterrupt])

  /** Start inline rename for a terminal (VS Code double-click to rename). */
  const startRename = useCallback((id: string) => {
    const current = names[id] ?? t('terminal.tabTitle', { index: (terminalIds.indexOf(id) + 1) || 1 })
    setRenamingId(id)
    setRenameValue(current)
  }, [names, terminalIds, t])

  /** Commit the rename (Enter or blur). */
  const commitRename = useCallback(() => {
    if (renamingId === null) return
    const trimmed = renameValue.trim()
    if (trimmed.length > 0) {
      setNames((prev) => ({ ...prev, [renamingId]: trimmed }))
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue])

  // --- Draggable height sizer (top edge of the panel) ---
  // The sizer lives above the toolbar. mousedown captures the starting cursor
  // Y and the panel's current pixel height; while dragging, global mousemove
  // updates panelHeight (drag up = taller) clamped to [MIN, MAX]; mouseup ends
  // the drag. Resizing is a React state flag that (a) disables the height
  // transition so the panel tracks the cursor 1:1, and (b) attaches the
  // window-level listeners — attaching them only while dragging avoids a
  // permanent global mousemove handler.
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const onSizerMouseDown = useCallback((e: React.MouseEvent) => {
    // Only react to the primary button; ignore right-click/middle-click so
    // they keep their browser defaults (context menu, autoscroll).
    if (e.button !== 0) return
    e.preventDefault()
    // The sizer controls the OUTER container (ide-bottompanel) height, not
    // this inner panel: in a flex column the inner panel is flex:1 so its
    // inline height is ignored by the flex algorithm. The outer container is
    // flex:none and honors inline height, and the inner panel fills it.
    const outerEl = panelRef.current?.parentElement
    const startHeight = outerEl ? outerEl.getBoundingClientRect().height : PANEL_HEIGHT_DEFAULT
    dragStartRef.current = { startY: e.clientY, startHeight }
    setResizing(true)
  }, [])

  useEffect(() => {
    if (!resizing) return
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current
      if (start === null) return
      // Drag the top edge up → panel grows. deltaY > 0 means cursor moved up.
      const deltaY = start.startY - e.clientY
      const next = Math.min(PANEL_HEIGHT_MAX, Math.max(PANEL_HEIGHT_MIN, start.startHeight + deltaY))
      setPanelHeight(next)
    }
    const onUp = () => {
      dragStartRef.current = null
      setResizing(false)
    }
    // capture so we keep getting moves even if the cursor leaves the sizer
    // (e.g. dragged over the editor area).
    window.addEventListener('mousemove', onMove, { capture: true })
    window.addEventListener('mouseup', onUp, { capture: true })
    return () => {
      window.removeEventListener('mousemove', onMove, { capture: true })
      window.removeEventListener('mouseup', onUp, { capture: true })
    }
  }, [resizing])

  const activeStatus = activeId !== undefined ? (statuses[activeId] ?? 'connecting') : 'connecting'
  const activeError = activeId !== undefined ? errors[activeId] : undefined

  // The sizer controls the OUTER container (ide-bottompanel). The inner
  // panel is flex:1 so it fills whatever height the outer container has;
  // setting inline height on the inner panel is ignored by the flex
  // algorithm. We sync the outer container's height via an effect so the
  // xterm viewport (and its ResizeObserver) react to real DOM changes.
  // Maximize/minimize keep their own CSS rules (data-state selectors) and
  // override the outer height by clearing it here.
  const normalHeightStyle = undefined
  useEffect(() => {
    const outer = panelRef.current?.parentElement
    if (outer === undefined || outer === null) return
    if (panelState === 'normal' && panelHeight !== null) {
      outer.style.height = panelHeight + 'px'
    } else if (panelState === 'minimized' || panelState === 'maximized') {
      // Let the CSS :has() rules on ide-bottompanel take over.
      outer.style.height = ''
    } else {
      // normal + null panelHeight → CSS default (no inline height).
      outer.style.height = ''
    }
  }, [panelHeight, panelState])

  return (
    <div
      ref={panelRef}
      className="ide-terminal-panel"
      data-testid="ide-terminal-panel"
      data-state={panelState}
      data-resizing={resizing || undefined}
      style={normalHeightStyle}
    >
      {/* Draggable sizer: the top edge of the panel. Hidden while minimized so
          it can't be grabbed when only the toolbar is showing. Double-click
          resets a user-dragged height back to the CSS default. */}
      {!isMinimized && (
        <div
          className="ide-terminal-resizer"
          title={t('terminal.resize')}
          onMouseDown={onSizerMouseDown}
          onDoubleClick={() => setPanelHeight(null)}
        />
      )}
      {/* The terminal has no toolbar of its own: the action buttons are
          rendered further down and portaled into the host element the parent
          passes via actionsHost — the right end of the bottom panel's tab row
          (same line as the 问题 / 终端 tabs). */}
      {actionsHost !== null && createPortal(
        <div className="ide-terminal-actions" data-testid="ide-terminal-actions">
          {/* VS Code "+ ▾": new terminal with the default shell, dropdown for
              the other profiles (zsh / bash / sh / fish / python3). */}
          <div className="ide-terminal-newmenu" data-open={shellMenuOpen || undefined}>
            <button className="ide-terminal-action" title={t('terminal.new')} data-testid="ide-terminal-new" onClick={() => { newTerminal(); setShellMenuOpen(false) }}>{Icons.plus}</button>
            <button
              className="ide-terminal-action ide-terminal-newmenu-caret"
              title={t('terminal.newWithProfile')}
              data-testid="ide-terminal-new-profile"
              onClick={() => setShellMenuOpen((v) => !v)}
            >{Icons.chevronDown}</button>
            {shellMenuOpen && (
              <div className="ide-terminal-shellmenu" data-testid="ide-terminal-shellmenu" role="menu">
                {shells.map((sh) => (
                  <button
                    key={sh.id}
                    className="ide-terminal-shellmenu-item"
                    role="menuitem"
                    onClick={() => { newTerminal(sh.id); setShellMenuOpen(false) }}
                  >{sh.label}</button>
                ))}
              </div>
            )}
          </div>
          <button className="ide-terminal-action" title={t('terminal.split')} onClick={splitTerminal}>{Icons.splitEditor}</button>
          <button className="ide-terminal-action" title={t('terminal.find')} data-testid="ide-terminal-find-btn" onClick={openFind}>{Icons.search}</button>
          <button className="ide-terminal-action" title={t('terminal.interrupt')} onClick={signalInterrupt}>^C</button>
          <button className="ide-terminal-action" title={t('terminal.clear')} onClick={clearActive}>{Icons.refresh}</button>
          <button className="ide-terminal-action" title={t('terminal.terminate')} onClick={killActive}>{Icons.trash}</button>
          {!isMinimized && (
            <>
              <button className="ide-terminal-action" title={isMaximized ? t('terminal.restore') : t('terminal.maximize')} onClick={toggleMaximize}>
                {isMaximized ? Icons.restore : Icons.maximize}
              </button>
              <button className="ide-terminal-action" title={t('terminal.minimize')} onClick={toggleMinimize}>{Icons.chevronDown}</button>
            </>
          )}
          {isMinimized && (
            <button className="ide-terminal-action" title={t('terminal.expand')} onClick={toggleMinimize}>{Icons.chevronUp}</button>
          )}
          {terminalIds.length > 0 && (
            <button className="ide-terminal-action" title={sidebarCollapsed ? t('terminal.showSidebar') : t('terminal.hideSidebar')} onClick={() => setSidebarCollapsed((v) => !v)}>
              <span style={{ display: 'inline-flex', transform: sidebarCollapsed ? 'none' : 'scaleX(-1)' }}>{Icons.chevronRight}</span>
            </button>
          )}
          <button className="ide-terminal-action" title={t('terminal.close')} onClick={onClose}>{Icons.close}</button>
        </div>,
        actionsHost,
      )}

      {/* The hosts container is ALWAYS mounted: while minimized it is
          hidden via CSS (data-hidden) instead of unmounted, so each xterm
          keeps its canvas bound to a live DOM node. Unmounting it (the old
          `{!isMinimized && ...}` form) detached xterm from the document, and
          on restore the attach effect never re-ran (attachedRef was set), so
          the terminal stayed blank with the cursor hidden. */}
      <div className="ide-terminal-body" data-hidden={isMinimized || undefined}>
        {/* VS Code find-in-terminal bar: floats over the hosts area's top-right
            corner while open. Bound to the terminal that was focused on open;
            Enter/Shift+Enter navigate, Escape closes, the three toggles match
            the editor's find widget (Aa, ab|, .*). */}
        {findFor !== null && (
          <div className="ide-terminal-findbar" data-testid="ide-terminal-findbar">
            <input
              ref={findInputRef}
              className="ide-terminal-findbar-input"
              value={findQuery}
              placeholder={t('terminal.findPlaceholder')}
              onChange={(e) => { const v = e.target.value; setFindQuery(v); setTimeout(() => runFindWith(v, 1, true), 0) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); runFind(e.shiftKey ? -1 : 1) }
                if (e.key === 'Escape') { e.preventDefault(); closeFind() }
                // VS Code find-widget toggle chords: Alt+C / Alt+W / Alt+R
                // (mac adds Cmd): case-sensitive, whole word, regex.
                const isMac = navigator.platform.toLowerCase().includes('mac')
                const altOk = e.altKey && (isMac ? e.metaKey : true)
                if (altOk && e.code === 'KeyC') { e.preventDefault(); toggleFindOption('caseSensitive') }
                if (altOk && e.code === 'KeyW') { e.preventDefault(); toggleFindOption('wholeWord') }
                if (altOk && e.code === 'KeyR') { e.preventDefault(); toggleFindOption('regex') }
              }}
            />
            <button className="ide-terminal-findbar-toggle" data-active={findCaseSensitive || undefined} title={t('terminal.findCaseSensitive')} onClick={() => toggleFindOption('caseSensitive')}>Aa</button>
            <button className="ide-terminal-findbar-toggle" data-active={findWholeWord || undefined} title={t('terminal.findWholeWord')} onClick={() => toggleFindOption('wholeWord')}>ab|</button>
            <button className="ide-terminal-findbar-toggle" data-active={findRegex || undefined} title={t('terminal.findRegex')} onClick={() => toggleFindOption('regex')}>.*</button>
            <span className="ide-terminal-findbar-count" data-testid="ide-terminal-findbar-count">
              {findResult === null || findResult.count === 0 ? t('terminal.findNoResults') : (findResult.index + 1) + '/' + findResult.count}
            </span>
            <button className="ide-terminal-findbar-nav" title={t('terminal.findPrevious')} onClick={() => runFind(-1)}>↑</button>
            <button className="ide-terminal-findbar-nav" title={t('terminal.findNext')} onClick={() => runFind(1)}>↓</button>
            <button className="ide-terminal-findbar-close" title={t('terminal.findClose')} onClick={closeFind}>{Icons.close}</button>
          </div>
        )}
        {/* Scroll-to-bottom badge (VS Code parity): appears when the ACTIVE
            terminal's viewport is off the bottom while output keeps arriving;
            one click jumps to the newest line. */}
        {activeId !== undefined && offBottomRef.current.has(activeId) && (
          <button
            className="ide-terminal-scrollbottom"
            data-testid="ide-terminal-scrollbottom"
            title={t('terminal.scrollToBottom')}
            onClick={scrollActiveToBottom}
          >{Icons.arrowDown}</button>
        )}
        <div className="ide-terminal-hosts" data-split={isSplit || undefined}>
          {terminalIds.map((id) => (
            <div
              key={id}
              ref={setHostRef(id)}
              className="ide-terminal-host"
              style={{ display: visibleIds.includes(id) ? 'block' : 'none' }}
              data-testid="ide-terminal-host"
            />
          ))}
          {activeId !== undefined && activeStatus === 'failed' && activeError !== undefined && (
            <div className="ide-terminal-error" data-testid="ide-terminal-error">
              {t('terminal.failed', { message: activeError })}
            </div>
          )}
          {activeId !== undefined && activeStatus === 'exited' && (
            <div className="ide-terminal-error" data-testid="ide-terminal-exited">
              <span>{t('terminal.exited', { code: exitCodes[activeId] === null || exitCodes[activeId] === undefined ? '—' : String(exitCodes[activeId]) })}</span>
              <button className="ide-dialog-button" onClick={() => restartTerminal(activeId)}>{t('terminal.restart')}</button>
              <button className="ide-dialog-button ide-dialog-button-quiet" onClick={() => { const idx = terminalIds.indexOf(activeId); if (idx >= 0) onTerminalClosed(idx) }}>{t('terminal.closeTab')}</button>
            </div>
          )}
          {activeId === undefined && (
            <div className="ide-terminal-empty">{t('terminal.noTerminals')}</div>
          )}
        </div>

        {/* Right-side vertical terminal list (VS Code style): each entry is a
            clickable row showing the terminal title and status; hovering reveals
            the kill button so switching and closing terminals no longer crowds
            the top toolbar. Double-click renames; right-click opens a context
            menu (new / rename / kill / clear). */}
        {terminalIds.length > 0 && !sidebarCollapsed && (
          <div className="ide-terminal-sidebar" data-testid="ide-terminal-sidebar">
            <div className="ide-terminal-sidebar-header">
              <span className="ide-terminal-sidebar-title">{t('terminal.title')}</span>
              <button className="ide-terminal-sidebar-new" title={t('terminal.new')} onClick={() => { newTerminal() }}>{Icons.plus}</button>
            </div>
            <div className="ide-terminal-sidebar-list">
              {terminalIds.map((id, idx) => {
                const st = statuses[id] ?? 'connecting'
                const exited = st === 'exited' || st === 'failed'
                const color = TERMINAL_COLORS[colorIdx[id] ?? 0]
                const displayName = names[id] ?? t('terminal.tabTitle', { index: idx + 1 })
                const isRenaming = renamingId === id
                const belled = bellIds.includes(id)
                return (
                  <div
                    key={id}
                    className="ide-terminal-sidebar-item"
                    data-active={idx === activeIdx || undefined}
                    data-exited={exited || undefined}
                    onClick={() => { onActiveChange(idx); if (bellIds.includes(id)) setBellIds((prev) => prev.filter((x) => x !== id)) }}
                    onDoubleClick={() => startRename(id)}
                    onContextMenu={(e) => { e.preventDefault(); onActiveChange(idx); setContextMenu(e.clientX + ' ' + e.clientY) }}
                    title={displayName}
                  >
                    <span className="ide-terminal-sidebar-color" data-active={idx === activeIdx || undefined} />
                    {belled ? <span className="ide-terminal-bell" title={t('terminal.bell')}>🔔</span> : null}
                    {isRenaming ? (
                      <input
                        className="ide-terminal-sidebar-rename"
                        value={renameValue}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenamingId(null); setRenameValue('') } }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <span className="ide-terminal-sidebar-label">{displayName}</span>
                    )}
                    {!isRenaming && (
                      <button
                        className="ide-terminal-sidebar-close"
                        title={t('terminal.killTab')}
                        onClick={(ev) => closeTab(idx, ev)}
                      >{Icons.close}</button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right-click context menu (VS Code style). */}
      {contextMenu !== null && activeId !== undefined && (() => {
        const [cx, cy] = contextMenu.split(' ').map(Number)
        const items = [
          { label: t('terminal.new'), icon: Icons.plus, onClick: () => { newTerminal(); setContextMenu(null) } },
          { label: t('terminal.rename'), icon: Icons.edit, onClick: () => { startRename(activeId); setContextMenu(null) } },
          { label: t('terminal.clear'), icon: Icons.refresh, onClick: () => { clearActive(); setContextMenu(null) } },
          { label: t('terminal.interrupt'), icon: undefined, onClick: () => { signalInterrupt(); setContextMenu(null) } },
          { label: t('terminal.killTab'), icon: Icons.trash, onClick: () => { killActive(); setContextMenu(null) } },
        ]
        return (
          <ContextMenu cx={cx} cy={cy} items={items} onClose={() => setContextMenu(null)} />
        )
      })()}
    </div>
  )
}
