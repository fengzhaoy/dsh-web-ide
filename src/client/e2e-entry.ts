/**
 * E2E-only entry (never shipped): re-exports IdeView, locales and the
 * bundle's own React/ReactDOM so a test page can render the IDE directly
 * without a dual-instance React hazard. The mock ideTools face lives in the
 * driver script.
 */
export { IdeView } from './IdeView.js'
export { NS, zh, en } from './locales.js'
export { default as React } from 'react'
export * as ReactDOM from 'react-dom/client'
export type { IdeViewInjected } from './types.js'
