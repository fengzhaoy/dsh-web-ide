/**
 * SCM graph swimlane engine — a faithful React port of VS Code's
 * src/vs/workbench/contrib/scm/browser/scmHistory.ts (MIT, Microsoft Corp.):
 * the same constants, the same color registry, the same swimlane assignment
 * (toISCMHistoryItemViewModelArray) and the same SVG path construction
 * (renderSCMHistoryItemGraph), rebuilt as pure functions + a <GraphCell>
 * component so the sidebar can render the commit graph without DOM surgery.
 */
import type { GitLogEntry, GitLogRef } from '../types.js'

export const SWIMLANE_HEIGHT = 22
export const SWIMLANE_WIDTH = 11
const SWIMLANE_CURVE_RADIUS = 5
const CIRCLE_RADIUS = 4
const CIRCLE_STROKE_WIDTH = 2

/** scmGraph foreground colors (verbatim VS Code defaults). */
export const GRAPH_COLORS = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF'] as const
/** chartsBlue / chartsPurple (dark theme) — current branch + its upstream. */
export const HISTORY_ITEM_REF_COLOR = '#3794FF'
export const HISTORY_ITEM_REMOTE_REF_COLOR = '#B180D9'

/** One swimlane node: a parent commit id still routed through the graph. */
export interface GraphNode {
  readonly id: string
  /** CSS color of this lane. */
  readonly color: string
}

export interface GraphRefPill {
  readonly ref: GitLogRef
  /** Pill color; undefined = neutral badge (like the hover default). */
  readonly color: string | undefined
}

/** The view model for one rendered history row. */
export interface GraphViewModel {
  readonly commit: GitLogEntry
  readonly kind: 'HEAD' | 'node'
  readonly inputSwimlanes: readonly GraphNode[]
  readonly outputSwimlanes: readonly GraphNode[]
  /** Ordered ref pills (current > remote > rest), colored for the badge. */
  readonly refPills: readonly GraphRefPill[]
  /** The row's circle color (resolved like VS Code's circleColor). */
  readonly circleColor: string
}

const rot = (n: number, m: number): number => ((n % m) + m) % m

/** Colors for well-known refs: current branch → blue, its upstream → purple.
 *  Everything else rotates the palette, exactly like VS Code's graph color
 *  map (_getGraphColorMap: current/remote/base get theme colors, all other
 *  refs map to undefined → palette rotation). */
function buildColorMap(commits: readonly GitLogEntry[], currentBranch: string | undefined, upstream: string | undefined): Map<string, string | undefined> {
  const colorMap = new Map<string, string | undefined>()
  if (currentBranch !== undefined) colorMap.set(currentBranch, HISTORY_ITEM_REF_COLOR)
  if (upstream !== undefined) colorMap.set(upstream, HISTORY_ITEM_REMOTE_REF_COLOR)
  for (const commit of commits) {
    for (const ref of commit.refs) {
      if (!colorMap.has(ref.name)) colorMap.set(ref.name, undefined)
    }
  }
  return colorMap
}

/** The color of the first ref carrying a mapped color (VS Code's
 *  getLabelColorIdentifier). */
function getLabelColor(commit: GitLogEntry, colorMap: Map<string, string | undefined>): string | undefined {
  for (const ref of commit.refs) {
    const color = colorMap.get(ref.name)
    if (color !== undefined) return color
  }
  return undefined
}

/** VS Code's compareHistoryItemRefs: current > remote > colored > other. */
function compareRefs(a: GitLogRef, b: GitLogRef, colorMap: Map<string, string | undefined>): number {
  const order = (ref: GitLogRef): number => {
    if (ref.current && ref.type === 'head') return 1
    if (ref.type === 'remote') return 2
    if (colorMap.get(ref.name) !== undefined) return 4
    return ref.type === 'tag' ? 5 : 3
  }
  return order(a) - order(b)
}

/** Build the row view models (port of toISCMHistoryItemViewModelArray). */
export function toGraphViewModels(
  commits: readonly GitLogEntry[],
  head: string | undefined,
  currentBranch: string | undefined,
  upstream: string | undefined,
): GraphViewModel[] {
  const colorMap = buildColorMap(commits, currentBranch, upstream)
  const viewModels: GraphViewModel[] = []
  let colorIndex = -1

  for (const commit of commits) {
    const kind: GraphViewModel['kind'] = commit.hash === head && head !== undefined ? 'HEAD' : 'node'
    const inputSwimlanes: GraphNode[] = (viewModels[viewModels.length - 1]?.outputSwimlanes ?? []).map((n) => ({ ...n }))
    const outputSwimlanes: GraphNode[] = []

    let firstParentAdded = false

    // The commit's own lane routes into its first parent (color = the
    // commit's label color when it has one, else the lane color).
    if (commit.parents.length > 0) {
      for (const node of inputSwimlanes) {
        if (node.id === commit.hash) {
          if (!firstParentAdded) {
            outputSwimlanes.push({
              id: commit.parents[0],
              color: getLabelColor(commit, colorMap) ?? node.color,
            })
            firstParentAdded = true
          }
          continue
        }
        outputSwimlanes.push({ ...node })
      }
    }

    // Additional parents open new lanes from the right (palette rotation,
    // or the parent commit's own label color when it has one).
    for (let i = firstParentAdded ? 1 : 0; i < commit.parents.length; i++) {
      let color: string | undefined
      const parent = commit.parents[i]
      if (i === 0) {
        color = getLabelColor(commit, colorMap)
      } else {
        const parentCommit = commits.find((c) => c.hash === parent)
        color = parentCommit !== undefined ? getLabelColor(parentCommit, colorMap) : undefined
      }
      if (color === undefined) {
        colorIndex = rot(colorIndex + 1, GRAPH_COLORS.length)
        color = GRAPH_COLORS[colorIndex]
      }
      outputSwimlanes.push({ id: parent, color })
    }

    // Circle color — resolved exactly like VS Code: the output lane color at
    // the circle index, falling back to the input lane, else the ref blue.
    const inputIndex = inputSwimlanes.findIndex((node) => node.id === commit.hash)
    const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length
    const circleColor = circleIndex < outputSwimlanes.length ? outputSwimlanes[circleIndex].color
      : circleIndex < inputSwimlanes.length ? inputSwimlanes[circleIndex].color
      : HISTORY_ITEM_REF_COLOR

    // Ref pills, ordered (current > remote > colored > other) and colored.
    const refPills: GraphRefPill[] = (commit.refs ?? [])
      .slice()
      .sort((a, b) => compareRefs(a, b, colorMap))
      .map((ref) => {
        let color = colorMap.get(ref.name)
        if (colorMap.has(ref.name) && color === undefined) {
          // Like VS Code, an uncolored ref takes its commit's circle color.
          color = circleColor
        }
        return { ref, color }
      })

    viewModels.push({ commit, kind, inputSwimlanes, outputSwimlanes, refPills, circleColor })
  }

  return viewModels
}

/** Compute the models for one page of commits. */
export function computeGraphModels(
  commits: readonly GitLogEntry[],
  head: string | undefined,
  currentBranch: string | undefined,
  upstream: string | undefined,
): GraphViewModel[] {
  return toGraphViewModels(commits, head, currentBranch, upstream)
}

/** One path segment to draw: an SVG path plus its stroke color/width. */
export interface GraphPath {
  readonly d: string
  readonly color: string
  readonly width?: number
}

export interface GraphCircle {
  readonly cx: number
  readonly cy: number
  readonly r: number
  /** Fill color; undefined = stroke-only circle. */
  readonly fill: string | undefined
  readonly stroke: string | undefined
  readonly strokeWidth: number
  readonly dashed?: boolean
}

/** Port of renderSCMHistoryItemGraph: build the row's SVG paths/circles. */
export function graphCellGeometry(vm: GraphViewModel): { paths: GraphPath[]; circles: GraphCircle[]; width: number } {
  const paths: GraphPath[] = []
  const circles: GraphCircle[] = []
  const { commit } = vm
  const inputSwimlanes = vm.inputSwimlanes
  const outputSwimlanes = vm.outputSwimlanes

  const line = (x1: number, y1: number, y2: number, color: string, strokeWidth = 1): void => {
    paths.push({ d: 'M ' + x1 + ' ' + y1 + ' V ' + y2, color, width: strokeWidth })
  }

  // Find the history item in the input swimlanes.
  const inputIndex = inputSwimlanes.findIndex((node) => node.id === commit.hash)
  // Circle index — input lane when present, else appended at the end.
  const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length
  const circleColor = vm.circleColor

  let outputSwimlaneIndex = 0
  for (let index = 0; index < inputSwimlanes.length; index++) {
    const color = inputSwimlanes[index].color

    if (inputSwimlanes[index].id === commit.hash) {
      if (index !== circleIndex) {
        // The lane merges into the circle: "/" arc + "H" run.
        const d = [
          'M ' + SWIMLANE_WIDTH * (index + 1) + ' 0',
          'A ' + SWIMLANE_WIDTH + ' ' + SWIMLANE_WIDTH + ' 0 0 1 ' + SWIMLANE_WIDTH * index + ' ' + SWIMLANE_WIDTH,
          'H ' + SWIMLANE_WIDTH * (circleIndex + 1),
        ].join(' ')
        paths.push({ d, color })
      } else {
        outputSwimlaneIndex++
      }
    } else if (outputSwimlaneIndex < outputSwimlanes.length && inputSwimlanes[index].id === outputSwimlanes[outputSwimlaneIndex].id) {
      if (index === outputSwimlaneIndex) {
        // Straight "|" through the row.
        line(SWIMLANE_WIDTH * (index + 1), 0, SWIMLANE_HEIGHT, color)
      } else {
        // "|" + "/" + "-" + "/" + "|" — the lane shifts left past the circle.
        const x1 = SWIMLANE_WIDTH * (index + 1)
        const x2 = SWIMLANE_WIDTH * (outputSwimlaneIndex + 1)
        const d = [
          'M ' + x1 + ' 0',
          'V 6',
          'A ' + SWIMLANE_CURVE_RADIUS + ' ' + SWIMLANE_CURVE_RADIUS + ' 0 0 1 ' + (x1 - SWIMLANE_CURVE_RADIUS) + ' ' + SWIMLANE_HEIGHT / 2,
          'H ' + (x2 + SWIMLANE_CURVE_RADIUS),
          'A ' + SWIMLANE_CURVE_RADIUS + ' ' + SWIMLANE_CURVE_RADIUS + ' 0 0 0 ' + x2 + ' ' + (SWIMLANE_HEIGHT / 2 + SWIMLANE_CURVE_RADIUS),
          'V ' + SWIMLANE_HEIGHT,
        ].join(' ')
        paths.push({ d, color })
      }
      outputSwimlaneIndex++
    }
  }

  // Additional parents: "-\" arcs into their new lanes.
  for (let i = 1; i < commit.parents.length; i++) {
    const parentOutputIndex = findLastIndex(outputSwimlanes, (node) => node.id === commit.parents[i])
    if (parentOutputIndex === -1) continue
    const color = outputSwimlanes[parentOutputIndex].color
    const d = [
      'M ' + SWIMLANE_WIDTH * parentOutputIndex + ' ' + SWIMLANE_HEIGHT / 2,
      'A ' + SWIMLANE_WIDTH + ' ' + SWIMLANE_WIDTH + ' 0 0 1 ' + SWIMLANE_WIDTH * (parentOutputIndex + 1) + ' ' + SWIMLANE_HEIGHT,
      'M ' + SWIMLANE_WIDTH * parentOutputIndex + ' ' + SWIMLANE_HEIGHT / 2,
      'H ' + SWIMLANE_WIDTH * (circleIndex + 1) + ' ',
    ].join(' ')
    paths.push({ d, color })
  }

  // "|" into and out of the commit circle.
  if (inputIndex !== -1) {
    line(SWIMLANE_WIDTH * (circleIndex + 1), 0, SWIMLANE_HEIGHT / 2, inputSwimlanes[inputIndex].color)
  }
  if (commit.parents.length > 0) {
    line(SWIMLANE_WIDTH * (circleIndex + 1), SWIMLANE_HEIGHT / 2, SWIMLANE_HEIGHT, circleColor)
  }

  // The commit node.
  const node = (cx: number, cy: number, r: number, fill: string | undefined, stroke: string | undefined, strokeWidth: number, dashed?: boolean): void => {
    circles.push({ cx, cy, r, fill, stroke, strokeWidth, dashed })
  }
  const center = SWIMLANE_WIDTH * (circleIndex + 1)
  if (vm.kind === 'HEAD') {
    node(center, SWIMLANE_WIDTH, CIRCLE_RADIUS + 3, undefined, circleColor, CIRCLE_STROKE_WIDTH)
    node(center, SWIMLANE_WIDTH, CIRCLE_STROKE_WIDTH, undefined, undefined, CIRCLE_RADIUS)
  } else if (commit.parents.length > 1) {
    node(center, SWIMLANE_WIDTH, CIRCLE_RADIUS + 2, undefined, circleColor, CIRCLE_STROKE_WIDTH)
    node(center, SWIMLANE_WIDTH, CIRCLE_RADIUS - 1, undefined, circleColor, CIRCLE_STROKE_WIDTH)
  } else {
    node(center, SWIMLANE_WIDTH, CIRCLE_RADIUS + 1, circleColor, undefined, CIRCLE_STROKE_WIDTH)
  }

  return {
    paths,
    circles,
    width: SWIMLANE_WIDTH * (Math.max(inputSwimlanes.length, outputSwimlanes.length, 1) + 1),
  }
}

/** Placeholder lanes for the trailing "Load More" row (port of
 *  renderSCMHistoryGraphPlaceholder): plain vertical lines per open lane. */
export function graphPlaceholderLanes(vm: GraphViewModel | undefined): { x: number; color: string }[] {
  const lanes = vm?.outputSwimlanes ?? []
  return lanes.map((lane, index) => ({ x: SWIMLANE_WIDTH * (index + 1), color: lane.color }))
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return i
  }
  return -1
}
