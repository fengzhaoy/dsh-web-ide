/**
 * Bottom-dock interactive terminal panel with multi-terminal support.
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
import { useCallback, useEffect, useRef, useState } from 'react'
import type { IdeToolsRemote, SessionId } from '../types.js'
import { Icons } from '../icons.js'
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

type TerminalModule = typeof import('@xterm/xterm')
type FitModule = typeof import('@xterm/addon-fit')

let xtermLoader: Promise<{ Terminal: TerminalModule['Terminal']; FitAddon: FitModule['FitAddon'] }> | undefined

function loadXterm(): Promise<{ Terminal: TerminalModule['Terminal']; FitAddon: FitModule['FitAddon'] }> {
  xtermLoader ??= Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([xterm, fit]) => ({
    Terminal: xterm.Terminal,
    FitAddon: fit.FitAddon,
  }))
  return xtermLoader
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

interface TermEntry {
  term: import('@xterm/xterm').Terminal
  fit: import('@xterm/addon-fit').FitAddon
  dispose: () => void
}

export function TerminalPanel({
  sessionId,
  ideTools,
  terminalIds,
  activeIdx,
  onTerminalOpened,
  onActiveChange,
  onTerminalClosed,
  onClose,
  t,
}: TerminalPanelProps) {
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
  // Track active abort controllers per terminal for stream cancellation.
  const abortsRef = useRef<Map<string, AbortController>>(new Map())
  // Latch for the "panel opened with no terminals" auto-spawn. The effect that
  // owns it re-runs on every parent re-render (onTerminalOpened is a fresh
  // closure each render) while terminalOpen is an async round-trip, so without
  // this latch one panel open spawned a shell per re-render.
  const ensuredInitialRef = useRef(false)

  const activeId = terminalIds[activeIdx]
  const isMinimized = panelState === 'minimized'
  const isMaximized = panelState === 'maximized'

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
        const { Terminal, FitAddon } = await loadXterm()
        if (cancelled) return

        const term = new Terminal({
          // xterm.js measures character width via canvas at init time; CSS
          // var() references are NOT resolved by canvas, so the measured cell
          // width is wrong and characters render with excessive spacing.
          // Use a concrete font stack matching iTerm2 / VSCode defaults:
          // Menlo (macOS), Consolas (Windows), monospace (Linux fallback).
          fontFamily: 'Menlo, Consolas, \'DejaVu Sans Mono\', monospace',
          fontSize: 13,
          lineHeight: 1,
          letterSpacing: 0,
          cursorBlink: true,
          cursorStyle: 'bar',
          scrollback: 5000,
          allowProposedApi: true,
          macOptionIsMeta: true,
          // Full ANSI 16-color palette matching VSCode Dark+ so zsh prompts,
          // ls colors, syntax highlighters, and truecolor output render exactly
          // as they do in VSCode's integrated terminal.
          theme: {
            background: '#1f1f1f',
            foreground: '#cccccc',
            cursor: '#aeafad',
            cursorAccent: '#1f1f1f',
            selectionBackground: '#264f78',
            selectionForeground: '#ffffff',
            // Standard ANSI 16-color palette (Dark+ variant).
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#e5e5e5',
          },
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(host)
        try { fit.fit() } catch { /* zero-size host during layout */ }

        termsRef.current.set(id, {
          term,
          fit,
          dispose: () => { term.dispose(); termsRef.current.delete(id) },
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

        // Keystrokes → host write.
        term.onData((data) => {
          void ideTools.terminalWrite(sessionId, id, btoa(unescape(encodeURIComponent(data))))
        })

        setStatuses((prev) => ({ ...prev, [id]: 'ready' }))

        // Stream output (replay + live) until exit or unmount.
        const stream = ideTools.terminalOutput(sessionId, id, ctrl.signal)
        void (async () => {
          try {
            for await (const frame of stream) {
              if (cancelled) break
              if (frame.data.length > 0) termsRef.current.get(id)?.term.write(decodeBase64(frame.data))
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

  // --- Ref callback: register each terminal's host div ---
  const setHostRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el !== null) hostsRef.current.set(id, el)
  }, [])

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
  useEffect(() => {
    if (activeId === undefined || isMinimized) return
    const t = setTimeout(() => {
      fitAndResize(activeId)
      // Refocus so the cursor (and keyboard input) come back after restore.
      try { termsRef.current.get(activeId)?.term.focus() } catch { /* disposed */ }
    }, 50)
    return () => clearTimeout(t)
  }, [activeId, isMinimized, isMaximized, panelState, panelHeight, fitAndResize])

  // --- Actions ---
  const newTerminal = useCallback(() => {
    void ideTools.terminalOpen(sessionId, { cols: 80, rows: 24 }).then((res) => {
      if (res.ok) {
        onTerminalOpened(res.value.terminalId)
        onActiveChange(terminalIds.length) // switch to the new one
      }
    })
  }, [sessionId, ideTools, onTerminalOpened, onActiveChange, terminalIds.length])

  const splitTerminal = useCallback(() => {
    // "Split" in VSCode opens a new terminal in the same group. We approximate
    // by opening a new terminal and switching to it.
    newTerminal()
  }, [newTerminal])

  const killActive = useCallback(() => {
    if (activeId === undefined) return
    // Drop the tab first, kill in the background: gating the UI on the kill
    // round-trip made the click look dead until a second click.
    const idx = terminalIds.indexOf(activeId)
    if (idx >= 0) onTerminalClosed(idx)
    void ideTools.terminalTerminate(sessionId, activeId).catch(() => undefined)
  }, [sessionId, ideTools, activeId, terminalIds, onTerminalClosed])

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
    // Same as killActive: remove immediately so one click closes the tab (and
    // the whole panel when it was the last terminal).
    onTerminalClosed(idx)
    void ideTools.terminalTerminate(sessionId, id).catch(() => undefined)
  }, [sessionId, ideTools, terminalIds, onTerminalClosed])

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
    abortsRef.current.get(deadId)?.abort()
    abortsRef.current.delete(deadId)
    setStatuses((prev) => ({ ...prev, [deadId]: 'connecting' }))
    void ideTools.terminalOpen(sessionId, { cols: 80, rows: 24 }).then((res) => {
      if (!res.ok) return
      onTerminalOpened(res.value.terminalId)
      onTerminalClosed(idx)
    })
  }, [sessionId, ideTools, terminalIds, onTerminalOpened, onTerminalClosed])

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
    const panelEl = panelRef.current
    const startHeight = panelEl ? panelEl.getBoundingClientRect().height : PANEL_HEIGHT_DEFAULT
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

  // Inline height only applies in the 'normal' state: maximize/minimize use
  // their own CSS rules (data-state selectors) and must override this inline
  // value, so we pass undefined there. null panelHeight falls back to the CSS
  // default (no inline style at all).
  const normalHeightStyle = panelState === 'normal' && panelHeight !== null
    ? { height: panelHeight + 'px' }
    : undefined

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
      <div className="ide-terminal-toolbar">
        {/* Tab list: one entry per terminal */}
        <div className="ide-terminal-tabs">
          {terminalIds.map((id, idx) => (
            <div
              key={id}
              className="ide-terminal-tab"
              data-active={idx === activeIdx || undefined}
              data-exited={statuses[id] === 'exited' || statuses[id] === 'failed' || undefined}
              onClick={() => onActiveChange(idx)}
              title={`Terminal ${idx + 1}`}
            >
              <span className="ide-terminal-tab-label">{t('terminal.tabTitle', { index: idx + 1 })}</span>
              <button
                className="ide-terminal-tab-close"
                title={t('terminal.killTab')}
                onClick={(e) => closeTab(idx, e)}
              >{Icons.close}</button>
            </div>
          ))}
        </div>

        {/* Right-side action buttons */}
        <div className="ide-terminal-actions">
          <button className="ide-terminal-action" title={t('terminal.new')} onClick={newTerminal}>{Icons.plus}</button>
          <button className="ide-terminal-action" title={t('terminal.split')} onClick={splitTerminal}>{Icons.splitEditor}</button>
          <button className="ide-terminal-action" title={t('terminal.interrupt')} onClick={signalInterrupt}>^C</button>
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
          <button className="ide-terminal-action" title={t('terminal.close')} onClick={onClose}>{Icons.close}</button>
        </div>
      </div>

      {/* The hosts container is ALWAYS mounted: while minimized it is
          hidden via CSS (data-hidden) instead of unmounted, so each xterm
          keeps its canvas bound to a live DOM node. Unmounting it (the old
          `{!isMinimized && ...}` form) detached xterm from the document, and
          on restore the attach effect never re-ran (attachedRef was set), so
          the terminal stayed blank with the cursor hidden. */}
      <div className="ide-terminal-hosts" data-hidden={isMinimized || undefined}>
          {terminalIds.map((id, idx) => (
            <div
              key={id}
              ref={setHostRef(id)}
              className="ide-terminal-host"
              style={{ display: idx === activeIdx ? 'block' : 'none' }}
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
    </div>
  )
}
