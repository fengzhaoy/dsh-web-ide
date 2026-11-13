/**
 * VS Code's case-preserving replacement (src/vs/base/common/search.ts
 * buildReplaceStringWithCasePreserved): when the user turns on "Preserve Case"
 * the replacement inherits the matched text's casing — "hello"→"world" gives
 * "world", "Hello"→"world" gives "World", "HELLO"→"world" gives "WORLD".
 */

function containsUppercaseCharacter(target: string): boolean {
  return /[A-Z]/.test(target)
}

function validateSpecial(matches: string, pattern: string, ch: string): boolean {
  const inMatch = matches.indexOf(ch) !== -1
  const inPattern = pattern.indexOf(ch) !== -1
  return inMatch && inPattern && matches.split(ch).length === pattern.split(ch).length
}

function forSpecial(matches: string, pattern: string, ch: string): string {
  const splitPattern = pattern.split(ch)
  const splitMatch = matches.split(ch)
  let out = ''
  splitPattern.forEach((part, i) => {
    out += buildReplaceStringWithCasePreserved(splitMatch[i] ?? '', part) + ch
  })
  return out.slice(0, -1)
}

export function buildReplaceStringWithCasePreserved(match: string, pattern: string): string {
  if (match === '') return pattern
  const hyphens = validateSpecial(match, pattern, '-')
  const underscores = validateSpecial(match, pattern, '_')
  if (hyphens && !underscores) return forSpecial(match, pattern, '-')
  if (!hyphens && underscores) return forSpecial(match, pattern, '_')
  if (match.toUpperCase() === match) return pattern.toUpperCase()
  if (match.toLowerCase() === match) return pattern.toLowerCase()
  if (containsUppercaseCharacter(match[0]) && pattern.length > 0) {
    return pattern[0].toUpperCase() + pattern.slice(1)
  }
  if (match[0].toUpperCase() !== match[0] && pattern.length > 0) {
    return pattern[0].toLowerCase() + pattern.slice(1)
  }
  return pattern
}
