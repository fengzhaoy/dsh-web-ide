/**
 * Toolbar icon payloads for mermaid diagram chrome (mermaidDiagram.ts).
 *
 * The chrome is plain DOM (built imperatively inside the preview host so it
 * survives dangerouslySetInnerHTML updates), so it cannot mount React nodes.
 * Instead of pulling react-dom/server into the client bundle (the DSH module
 * table only seeds react, react/jsx-runtime, react-dom and react-dom/client),
 * the icons are hand-inlined SVG markup using the exact same official
 * @vscode/codicons path data the React shell renders (icons.tsx entries
 * zoomOut / zoomIn / screenNormal / copy / download), wrapped in a
 * .ide-md-mermaid-btn-icon sizing class.
 */
export interface IconSet {
  readonly zoomIn: string
  readonly zoomOut: string
  readonly reset: string
  readonly copy: string
  readonly download: string
}

/** Inline a 16×16 codicon path set as toolbar button markup. */
function iconSvg(paths: readonly string[]): string {
  const body = paths.map((d) => '<path d="' + d + '"/>').join('')
  return '<svg class="ide-md-mermaid-btn-icon" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + body + '</svg>'
}

// Path data below is copied verbatim from the generated src/client/icons.tsx
// (official @vscode/codicons, MIT). Keep both files in sync via gen-icons.mjs.
const ZOOM_IN = [
  'M12.027 6.149a5.52 5.52 0 0 1-1.27 3.908l4.26 4.26-.7.71-4.26-4.27a5.52 5.52 0 1 1 1.97-4.608zm-5.45 4.888a4.51 4.51 0 0 0 3.18-1.32l-.04.02a4.51 4.51 0 0 0 1.36-3.2 4.5 4.5 0 1 0-4.5 4.5zm2.44-4v-1h-2v-2h-1v2h-2v1h2v2h1v-2h2z',
]
const ZOOM_OUT = [
  'M12.027 6.149a5.52 5.52 0 0 1-1.27 3.908l4.26 4.26-.7.71-4.26-4.27a5.52 5.52 0 1 1 1.97-4.608zm-5.45 4.888a4.51 4.51 0 0 0 3.18-1.32l-.04.02a4.51 4.51 0 0 0 1.36-3.2 4.5 4.5 0 1 0-4.5 4.5zm-2.54-4.98h5v1h-5v-1z',
]
const SCREEN_NORMAL = [
  'M3.5 4H1V3h2V1h1v2.5l-.5.5zM13 3V1h-1v2.5l.5.5H15V3h-2zm-1 9.5V15h1v-2h2v-1h-2.5l-.5.5zM1 12v1h2v2h1v-2.5l-.5-.5H1zm11-1.5l-.5.5h-7l-.5-.5v-5l.5-.5h7l.5.5v5zM10 7H6v2h4V7z',
]
const COPY = [
  'M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z',
  'M3 1L2 2v10l1 1V2h6.414l-1-1H3z',
]
const DOWNLOAD = [
  'M13.5 13.5H2.5C2.22386 13.5 2 13.7239 2 14V14.5C2 14.7761 2.22386 15 2.5 15H13.5C13.7761 15 14 14.7761 14 14.5V14C14 13.7239 13.7761 13.5 13.5 13.5ZM8.35355 12.3536C8.15829 12.5488 7.84171 12.5488 7.64645 12.3536L3.14645 7.85355C2.95118 7.65829 2.95118 7.34171 3.14645 7.14645C3.34171 6.95118 3.65829 6.95118 3.85355 7.14645L7.5 10.7929V1.5C7.5 1.22386 7.72386 1 8 1C8.27614 1 8.5 1.22386 8.5 1.5V10.7929L12.1464 7.14645C12.3417 6.95118 12.6583 6.95118 12.8536 7.14645C13.0488 7.34171 13.0488 7.65829 12.8536 7.85355L8.35355 12.3536Z',
]

let cached: IconSet | undefined

/** Icon HTML strings for the mermaid toolbar (computed lazily, once). */
export function mermaidToolbarIcons(): IconSet {
  if (cached !== undefined) return cached
  cached = {
    zoomIn: iconSvg(ZOOM_IN),
    zoomOut: iconSvg(ZOOM_OUT),
    reset: iconSvg(SCREEN_NORMAL),
    copy: iconSvg(COPY),
    download: iconSvg(DOWNLOAD),
  }
  return cached
}
