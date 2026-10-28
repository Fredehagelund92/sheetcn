import type { ActiveRange, CellIndex } from "@sheetcn/core"
import type { RowData } from "@tanstack/react-table"
import { useCallback, useEffect, useRef } from "react"

import type { SelectMode, Sheet } from "./sheet.js"

/** What a pointer is over. */
export type PointerTarget =
  | { type: "cell"; rowIndex: number; columnIndex: number }
  | { type: "rowHeader"; rowIndex: number }
  | { type: "columnHeader"; columnIndex: number }
  | { type: "corner" }

/** The target under a viewport point, or null. */
export type HitTest = (clientX: number, clientY: number) => PointerTarget | null

/**
 * Reads a target from data attributes on the element or its nearest
 * ancestor: a row header has `data-row-index`, a column header only
 * `data-column-index`, and the corner `data-sheet-corner`. A cell has
 * `data-column-index` and takes its row from the `data-row-position` of its
 * row, so a row that only moved needs no new cells.
 */
export function targetOfElement(element: Element | null): PointerTarget | null {
  const el = element?.closest(
    "[data-row-index],[data-column-index],[data-sheet-corner]"
  )
  if (!(el instanceof HTMLElement)) return null
  const { rowIndex, columnIndex } = el.dataset
  const c = columnIndex === undefined ? undefined : Number(columnIndex)
  const position =
    rowIndex ??
    (c === undefined
      ? undefined
      : el.closest<HTMLElement>("[data-row-position]")?.dataset.rowPosition)
  const r = position === undefined ? undefined : Number(position)
  if (r !== undefined && c !== undefined) {
    return { type: "cell", rowIndex: r, columnIndex: c }
  }
  if (r !== undefined) return { type: "rowHeader", rowIndex: r }
  if (c !== undefined) return { type: "columnHeader", columnIndex: c }
  return { type: "corner" }
}

const domHitTest: HitTest = (x, y) =>
  targetOfElement(document.elementFromPoint(x, y))

export type SheetPointerOptions = {
  /**
   * The part of the scroll element hidden under sticky headers and pinned
   * columns, in pixels. A drag near these inner edges, or beyond the outer
   * ones, scrolls the grid.
   */
  insets?: () => { top: number; left: number }
  /** Finds the target under a point. Default: the data attributes of the element there. */
  hitTest?: HitTest
}

/** The fields of a DOM pointer event the handler reads. */
export type PointerEventLike = {
  button: number
  pointerId: number
  pointerType: string
  clientX: number
  clientY: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  target: EventTarget | null
  currentTarget: EventTarget | null
}

/** The fields of a DOM mouse event `onMouseDown` reads. */
export type MouseEventLike = {
  target: EventTarget | null
  currentTarget: EventTarget | null
  preventDefault(): void
}

// Presses inside these belong to the control (an open editor, say).
const CONTROLS = "input, textarea, select, [contenteditable]"
const inControl = (target: EventTarget | null) =>
  target instanceof Element && target.closest(CONTROLS) !== null

/**
 * Focuses the active cell's element inside `container`, found by its data
 * attributes (see `targetOfElement`), or the container itself when the
 * cell is not rendered. Returns the element focused.
 */
export function focusActiveCell<Row extends RowData>(
  sheet: Sheet<Row>,
  container: HTMLElement
): HTMLElement {
  const active = sheet.getActiveRange()?.anchor
  const cell = active
    ? container.querySelector<HTMLElement>(
        `[data-row-position="${active.rowIndex}"] [data-column-index="${active.columnIndex}"]`
      )
    : null
  const element = cell ?? container
  element.focus({ preventScroll: true })
  return element
}

// A touch that moves this far is a scroll, not a tap.
const TAP_SLOP = 10
const EDGE = 24
const SCROLL_STEP = 24

/**
 * The range a pointer press selects, from the target pressed and the target
 * now under the pointer. Headers select whole rows or columns.
 */
export function rangeForTargets(
  from: PointerTarget,
  to: PointerTarget,
  size: { rowCount: number; columnCount: number },
  anchor?: CellIndex
): ActiveRange {
  const lastRow = size.rowCount - 1
  const lastColumn = size.columnCount - 1
  const rowOf = (t: PointerTarget, fallback: number) =>
    "rowIndex" in t ? t.rowIndex : fallback
  const columnOf = (t: PointerTarget, fallback: number) =>
    "columnIndex" in t ? t.columnIndex : fallback
  switch (from.type) {
    case "corner":
      return {
        anchor: { rowIndex: 0, columnIndex: 0 },
        focus: { rowIndex: lastRow, columnIndex: lastColumn },
      }
    case "rowHeader": {
      const start = anchor?.rowIndex ?? from.rowIndex
      return {
        anchor: { rowIndex: start, columnIndex: 0 },
        focus: { rowIndex: rowOf(to, from.rowIndex), columnIndex: lastColumn },
      }
    }
    case "columnHeader": {
      const start = anchor?.columnIndex ?? from.columnIndex
      return {
        anchor: { rowIndex: 0, columnIndex: start },
        focus: {
          rowIndex: lastRow,
          columnIndex: columnOf(to, from.columnIndex),
        },
      }
    }
    case "cell": {
      const start = anchor ?? from
      return {
        anchor: { rowIndex: start.rowIndex, columnIndex: start.columnIndex },
        focus: {
          rowIndex: rowOf(to, from.rowIndex),
          columnIndex: columnOf(to, from.columnIndex),
        },
      }
    }
  }
}

/**
 * Pointer selection for a sheet, bound to the grid's scroll element with
 * `onPointerDown`. It replaces TanStack's mouse-only handlers:
 * - Mouse and pen: press selects; drag extends, scrolling at the edges;
 *   Shift extends the active range; Ctrl or Cmd adds a range, or removes
 *   one when pressed on a selected cell. Only the primary button selects.
 * - Touch: a tap selects; a drag scrolls the grid as usual.
 * - Row headers, column headers and the corner select whole rows, columns or
 *   everything, and drag across headers.
 * A press commits an open editor first and does nothing if the draft does
 * not parse; a press inside a form control (the editor) is left to it.
 *
 * Bind both handlers to the grid's scroll element: `onMouseDown` keeps DOM
 * focus on the active cell (see `focusActiveCell`).
 */
export function useSheetPointer<Row extends RowData>(
  sheet: Sheet<Row>,
  options: SheetPointerOptions = {}
) {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })
  const stopRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopRef.current?.(), [])

  const onPointerDown = useCallback(
    (event: PointerEventLike) => {
      const { hitTest = domHitTest } = optionsRef.current
      if (event.button !== 0 || inControl(event.target)) return
      const target = hitTest(event.clientX, event.clientY)
      const scroller = event.currentTarget
      if (!target || !(scroller instanceof HTMLElement)) return
      stopRef.current?.()

      const size = {
        rowCount: sheet.getRows().length,
        columnCount: sheet.getColumnIds().length,
      }
      if (!size.rowCount || !size.columnCount) return
      const active = sheet.getActiveRange()
      const extend = event.shiftKey && active !== null
      const multi = event.ctrlKey || event.metaKey
      const anchor = extend ? active.anchor : undefined
      let mode: SelectMode = "replace"
      if (extend) mode = "extend"
      else if (multi) {
        mode =
          target.type === "cell" && sheet.isSelected(target) ? "exclude" : "add"
      }

      const apply = (to: PointerTarget, m: SelectMode) => {
        sheet.select(rangeForTargets(target, to, size, anchor), m)
      }

      if (event.pointerType === "touch") {
        // Select on release, unless the touch turned into a scroll.
        const startX = event.clientX
        const startY = event.clientY
        const end = (e: PointerEvent) => {
          stop()
          if (e.type !== "pointerup") return
          if (Math.hypot(e.clientX - startX, e.clientY - startY) > TAP_SLOP) {
            return
          }
          if (sheet.commitEdit()) apply(target, mode)
        }
        const stop = () => {
          window.removeEventListener("pointerup", end)
          window.removeEventListener("pointercancel", end)
          stopRef.current = null
        }
        window.addEventListener("pointerup", end)
        window.addEventListener("pointercancel", end)
        stopRef.current = stop
        return
      }

      if (!sheet.commitEdit()) return
      apply(target, mode)

      let pointer = { x: event.clientX, y: event.clientY }
      let last = target
      let frame = 0

      // The target under the pointer, with the point pulled inside the
      // visible cells so a drag past an edge selects up to that edge.
      const targetAt = (x: number, y: number) => {
        const box = scroller.getBoundingClientRect()
        const inset = optionsRef.current.insets?.() ?? { top: 0, left: 0 }
        const inner = {
          top: box.top + (target.type === "columnHeader" ? 0 : inset.top),
          left: box.left + (target.type === "rowHeader" ? 0 : inset.left),
          right: box.left + scroller.clientWidth - 1,
          bottom: box.top + scroller.clientHeight - 1,
        }
        const px = Math.max(inner.left, Math.min(inner.right, x))
        const py = Math.max(inner.top, Math.min(inner.bottom, y))
        return (optionsRef.current.hitTest ?? domHitTest)(px, py)
      }

      const extendTo = () => {
        const to = targetAt(pointer.x, pointer.y)
        if (!to) return
        if (
          to.type === last.type &&
          ("rowIndex" in to ? to.rowIndex : -1) ===
            ("rowIndex" in last ? last.rowIndex : -1) &&
          ("columnIndex" in to ? to.columnIndex : -1) ===
            ("columnIndex" in last ? last.columnIndex : -1)
        ) {
          return
        }
        last = to
        // Moves the focus of the range this press made, whatever its mode.
        apply(to, "extend")
      }

      // Scroll while the pointer is held near or past an edge.
      const tick = () => {
        const box = scroller.getBoundingClientRect()
        const inset = optionsRef.current.insets?.() ?? { top: 0, left: 0 }
        const { x, y } = pointer
        const dy =
          y > box.top + scroller.clientHeight - EDGE
            ? SCROLL_STEP
            : y < box.top + inset.top + EDGE / 3
              ? -SCROLL_STEP
              : 0
        const dx =
          x > box.left + scroller.clientWidth - EDGE
            ? SCROLL_STEP
            : x < box.left + inset.left + EDGE / 3
              ? -SCROLL_STEP
              : 0
        // Header drags scroll only along their own axis.
        const sx = target.type === "rowHeader" ? 0 : dx
        const sy = target.type === "columnHeader" ? 0 : dy
        if (sx || sy) {
          scroller.scrollBy(sx, sy)
          extendTo()
        }
        frame = requestAnimationFrame(tick)
      }

      const move = (e: PointerEvent) => {
        if (e.pointerId !== event.pointerId) return
        pointer = { x: e.clientX, y: e.clientY }
        extendTo()
      }
      const stop = () => {
        cancelAnimationFrame(frame)
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", stop)
        window.removeEventListener("pointercancel", stop)
        stopRef.current = null
      }
      if (target.type !== "corner") {
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", stop)
        window.addEventListener("pointercancel", stop)
        frame = requestAnimationFrame(tick)
        stopRef.current = stop
      }
    },
    [sheet]
  )

  // A press would move DOM focus to what was pressed (or to the page body,
  // for a header), and start a text selection. Keep focus on the active
  // cell instead, so the keyboard keeps working. A mouse press follows the
  // pointer press, which has already moved the selection.
  const onMouseDown = useCallback(
    (event: MouseEventLike) => {
      const container = event.currentTarget
      if (inControl(event.target) || !(container instanceof HTMLElement)) return
      event.preventDefault()
      focusActiveCell(sheet, container)
    },
    [sheet]
  )

  return { onPointerDown, onMouseDown }
}
