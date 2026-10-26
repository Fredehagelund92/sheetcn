import { applyChange, invertChange, type ChangeContext } from "./change.js"
import { assertColumns, getCellValue } from "./columns.js"
import { indexFor } from "./row-index.js"
import type {
  CellValue,
  Change,
  ChangeSource,
  Column,
  InsertedRow,
  Patch,
} from "./types.js"

export type SheetStoreOptions<Row> = ChangeContext<Row> & {
  /** The rows to start with. They are never mutated. */
  rows: readonly Row[]
  /**
   * When true, the store never changes its own rows. Each change goes to
   * `onChange`, and the app applies it (with `applyChange`) and passes the
   * result back through `setRows` before the next change.
   */
  controlled?: boolean
  /** Called once per data mutation, including undo and redo. */
  onChange?: (change: Change<Row>) => void
  /** Most undo steps kept. Default 500. */
  historyLimit?: number
  /**
   * Edits to the same cells within this many milliseconds of the previous
   * edit join its undo step, so a typing burst undoes at once. Default 1000;
   * 0 turns merging off.
   */
  mergeWindowMs?: number
  /** Clock for merging. Default `Date.now`. */
  now?: () => number
}

export type HistoryState = { canUndo: boolean; canRedo: boolean }

/** Collects the operations of one change. Nothing applies until the build returns. */
export type Transaction<Row> = {
  /** Sets a cell. The row may be one this transaction inserts. */
  set(rowId: string, columnId: string, value: CellValue): void
  /** Inserts rows before the row now at `index` (the row count appends). */
  insert(index: number, rows: readonly Row[]): void
  /** Removes rows. Removal happens after every insert and set. */
  remove(rowIds: readonly string[]): void
}

export type SheetStore<Row> = {
  getRows(this: void): readonly Row[]
  /** The same object until undo or redo availability changes. */
  getHistory(this: void): HistoryState
  /** Called after the rows or the history change. Returns an unsubscribe. */
  subscribe(this: void, listener: () => void): () => void
  /** The row's position, or -1. */
  indexOf(rowId: string): number
  getRow(rowId: string): Row | undefined
  getValue(rowId: string, columnId: string): CellValue
  /**
   * Builds one change from the operations `build` collects and commits it as
   * one undo step and one `onChange` call. `from` values are filled in, cells
   * set more than once keep one patch, and cells set to their current value
   * are dropped. Returns the change, or null when nothing changes. If `build`
   * throws, nothing is applied.
   */
  transaction(
    source: ChangeSource,
    build: (tx: Transaction<Row>) => void
  ): Change<Row> | null
  /** Reverts the last step. Returns the change applied, or null. */
  undo(): Change<Row> | null
  /** Repeats the last undone step. Returns the change applied, or null. */
  redo(): Change<Row> | null
  clearHistory(): void
  /**
   * Replaces the rows. In controlled mode this is how the app hands back the
   * rows after applying a change; history is kept. Arrays made by
   * `applyChange` from the current rows reuse their index, so this is cheap.
   */
  setRows(rows: readonly Row[]): void
}

type Step<Row> = {
  forward: Change<Row>
  inverse: Change<Row>
  at: number
}

const NO_HISTORY: HistoryState = { canUndo: false, canRedo: false }
const cellKey = (rowId: string, columnId: string) => `${rowId}\u0000${columnId}`

class Store<Row> implements SheetStore<Row> {
  #rows: readonly Row[]
  #history = NO_HISTORY
  #undo: Step<Row>[] = []
  #redo: Step<Row>[] = []
  // True while the top undo step may still take a merged edit.
  #mergeable = false
  readonly #listeners = new Set<() => void>()
  readonly #columns = new Map<string, Column<Row>>()
  readonly #ctx: ChangeContext<Row>
  readonly #options: SheetStoreOptions<Row>

  constructor(options: SheetStoreOptions<Row>) {
    assertColumns(options.columns)
    this.#options = options
    this.#ctx = { columns: options.columns, getRowId: options.getRowId }
    this.#rows = options.rows
    for (const c of options.columns) this.#columns.set(c.id, c)
  }

  getRows = () => this.#rows
  getHistory = () => this.#history

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  indexOf(rowId: string): number {
    return indexFor(this.#rows).indexOf(
      this.#rows,
      this.#options.getRowId,
      rowId
    )
  }

  getRow(rowId: string): Row | undefined {
    const i = this.indexOf(rowId)
    return i < 0 ? undefined : this.#rows[i]
  }

  getValue(rowId: string, columnId: string): CellValue {
    const row = this.getRow(rowId)
    return row === undefined ? null : getCellValue(this.#column(columnId), row)
  }

  transaction(
    source: ChangeSource,
    build: (tx: Transaction<Row>) => void
  ): Change<Row> | null {
    const sets: { rowId: string; columnId: string; value: CellValue }[] = []
    const inserts: { at: number; rows: readonly Row[] }[] = []
    const removes: string[] = []
    const count = this.#rows.length
    build({
      set: (rowId, columnId, value) => {
        if (!this.#column(columnId).write) {
          throw new Error(`Column "${columnId}" is read-only`)
        }
        sets.push({ rowId, columnId, value })
      },
      insert: (index, rows) => {
        if (!Number.isInteger(index) || index < 0 || index > count) {
          throw new Error(`Cannot insert at ${index}; there are ${count} rows`)
        }
        if (rows.length) inserts.push({ at: index, rows })
      },
      remove: (rowIds) => {
        for (const id of rowIds) removes.push(id)
      },
    })

    // Inserts at the same index keep their call order.
    inserts.sort((a, b) => a.at - b.at)
    const insertedRows: InsertedRow<Row>[] = []
    const insertedById = new Map<string, Row>()
    for (const { at, rows } of inserts) {
      for (const row of rows) {
        insertedRows.push({ index: at + insertedRows.length, row })
        insertedById.set(this.#options.getRowId(row), row)
      }
    }

    const patches = new Map<string, Patch>()
    for (const { rowId, columnId, value } of sets) {
      const key = cellKey(rowId, columnId)
      const patch = patches.get(key)
      if (patch) {
        patch.to = value
        continue
      }
      const row = insertedById.get(rowId) ?? this.getRow(rowId)
      if (row === undefined) throw new Error(`There is no row "${rowId}"`)
      const from = getCellValue(this.#column(columnId), row)
      patches.set(key, { rowId, columnId, from, to: value })
    }

    const change: Change<Row> = {
      source,
      patches: [...patches.values()].filter((p) => !Object.is(p.from, p.to)),
    }
    if (insertedRows.length) change.insertedRows = insertedRows
    if (removes.length) change.removedRowIds = [...new Set(removes)]
    if (!change.patches.length && !insertedRows.length && !removes.length) {
      return null
    }

    const inverse = invertChange(this.#rows, change, this.#ctx)
    const next = this.#next(change)
    this.#record(change, inverse)
    this.#publish(change, next)
    return change
  }

  undo(): Change<Row> | null {
    const step = this.#undo.at(-1)
    if (!step) return null
    const change = { ...step.inverse, source: "undo" as const }
    const next = this.#next(change)
    this.#undo.pop()
    this.#redo.push(step)
    this.#mergeable = false
    this.#syncHistory()
    this.#publish(change, next)
    return change
  }

  redo(): Change<Row> | null {
    const step = this.#redo.at(-1)
    if (!step) return null
    const change = { ...step.forward, source: "redo" as const }
    const next = this.#next(change)
    this.#redo.pop()
    this.#undo.push(step)
    this.#mergeable = false
    this.#syncHistory()
    this.#publish(change, next)
    return change
  }

  clearHistory(): void {
    this.#undo = []
    this.#redo = []
    this.#mergeable = false
    if (this.#syncHistory()) this.#notify()
  }

  setRows(rows: readonly Row[]): void {
    if (rows === this.#rows) return
    this.#rows = rows
    this.#notify()
  }

  #column(columnId: string): Column<Row> {
    const column = this.#columns.get(columnId)
    if (!column) throw new Error(`There is no column "${columnId}"`)
    return column
  }

  /**
   * The rows after `change`, or null in controlled mode. Computed before any
   * history moves, so a change that throws leaves the store as it was.
   */
  #next(change: Change<Row>): readonly Row[] | null {
    return this.#options.controlled
      ? null
      : applyChange(this.#rows, change, this.#ctx)
  }

  #publish(change: Change<Row>, next: readonly Row[] | null): void {
    if (next) this.#rows = next
    this.#options.onChange?.(change)
    this.#notify()
  }

  #record(change: Change<Row>, inverse: Change<Row>): void {
    const now = (this.#options.now ?? Date.now)()
    const top = this.#undo.at(-1)
    const window = this.#options.mergeWindowMs ?? 1000
    this.#redo = []
    if (
      top &&
      this.#mergeable &&
      window > 0 &&
      now - top.at <= window &&
      isTypingStep(top.forward) &&
      isTypingStep(change) &&
      sameCells(top.forward.patches, change.patches)
    ) {
      mergeInto(top, change, now)
      if (top.forward.patches.every((p) => Object.is(p.from, p.to))) {
        this.#undo.pop()
        this.#mergeable = false
      }
    } else {
      this.#undo.push({ forward: change, inverse, at: now })
      const limit = this.#options.historyLimit ?? 500
      if (this.#undo.length > limit)
        this.#undo.splice(0, this.#undo.length - limit)
      this.#mergeable = true
    }
    this.#syncHistory()
  }

  /** Returns true when the history state object changed. */
  #syncHistory(): boolean {
    const canUndo = this.#undo.length > 0
    const canRedo = this.#redo.length > 0
    if (
      canUndo === this.#history.canUndo &&
      canRedo === this.#history.canRedo
    ) {
      return false
    }
    this.#history = canUndo || canRedo ? { canUndo, canRedo } : NO_HISTORY
    return true
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}

function isTypingStep<Row>(change: Change<Row>): boolean {
  return (
    change.source === "edit" &&
    !change.insertedRows?.length &&
    !change.removedRowIds?.length
  )
}

function sameCells(a: readonly Patch[], b: readonly Patch[]): boolean {
  if (a.length !== b.length) return false
  const keys = new Set(a.map((p) => cellKey(p.rowId, p.columnId)))
  return b.every((p) => keys.has(cellKey(p.rowId, p.columnId)))
}

/** Folds a later edit of the same cells into a step: first `from`, last `to`. */
function mergeInto<Row>(step: Step<Row>, change: Change<Row>, now: number) {
  const to = new Map(
    change.patches.map((p) => [cellKey(p.rowId, p.columnId), p.to])
  )
  const forward = step.forward.patches.map((p) => ({
    ...p,
    to: to.get(cellKey(p.rowId, p.columnId)) as CellValue,
  }))
  step.forward = { ...step.forward, patches: forward }
  step.inverse = {
    ...step.inverse,
    patches: forward.map((p) => ({ ...p, from: p.to, to: p.from })).reverse(),
  }
  step.at = now
}

/**
 * Creates a store for the rows of one sheet: lookups by row id, transactions,
 * undo and redo, and one `onChange` per mutation.
 */
export function createSheetStore<Row>(
  options: SheetStoreOptions<Row>
): SheetStore<Row> {
  return new Store(options)
}
