/**
 * Command Palette (VS Code QuickInput parity): top-centered overlay with an
 * input, fuzzy-filtered command list, full keyboard navigation (↑↓, Enter,
 * Escape) and mouse clicks. Reads the window-parked command registry.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ideCommands, fuzzyScore, type IdeCommand } from './commands.js'
import { displayChord } from './SettingsDialogs.js'
import { ideKeybindings } from './settingsStore.js'

type T = (key: string, params?: Record<string, string | number>) => string

export function CommandPalette({ t, onClose }: { t: T; onClose: () => void }) {
  const commands = useSyncExternalStore(ideCommands.subscribe, ideCommands.getSnapshot)
  const kb = useSyncExternalStore(ideKeybindings.subscribe, ideKeybindings.getSnapshot)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes('mac'), [])

  // VS Code Quick Open modes: '>' commands (also the default), ':' go to line,
  // '@' symbols (unsupported here — falls back to commands with a notice),
  // '#' workspace symbols (same). The prefix is stripped before matching.
  const mode = query.startsWith('>') ? 'commands'
    : query.startsWith(':') ? 'line'
    : query.startsWith('@') ? 'symbols'
    : query.startsWith('#') ? 'workspaceSymbols'
    : 'commands'
  const stripped = mode === 'commands' ? query.replace(/^>/, '') : query.slice(1)
  const filtered = useMemo(() => {
    const q = stripped.trim()
    const list: { cmd: IdeCommand; score: number }[] = []
    for (const cmd of commands) {
      const label = cmd.category + ': ' + cmd.label
      const score = q ? fuzzyScore(q, label) : 0
      if (q && score < 0) continue
      list.push({ cmd, score })
    }
    list.sort((a, b) => b.score - a.score)
    return list.map((x) => x.cmd)
  }, [commands, stripped])

  useEffect(() => { setSelected(0) }, [query])

  // Keep the selected row in view during keyboard navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selected])

  /** Execute the Quick Open mode currently typed. Returns true when handled. */
  const runMode = (): boolean => {
    if (mode === 'line') {
      const n = Number(stripped.trim())
      if (!Number.isFinite(n) || n < 1) return false
      const cmd = ideCommands.byId('ide.gotoLine')
      if (cmd !== undefined) { onClose(); setTimeout(() => { cmd.run() }, 0); return true }
      return false
    }
    if (mode === 'symbols' || mode === 'workspaceSymbols') {
      // Not implemented in this build: run the closest equivalent instead of
      // silently doing nothing.
      const cmd = ideCommands.byId(mode === 'symbols' ? 'ide.find' : 'ide.findInFiles')
      if (cmd !== undefined) { onClose(); setTimeout(() => { cmd.run() }, 0); return true }
      return false
    }
    return false
  }

  const runCommand = (cmd: IdeCommand) => {
    onClose()
    // Defer so the palette's unmount never races the command's own UI.
    setTimeout(() => { if (!cmd.disabled) cmd.run() }, 0)
  }

  const onKeydown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (runMode()) return; const cmd = filtered[selected]; if (cmd) runCommand(cmd) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  const keysFor = (id: string) => kb.find((k) => k.command === id)?.keys ?? ''

  return (
    <div className="ide-palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ide-palette" role="dialog" data-testid="ide-command-palette">
        <input
          className="ide-palette-input"
          data-testid="ide-palette-input"
          autoFocus
          placeholder={t(mode === 'line' ? 'palette.linePlaceholder' : mode === 'commands' ? 'palette.placeholder' : 'palette.unsupportedPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeydown}
        />
        <div className="ide-palette-list" ref={listRef} data-testid="ide-palette-list">
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              className="ide-palette-item"
              data-selected={i === selected || undefined}
              data-disabled={cmd.disabled || undefined}
              data-testid={'ide-palette-item-' + cmd.id}
              onMouseEnter={() => setSelected(i)}
              onClick={() => runCommand(cmd)}
            >
              <span className="ide-palette-category">{cmd.category}</span>
              <span className="ide-palette-label">{cmd.label}</span>
              {keysFor(cmd.id) && <span className="ide-palette-keys">{displayChord(keysFor(cmd.id), isMac)}</span>}
            </div>
          ))}
          {filtered.length === 0 && <div className="ide-palette-empty">{t('palette.noMatches')}</div>}
        </div>
      </div>
    </div>
  )
}
