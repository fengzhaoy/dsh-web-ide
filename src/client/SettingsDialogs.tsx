/**
 * Settings suite (VS Code Manage menu parity): gear + Manage menu (rendered
 * by the caller via ContextMenu), the Settings dialog, the About dialog, the
 * Keyboard Shortcuts dialog, and the Snippets dialog. All dialogs reuse the
 * .ide-dialog-* chrome from the save-conflict dialog.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Icons } from './icons.js'
import {
  DEFAULT_KEYBINDINGS, DEFAULT_SETTINGS, ideKeybindings, ideSettings, ideSnippets,
  type IdeSettings, type Keybinding, type SnippetDef,
} from './settingsStore.js'
import { fuzzyScore } from './commands.js'

type T = (key: string, params?: Record<string, string | number>) => string

/* ────────────────────────── Settings dialog ────────────────────────── */

interface SettingsDialogProps {
  t: T
  onClose: () => void
  /** Switch the DSH host UI locale (ctx.locale.setLocale); optional. */
  onSetUiLocale?: (locale: 'zh' | 'en') => void
  /** Current host UI locale (to mark the selected row). */
  uiLocale?: string
}

const LANGUAGES = ['plaintext', 'typescript', 'javascript', 'json', 'css', 'scss', 'html', 'markdown', 'xml', 'yaml', 'python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin', 'shell', 'sql', 'ini', 'dockerfile', 'makefile'] as const

export function SettingsDialog({ t, onClose, onSetUiLocale, uiLocale }: SettingsDialogProps) {
  const settings = useSyncExternalStore(ideSettings.subscribe, ideSettings.getSnapshot)
  const [search, setSearch] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = useCallback(<K extends keyof IdeSettings>(key: K, value: IdeSettings[K]) => {
    ideSettings.update({ [key]: value } as Partial<IdeSettings>)
  }, [])

  const exportSettings = useCallback(() => {
    const blob = new Blob([ideSettings.export()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'dsh-ide-settings.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const importSettings = useCallback((file: File) => {
    void file.text().then((text) => {
      try {
        ideSettings.replace(JSON.parse(text))
        setImportError(null)
      } catch {
        setImportError(t('settings.importFailed'))
      }
    })
  }, [t])

  const q = search.trim().toLowerCase()
  const rowVisible = useCallback((label: string) => {
    if (!q) return true
    return fuzzyScore(q, label) >= 0
  }, [q])
  /** A section shows when its title OR any of its row labels match. */
  const sectionVisible = useCallback((title: string, labels: string[]) => {
    if (!q) return true
    return fuzzyScore(q, title) >= 0 || labels.some((l) => fuzzyScore(q, l) >= 0)
  }, [q])

  return (
    <div className="ide-dialog-backdrop ide-dialog-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ide-dialog ide-settings-dialog" role="dialog" data-testid="ide-settings-dialog">
        <div className="ide-settings-header">
          <div className="ide-settings-title">{t('settings.title')}</div>
          <input
            className="ide-settings-search"
            placeholder={t('settings.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="ide-settings-search"
            autoFocus
          />
          <button className="ide-dialog-button ide-dialog-button-quiet" title={t('settings.close')} onClick={onClose}>{Icons.close}</button>
        </div>
        <div className="ide-settings-body">
          <SettingsSection title={t('settings.section.theme')} visible={sectionVisible(t('settings.section.theme'), [t('settings.theme'), t('settings.uiLocale')])}>
            <SettingsRow label={t('settings.theme')} visible={rowVisible(t('settings.theme'))}>
              <select className="ide-settings-select" value={settings.theme} onChange={(e) => set('theme', e.target.value as IdeSettings['theme'])} data-testid="ide-settings-theme">
                <option value="dark-modern">{t('settings.theme.dark')}</option>
                <option value="light-modern">{t('settings.theme.light')}</option>
              </select>
            </SettingsRow>
            <SettingsRow label={t('settings.uiLocale')} visible={rowVisible(t('settings.uiLocale'))}>
              <select
                className="ide-settings-select"
                value={uiLocale === 'en' ? 'en' : 'zh'}
                onChange={(e) => { if (onSetUiLocale) onSetUiLocale(e.target.value === 'en' ? 'en' : 'zh') }}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title={t('settings.section.editor')} visible={sectionVisible(t('settings.section.editor'), [t('settings.editor.fontSize'), t('settings.editor.lineHeight'), t('settings.editor.minimap'), t('settings.editor.wordWrap'), t('settings.editor.renderWhitespace'), t('settings.editor.lineNumbers'), t('settings.editor.cursorBlinking'), t('settings.editor.smoothScrolling')])}>
            <NumberRow label={t('settings.editor.fontSize')} value={settings['editor.fontSize']} min={6} max={40} testid="ide-settings-fontsize"
              visible={rowVisible(t('settings.editor.fontSize'))} onChange={(v) => set('editor.fontSize', v)} />
            <NumberRow label={t('settings.editor.lineHeight')} value={settings['editor.lineHeight']} min={0} max={80} testid="ide-settings-lineheight"
              visible={rowVisible(t('settings.editor.lineHeight'))} onChange={(v) => set('editor.lineHeight', v)} />
            <ToggleRow label={t('settings.editor.minimap')} value={settings['editor.minimap']} testid="ide-settings-minimap"
              visible={rowVisible(t('settings.editor.minimap'))} onChange={(v) => set('editor.minimap', v)} />
            <SettingsRow label={t('settings.editor.wordWrap')} visible={rowVisible(t('settings.editor.wordWrap'))}>
              <select className="ide-settings-select" value={settings['editor.wordWrap']} onChange={(e) => set('editor.wordWrap', e.target.value as 'on' | 'off')} data-testid="ide-settings-wordwrap">
                <option value="off">{t('settings.off')}</option>
                <option value="on">{t('settings.on')}</option>
              </select>
            </SettingsRow>
            <SettingsRow label={t('settings.editor.renderWhitespace')} visible={rowVisible(t('settings.editor.renderWhitespace'))}>
              <select className="ide-settings-select" value={settings['editor.renderWhitespace']} onChange={(e) => set('editor.renderWhitespace', e.target.value as IdeSettings['editor.renderWhitespace'])}>
                <option value="none">{t('settings.whitespace.none')}</option>
                <option value="boundary">{t('settings.whitespace.boundary')}</option>
                <option value="selection">{t('settings.whitespace.selection')}</option>
                <option value="all">{t('settings.whitespace.all')}</option>
              </select>
            </SettingsRow>
            <ToggleRow label={t('settings.editor.lineNumbers')} value={settings['editor.lineNumbers']} testid="ide-settings-linenumbers"
              visible={rowVisible(t('settings.editor.lineNumbers'))} onChange={(v) => set('editor.lineNumbers', v)} />
            <SettingsRow label={t('settings.editor.cursorBlinking')} visible={rowVisible(t('settings.editor.cursorBlinking'))}>
              <select className="ide-settings-select" value={settings['editor.cursorBlinking']} onChange={(e) => set('editor.cursorBlinking', e.target.value as IdeSettings['editor.cursorBlinking'])}>
                <option value="blink">{t('settings.blink.blink')}</option>
                <option value="smooth">{t('settings.blink.smooth')}</option>
                <option value="phase">{t('settings.blink.phase')}</option>
                <option value="expand">{t('settings.blink.expand')}</option>
                <option value="solid">{t('settings.blink.solid')}</option>
              </select>
            </SettingsRow>
            <ToggleRow label={t('settings.editor.smoothScrolling')} value={settings['editor.smoothScrolling']} testid="ide-settings-smoothscroll"
              visible={rowVisible(t('settings.editor.smoothScrolling'))} onChange={(v) => set('editor.smoothScrolling', v)} />
          </SettingsSection>

          <SettingsSection title={t('settings.section.terminal')} visible={sectionVisible(t('settings.section.terminal'), [t('settings.terminal.fontSize'), t('settings.terminal.cursorBlink'), t('settings.terminal.scrollback')])}>
            <NumberRow label={t('settings.terminal.fontSize')} value={settings['terminal.fontSize']} min={6} max={40} testid="ide-settings-termfontsize"
              visible={rowVisible(t('settings.terminal.fontSize'))} onChange={(v) => set('terminal.fontSize', v)} />
            <ToggleRow label={t('settings.terminal.cursorBlink')} value={settings['terminal.cursorBlink']} testid="ide-settings-termblink"
              visible={rowVisible(t('settings.terminal.cursorBlink'))} onChange={(v) => set('terminal.cursorBlink', v)} />
            <NumberRow label={t('settings.terminal.scrollback')} value={settings['terminal.scrollback']} min={100} max={100000} testid="ide-settings-scrollback"
              visible={rowVisible(t('settings.terminal.scrollback'))} onChange={(v) => set('terminal.scrollback', v)} />
          </SettingsSection>

          <SettingsSection title={t('settings.section.profiles')} visible={sectionVisible(t('settings.section.profiles'), [t('settings.profiles')])}>
            <SettingsRow label={t('settings.profiles')} visible={rowVisible(t('settings.profiles'))}>
              <div className="ide-settings-actions">
                <button className="ide-dialog-button" onClick={exportSettings} data-testid="ide-settings-export">{t('settings.export')}</button>
                <button className="ide-dialog-button" onClick={() => fileRef.current?.click()} data-testid="ide-settings-import">{t('settings.import')}</button>
                <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) importSettings(f); e.target.value = '' }} />
              </div>
            </SettingsRow>
            {importError && <div className="ide-settings-error">{importError}</div>}
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}

function SettingsSection({ title, visible, children }: { title: string; visible: boolean; children: React.ReactNode }) {
  if (!visible) return null
  return (
    <div className="ide-settings-section">
      <div className="ide-settings-section-title">{title}</div>
      {children}
    </div>
  )
}

function SettingsRow({ label, visible, children }: { label: string; visible: boolean; children: React.ReactNode }) {
  if (!visible) return null
  return (
    <div className="ide-settings-row">
      <span className="ide-settings-row-label">{label}</span>
      {children}
    </div>
  )
}

function ToggleRow({ label, value, visible, testid, onChange }: { label: string; value: boolean; visible: boolean; testid: string; onChange: (v: boolean) => void }) {
  return (
    <SettingsRow label={label} visible={visible}>
      <label className="ide-settings-toggle">
        <input type="checkbox" data-testid={testid} checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </label>
    </SettingsRow>
  )
}

function NumberRow({ label, value, min, max, visible, testid, onChange }: { label: string; value: number; min: number; max: number; visible: boolean; testid: string; onChange: (v: number) => void }) {
  return (
    <SettingsRow label={label} visible={visible}>
      <input className="ide-settings-number" type="number" data-testid={testid} min={min} max={max} value={value}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v) }} />
    </SettingsRow>
  )
}

/* ────────────────────────── About dialog ────────────────────────── */

export function AboutDialog({ t, version, monacoVersion, branch, onClose }: {
  t: T
  version: string
  monacoVersion: string
  branch: string | undefined
  onClose: () => void
}) {
  return (
    <div className="ide-dialog-backdrop ide-dialog-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ide-dialog" role="dialog" data-testid="ide-about-dialog">
        <div className="ide-dialog-title">{t('about.title')}</div>
        <div className="ide-about-body">
          <div className="ide-about-logo">{t('view.ide')}</div>
          <div className="ide-about-name">dsh-web-ide</div>
          <div className="ide-about-version">{t('about.version', { version })}</div>
          <dl className="ide-about-rows">
            <div><dt>Monaco</dt><dd>{monacoVersion}</dd></div>
            <div><dt>{t('about.branch')}</dt><dd>{branch || '—'}</dd></div>
            <div><dt>{t('about.runtime')}</dt><dd>DSH sidebar view</dd></div>
          </dl>
        </div>
        <div className="ide-dialog-actions">
          <button className="ide-dialog-button" onClick={onClose} data-testid="ide-about-close">{t('settings.close')}</button>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────── Keyboard shortcuts dialog ────────────────────── */

export function KeybindingsDialog({ t, onClose }: { t: T; onClose: () => void }) {
  const kb = useSyncExternalStore(ideKeybindings.subscribe, ideKeybindings.getSnapshot)
  const [recording, setRecording] = useState<string | null>(null)
  const [recordingChord, setRecordingChord] = useState<string[]>([])
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes('mac'), [])

  useEffect(() => {
    if (!recording) return
    const onKeydown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRecording(null); setRecordingChord([]); return }
      const part = chordPart(e, isMac)
      if (!part) return
      const chord = [...recordingChord, part]
      // A part that carries its own modifier (Mod+Alt+S) or a lone printable
      // key completes the binding immediately; only bare modifier prefixes
      // (the Mod+K of a two-part chord) wait for the next key.
      const isPrefix = /^(?:Mod|Ctrl|Meta|Alt|Shift)(?:\+(?:Mod|Ctrl|Meta|Alt|Shift))*$/.test(part)
      if (!isPrefix) {
        ideKeybindings.set(recording, chord.join(' '))
        setRecording(null)
        setRecordingChord([])
      } else {
        setRecordingChord(chord)
      }
    }
    window.addEventListener('keydown', onKeydown, true)
    return () => { window.removeEventListener('keydown', onKeydown, true) }
  }, [recording, recordingChord, isMac])

  const commands = kb.length > 0 ? kb : DEFAULT_KEYBINDINGS

  return (
    <div className="ide-dialog-backdrop ide-dialog-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ide-dialog ide-settings-dialog" role="dialog" data-testid="ide-keybindings-dialog">
        <div className="ide-settings-header">
          <div className="ide-settings-title">{t('keybindings.title')}</div>
          <button className="ide-dialog-button ide-dialog-button-quiet" onClick={onClose}>{Icons.close}</button>
        </div>
        <div className="ide-settings-body">
          <div className="ide-kb-list" data-testid="ide-kb-list">
            {commands.map((entry: Keybinding) => (
              <div key={entry.command} className="ide-kb-row">
                <span className="ide-kb-command">{commandLabel(t, entry.command)}</span>
                <span className="ide-kb-keys">{recording === entry.command
                  ? (recordingChord.length > 0 ? recordingChord.join(' ') + ' …' : t('keybindings.recording'))
                  : (entry.keys ? displayChord(entry.keys, isMac) : '—')}</span>
                <button
                  className="ide-kb-edit"
                  data-active={recording === entry.command || undefined}
                  data-testid={'ide-kb-edit-' + entry.command}
                  onClick={() => { setRecording(recording === entry.command ? null : entry.command); setRecordingChord([]) }}
                >{recording === entry.command ? t('keybindings.stop') : t('keybindings.edit')}</button>
                <button className="ide-kb-edit" title={t('keybindings.reset')} onClick={() => ideKeybindings.reset(entry.command)}>{t('keybindings.resetBtn')}</button>
              </div>
            ))}
          </div>
          <div className="ide-settings-actions" style={{ marginTop: 12 }}>
            <button className="ide-dialog-button ide-dialog-button-quiet" onClick={() => ideKeybindings.resetAll()}>{t('keybindings.resetAll')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function chordPart(e: KeyboardEvent, isMac: boolean): string {
  // Mod = Cmd on mac / Ctrl elsewhere; on mac an explicit Ctrl chord is also
  // accepted (VS Code lets both Cmd and Ctrl combos be bound).
  const mod = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey
  const parts: string[] = []
  if (mod) parts.push('Mod')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (['Shift', 'Control', 'Meta', 'Alt', 'Dead'].includes(e.key)) return ''
  let key = e.key
  if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

export function displayChord(chord: string, isMac: boolean): string {
  return chord.split(' ').map((part) => part.split('+').map((k) => {
    if (k === 'Mod') return isMac ? '⌘' : 'Ctrl'
    if (k === 'Shift') return isMac ? '⇧' : 'Shift'
    if (k === 'Alt') return isMac ? '⌥' : 'Alt'
    return k
  }).join(isMac ? '' : '+')).join(' ')
}

function commandLabel(t: T, command: string): string {
  const key = 'command.' + command.replace(/^ide\./, '')
  const label = t(key)
  return label === key ? command : label
}

/* ────────────────────── Snippets dialog ────────────────────── */

export function SnippetsDialog({ t, onClose }: { t: T; onClose: () => void }) {
  const snapshots = useSyncExternalStore(ideSnippets.subscribe, ideSnippets.getSnapshot)
  const [language, setLanguage] = useState<string>('typescript')
  const [json, setJson] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    const map = snapshots[language] ?? {}
    setJson(JSON.stringify(map, null, 2))
    setError(null)
    setStatus(null)
  }, [language, snapshots])

  const save = useCallback(() => {
    try {
      const parsed = json.trim() === '' ? {} : JSON.parse(json)
      if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      ideSnippets.setLanguage(language, parsed as Record<string, SnippetDef>)
      setError(null)
      setStatus(t('snippets.saved'))
    } catch {
      setError(t('snippets.invalidJson'))
      setStatus(null)
    }
  }, [json, language, t])

  return (
    <div className="ide-dialog-backdrop ide-dialog-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ide-dialog ide-settings-dialog" role="dialog" data-testid="ide-snippets-dialog">
        <div className="ide-settings-header">
          <div className="ide-settings-title">{t('snippets.title')}</div>
          <select className="ide-settings-select" value={language} onChange={(e) => setLanguage(e.target.value)} data-testid="ide-snippets-language">
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button className="ide-dialog-button ide-dialog-button-quiet" onClick={onClose}>{Icons.close}</button>
        </div>
        <div className="ide-settings-body">
          <div className="ide-snippets-hint">{t('snippets.hint')}</div>
          <textarea
            className="ide-snippets-editor"
            data-testid="ide-snippets-editor"
            spellCheck={false}
            value={json}
            onChange={(e) => { setJson(e.target.value); setStatus(null) }}
            placeholder={'{\n  "log": { "prefix": "log", "body": ["console.log($1)"], "description": "..." }\n}'}
          />
          {error && <div className="ide-settings-error" data-testid="ide-snippets-error">{error}</div>}
          {status && <div className="ide-snippets-status">{status}</div>}
          <div className="ide-dialog-actions">
            <button className="ide-dialog-button" onClick={save} data-testid="ide-snippets-save">{t('snippets.save')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
