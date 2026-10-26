import { rowSelectionKey, type HistoryState } from "@sheetcn/core"
import type { RowData } from "@tanstack/react-table"
import { useCallback, useSyncExternalStore } from "react"

import type { Sheet, SheetState } from "./sheet.js"

/**
 * Reads a slice of the sheet state (editing, notice). `select` must return a
 * primitive or a kept reference, so unrelated changes do not re-render.
 */
export function useSheetState<Row extends RowData, T>(
  sheet: Sheet<Row>,
  select: (state: SheetState) => T
): T {
  const get = () => select(sheet.getState())
  return useSyncExternalStore(sheet.subscribe, get, get)
}

/** Subscribes to selection changes. */
function useSelectionSubscribe<Row extends RowData>(sheet: Sheet<Row>) {
  return useCallback(
    (listener: () => void) => {
      const subscription = sheet.table.atoms.cellSelection.subscribe(listener)
      return () => subscription.unsubscribe()
    },
    [sheet]
  )
}

/**
 * Reads a value derived from the selection, re-rendering only when it
 * changes. `select` must return a primitive or a kept reference.
 */
export function useSheetSelection<Row extends RowData, T>(
  sheet: Sheet<Row>,
  select: (sheet: Sheet<Row>) => T
): T {
  const subscribe = useSelectionSubscribe(sheet)
  const get = () => select(sheet)
  return useSyncExternalStore(subscribe, get, get)
}

/**
 * The selection key of one row (see `rowSelectionKey` in @sheetcn/core). A
 * row that renders from this key repaints only when the selection changes
 * what is drawn on it.
 */
export function useRowSelectionKey<Row extends RowData>(
  sheet: Sheet<Row>,
  rowIndex: number
): string {
  return useSheetSelection(sheet, (s) =>
    rowSelectionKey(
      s.getSelectionRects(),
      rowIndex,
      s.getActiveRange()?.anchor ?? null
    )
  )
}

/** Whether undo and redo are available. */
export function useSheetHistory<Row extends RowData>(
  sheet: Sheet<Row>
): HistoryState {
  const { store } = sheet
  return useSyncExternalStore(
    store.subscribe,
    store.getHistory,
    store.getHistory
  )
}
