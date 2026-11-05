/** Vendored single-file ESM copy of @braintree/sanitize-url@7.1.2 (MIT, © Braintree).
 * Inlined so constants.js and index.js live in one ESM module: the upstream
 * CJS pair trips a rolldown __commonJS ordering bug in this bundle (the
 * index wrapper executes before the constants wrapper is registered).
 * Logic is unchanged. */
const invalidProtocolRegex = /^([^\w]*)(javascript|data|vbscript)/im
const htmlEntitiesRegex = /&#(\w+)(^\w|;)?/g
const htmlCtrlEntityRegex = /&(newline|tab);/gi
const ctrlCharactersRegex = /[\u0000-\u001F\u007F-\u009F\u2000-\u200D\uFEFF]/gim
const urlSchemeRegex = /^.+(:|&colon;)/gim
const whitespaceEscapeCharsRegex = /(\\|%5[cC])((%(6[eE]|72|74))|[nrt])/g
const relativeFirstCharacters = ['.', '/']
const BLANK_URL = 'about:blank'

function isRelativeUrlWithoutProtocol(url) {
  return relativeFirstCharacters.indexOf(url[0]) > -1
}

function decodeHtmlCharacters(str) {
  const removedNullByte = str.replace(ctrlCharactersRegex, '')
  return removedNullByte.replace(htmlEntitiesRegex, (match, dec) => String.fromCharCode(dec))
}

function isValidUrl(url) {
  return URL.canParse(url)
}

function decodeURI(uri) {
  try { return decodeURIComponent(uri) } catch { return uri }
}

export function sanitizeUrl(url) {
  if (!url) return BLANK_URL
  let charsToDecode
  let decodedUrl = decodeURI(url.trim())
  do {
    decodedUrl = decodeHtmlCharacters(decodedUrl)
      .replace(htmlCtrlEntityRegex, '')
      .replace(ctrlCharactersRegex, '')
      .replace(whitespaceEscapeCharsRegex, '')
      .trim()
    decodedUrl = decodeURI(decodedUrl)
    charsToDecode =
      decodedUrl.match(ctrlCharactersRegex) ||
      decodedUrl.match(htmlEntitiesRegex) ||
      decodedUrl.match(htmlCtrlEntityRegex) ||
      decodedUrl.match(whitespaceEscapeCharsRegex)
  } while (charsToDecode && charsToDecode.length > 0)
  const sanitizedUrl = decodedUrl
  if (!sanitizedUrl) return BLANK_URL
  if (isRelativeUrlWithoutProtocol(sanitizedUrl)) return sanitizedUrl
  const trimmedUrl = sanitizedUrl.trimStart()
  const urlSchemeParseResults = trimmedUrl.match(urlSchemeRegex)
  if (!urlSchemeParseResults) return sanitizedUrl
  const urlScheme = urlSchemeParseResults[0].toLowerCase().trim()
  if (invalidProtocolRegex.test(urlScheme)) return BLANK_URL
  const backSanitized = trimmedUrl.replace(/\\/g, '/')
  if (urlScheme === 'mailto:' || urlScheme.includes('://')) return backSanitized
  if (urlScheme === 'http:' || urlScheme === 'https:') {
    if (!isValidUrl(backSanitized)) return BLANK_URL
    const url = new URL(backSanitized)
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()
    return url.toString()
  }
  return backSanitized
}

export { BLANK_URL }
export default { sanitizeUrl, BLANK_URL }
