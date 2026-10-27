import type { CellValue, Issue, ParseResult } from "./types.js"

/**
 * How a cell of a type is edited, which decides what keys do on it:
 * - "text": typing or Enter opens a text editor.
 * - "toggle": no editor. Space and Enter flip the value, which is a boolean;
 *   typed characters do nothing.
 * - "popup": typing or Enter opens the type's own editor, such as a list to
 *   pick from. The keys are the same as for "text"; the view draws it.
 * - "none": the cell is not edited in place. Enter and typed characters do
 *   nothing; Delete still clears it.
 */
export type EditHint = "text" | "toggle" | "popup" | "none"

/** Where a type is listed in a type picker. */
export type TypeGroup = "text" | "number" | "date" | "choice" | "link" | "other"

/**
 * The behaviour of one column type, with no DOM: how text becomes a value and
 * back, what a valid value is, and how values compare.
 *
 * `V` is the stored, non-empty value. `O` is the options a column picks, such
 * as a select's choices; every option has a default. `P` is what `prepare`
 * builds from the options once per column (formatters, lookup maps), and is
 * the options themselves when there is no `prepare`.
 *
 * Empty cells are `null`: `format`, `validate`, `equals` and `compare` never
 * see them. `parse` gets every text, including "", and returns `null` for
 * empty. The core calls `validate` and `equals` with whatever value is
 * stored, so a type that can meet data from outside should check the shape.
 *
 * The functions are declared as methods so that definitions of different
 * value types fit one registry.
 */
export type ColumnTypeDef<
  V extends CellValue = CellValue,
  O extends object = object,
  P = O,
  Id extends string = string,
  R extends string = never,
> = {
  /** Unique within a registry. Columns name their type by it. */
  id: Id
  /** The type's name for people, such as "Number". */
  label: string
  group?: TypeGroup
  /** A value for every option. A column's `typeOptions` override them. */
  defaultOptions: O
  /**
   * Options a column must set, because their default means nothing, such as a
   * select's `options`. Typed helpers require them, and throw without them.
   */
  requiredOptions?: readonly R[]
  /**
   * Runs once per column, with the column's options over the defaults. Build
   * anything costly to make per cell here. Throw to reject the options.
   */
  prepare?(this: void, options: O): P
  /** Text from an editor, paste, fill or import to a value. */
  parse(this: void, text: string, prepared: P): ParseResult<V | null>
  /**
   * A value to text for display and copy. `parse` reads it back. `row` is
   * the row the value is in when the text is for display; copy and editing
   * pass none, and must not need it.
   */
  format(this: void, value: V, prepared: P, row?: unknown): string
  /**
   * Checks a stored value. A failing value is still stored, and the cell is
   * flagged. `row` is the row the value is in.
   */
  validate?(this: void, value: V, prepared: P, row: unknown): Issue | null
  /**
   * Checks an empty cell, for a type whose cells must be filled in (such as
   * a required identifier). Default: empty cells pass.
   */
  validateEmpty?(this: void, prepared: P, row: unknown): Issue | null
  /**
   * Values must be distinct within the column. `validateCell`, given the
   * rows, flags each repeat with another row that holds it.
   */
  unique?: boolean
  /** Whether two values are the same. Default: `Object.is`. */
  equals?(this: void, a: V, b: V): boolean
  /**
   * Orders two values: negative when `a` comes first. Default: the formatted
   * texts, compared as words.
   */
  compare?(this: void, a: V, b: V, prepared: P): number
  /**
   * The ways to filter the column's cells, such as "contains" or "between".
   * No filter UI ships yet; `filterCell` runs one.
   */
  filters?: readonly FilterOp<V, P>[]
  /** Default: "text". */
  edit?: EditHint
  /** Where the value sits in its cell. Default: "start". */
  align?: "start" | "end"
}

/**
 * One way to filter a column. `operands` is how many texts the user gives:
 * none ("is empty"), one ("contains"), two ("between") or any number ("is
 * any of"). `test` reads the operand texts itself, usually with the type's
 * own parse, and gets empty cells as `null`.
 */
export type FilterOp<V extends CellValue = CellValue, P = unknown> = {
  /** Unique within the type, such as "contains". */
  id: string
  /** The words for people, such as "contains". */
  label: string
  operands: 0 | 1 | 2 | "many"
  test(
    this: void,
    value: V | null,
    operands: readonly string[],
    prepared: P
  ): boolean
}

/** A definition of any value, options and prepared state. */
export type AnyColumnTypeDef = ColumnTypeDef<
  CellValue,
  object,
  unknown,
  string,
  string
>

/** The stored value type of a definition. */
export type TypeValue<D> =
  D extends ColumnTypeDef<infer V, object, unknown, string, string> ? V : never

/** The options type of a definition. */
export type TypeOptions<D> =
  D extends ColumnTypeDef<CellValue, infer O, unknown, string, string>
    ? O
    : never

/** The names of the options a definition requires. */
export type TypeRequired<D> =
  D extends ColumnTypeDef<CellValue, object, unknown, string, infer R>
    ? R
    : never

/**
 * Defines a column type. It returns the definition unchanged and checks it
 * against `ColumnTypeDef`. Let TypeScript infer the type parameters (give
 * `format` a typed value and `defaultOptions` its options) so that the id
 * stays a literal: a registry then has a typed helper for it, such as
 * `c.rating`.
 *
 * ```ts
 * const rating = defineColumnType({
 *   id: "rating",
 *   label: "Rating",
 *   defaultOptions: { max: 5 },
 *   parse: (text, p) => { ... },
 *   format: (v: number) => "★".repeat(v),
 *   validate: (v, p) => (v >= 1 && v <= p.max ? null : { message: `1 to ${p.max}` }),
 * })
 * ```
 */
export function defineColumnType<
  V extends CellValue,
  O extends object,
  P = O,
  const Id extends string = string,
  R extends string = never,
>(def: ColumnTypeDef<V, O, P, Id, R>): ColumnTypeDef<V, O, P, Id, R> {
  return def
}
