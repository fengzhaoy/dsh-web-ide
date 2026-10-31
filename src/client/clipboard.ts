/**
 * Clipboard helpers for the IDE.
 *
 * `navigator.clipboard.writeText` returns a promise that REJECTS when the page
 * is not a secure context, when the document is not focused, or when the user
 * (or the browser) denies clipboard permission. Every call site used to write
 * `void navigator.clipboard.writeText(...)`, which turned those rejections into
 * unhandled promise errors: the click looked like it did nothing at all.
 */

/** Copy `text` to the clipboard. Resolves true on success, false when the
 *  clipboard is unavailable or the write was refused. Never rejects. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  return copyTextFallback(text)
}

/** Copy text for a menu/shortcut action. Silent on success (VS Code's own
 *  click-to-copy behaviour), but reports failure through `onFailure` so a
 *  refused clipboard never looks like a dead menu item. */
export async function copyTextOrNotify(text: string, onFailure: () => void): Promise<void> {
  if (await copyText(text)) return
  try {
    onFailure()
  } catch {
    // A broken notifier must not turn a copy failure into an unhandled error.
  }
}

/** Build the failure handler menu actions pass to `copyTextOrNotify`. Uses the
 *  editor's notification centre so the message matches every other toast. */
export function copyFailureNotifier(
  t: (key: string, params?: Record<string, string | number>) => string,
  what: string,
): () => void {
  return () => {
    // Loaded lazily so this module stays importable outside the browser (the
    // pure-logic test suite loads it with node --experimental-strip-types).
    void import('./notifications.js')
      .then(({ notifications }) => { notifications.error(t('status.copyFailed', { what })) })
      .catch(() => { /* Notifications unavailable during teardown. */ })
  }
}

/** Pre-Clipboard-API copy: an off-screen textarea plus execCommand('copy').
 *  Still the only route on insecure origins, where `navigator.clipboard` is
 *  undefined. */
function copyTextFallback(text: string): boolean {
  try {
    if (typeof document === 'undefined') return false
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    const selection = document.getSelection()
    const previous = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    // Restore whatever the user had selected before the copy.
    if (previous !== null && selection !== null) {
      selection.removeAllRanges()
      selection.addRange(previous)
    }
    return ok
  } catch {
    return false
  }
}
