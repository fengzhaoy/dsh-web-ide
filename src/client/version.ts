/**
 * Plugin version for the About dialog.
 *
 * The value is generated into ./generated/version.ts by
 * scripts/gen-version.mjs (part of `pnpm bundle` / `pnpm watch`), which reads
 * package.json — the single source of truth. This indirection keeps the
 * browser bundle free of the rest of package.json (importing the JSON
 * directly would inline the whole dependency manifest) while the About
 * version can never drift from the published package (it used to: the dialog
 * said 0.1.3 while 0.1.5 was published).
 */
export { PKG_VERSION as IDE_VERSION } from './generated/version.js'
