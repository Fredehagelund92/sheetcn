import type { AnyColumnTypeDef } from "./type-def.js"

/** A value stored in one cell. Dates are ISO strings ("2026-03-01"). */
export type CellValue = string | number | boolean | null

/** The ids of the types every registry can start from (`builtInTypes`). */
export type BuiltInTypeId = "text" | "number" | "date" | "select" | "boolean"

/** A column's type id: a built-in one, or one a registry defines. */
export type ColumnType = BuiltInTypeId | (string & {})

export type ParseResult<V> =
  { ok: true; value: V } | { ok: false; error: string }

export type Issue = { message: string }

export type SelectOption = { value: string; label: string }

/**
 * The plain-data part of a column, which JSON can carry: what persistence and
 * history store. A registry turns a spec back into a column (`fromSpec`).
 */
export type ColumnSpec = {
  /** Stable id. Never changes, even when the header is renamed. */
  id: string
  /** Visible, renamable name. */
  header: string
  type: ColumnType
  /**
   * Options for the type, over its defaults, such as a select's
   * `{ options: [...] }`. Plain data.
   */
  typeOptions?: Readonly<Record<string, unknown>>
  /** Its width in pixels. With "fill" sizing, also the least it is given. */
  width?: number
  /** The least it can be resized or fitted to. */
  minWidth?: number
  /** The most it can be resized, fitted or grown to. */
  maxWidth?: number
  /**
   * With "fill" sizing, its share of the spare width against the other
   * columns. Default: its width. 0 keeps it at its width. Pinned columns
   * never grow.
   */
  grow?: number
  pin?: "start"
  readOnly?: boolean
}

/**
 * One column of a sheet: its spec, how to read and write it, and its type.
 * `V` is the non-empty value type; every cell may also be empty (`null`),
 * which `format` never sees and which formats as "".
 *
 * Build columns with `defineColumns` or a registry's `defineColumns`, which
 * set `typeDef`. Treat a column as immutable: its type's prepared state is
 * built once per column object.
 *
 * The functions are declared as methods so that a list of columns with
 * different value types is assignable to `Column<Row>[]`.
 */
export type Column<Row, V extends CellValue = CellValue> = Omit<
  ColumnSpec,
  "readOnly"
> & {
  /** The row property that holds the value, or a function that reads it. */
  value: (keyof Row & string) | ((row: Row) => V | null)
  /** Returns a new row with the value written. Omit it to make the column read-only. */
  write?(this: void, row: Row, next: V | null): Row
  readOnly?: boolean | ((row: Row) => boolean)
  /**
   * The definition of `type`, set by the registry that built the column.
   * Without it, `type` must name a built-in type.
   */
  typeDef?: AnyColumnTypeDef
  /** Text for display and copy. Replaces the type's `format`. */
  format?(this: void, value: V): string
  /** Text from an editor, paste, fill or import to a value. Replaces the type's `parse`. */
  parse?(this: void, text: string): ParseResult<V | null>
  /**
   * A business rule, checked after the type's own check. A failing value is
   * still stored, and the cell is flagged.
   */
  validate?(this: void, value: V | null, row: Row): Issue | null
}

/** One cell change. The unit of persistence and history. */
export type Patch = {
  rowId: string
  columnId: string
  from: CellValue
  to: CellValue
}

export type ChangeSource =
  | "edit"
  | "paste"
  | "cut"
  | "clear"
  | "fill"
  | "insert"
  | "remove"
  | "undo"
  | "redo"
  | "import"

/** A row added by a change, at its position after the insert step. */
export type InsertedRow<Row> = { index: number; row: Row }

/**
 * Every data mutation, as one value. It applies in a fixed order: insert rows
 * (in ascending `index`), then apply `patches` in order, then remove rows. The
 * inverse of a change has the same shape, which is how undo works.
 */
export type Change<Row> = {
  source: ChangeSource
  patches: Patch[]
  insertedRows?: InsertedRow<Row>[]
  removedRowIds?: string[]
}
