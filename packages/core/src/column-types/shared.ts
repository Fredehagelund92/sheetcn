import type { FilterOp } from "../type-def.js"
import type { CellValue, ParseResult } from "../types.js"

/** Orders text as words in the host's language, as people read it. */
export const collator = new Intl.Collator()

/** An empty options object, for types with no options. */
export const noOptions: object = {}

// `format` may meet a value of another shape (a number stored in a text
// column, say), so the built-in types fall back to `String`.
export const asText = (value: unknown) => String(value)

/** Folds case and accents away, for matching names people type. */
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()

/** The parts of a WHATWG URL the link types read. */
export type ParsedUrl = {
  readonly href: string
  readonly protocol: string
  readonly hostname: string
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

// `URL` is in every runtime the core supports (browsers, Node, Deno), but in
// none of the TypeScript libraries the core compiles against, which leave
// out the DOM.
const UrlClass = (
  globalThis as unknown as {
    URL: new (url: string) => ParsedUrl
  }
).URL

/** Parses an absolute URL, or throws. */
export const parseUrl = (text: string): ParsedUrl => new UrlClass(text)

/** True for a list of strings, the only list a cell holds. */
export const isList = (value: unknown): value is readonly string[] =>
  Array.isArray(value)

/** Whether two lists hold the same strings in the same order. */
export function listsEqual(
  a: readonly string[],
  b: readonly string[]
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// Filter builders shared by the built-in types. Every op but "empty" fails on
// an empty cell.

type Op<V extends CellValue, P> = FilterOp<V, P>

/** "is empty": the cell holds nothing. */
export function emptyFilter<V extends CellValue, P>(): Op<V, P> {
  return {
    id: "empty",
    label: "is empty",
    operands: 0,
    test: (value) => value === null,
  }
}

/** "contains": the text holds the operand, ignoring case. */
export function containsFilter<V extends CellValue, P>(
  text: (value: V, prepared: P) => string = (v) => asText(v)
): Op<V, P> {
  return {
    id: "contains",
    label: "contains",
    operands: 1,
    test: (value, [needle = ""], p) =>
      value !== null && fold(text(value, p)).includes(fold(needle)),
  }
}

/** "is": the text equals the operand, ignoring case and spaces around it. */
export function isTextFilter<V extends CellValue, P>(
  text: (value: V, prepared: P) => string = (v) => asText(v)
): Op<V, P> {
  return {
    id: "is",
    label: "is",
    operands: 1,
    test: (value, [operand = ""], p) =>
      value !== null && fold(text(value, p)) === fold(operand.trim()),
  }
}

/** "starts with", ignoring case. */
export function startsWithFilter<V extends CellValue, P>(
  text: (value: V, prepared: P) => string = (v) => asText(v)
): Op<V, P> {
  return {
    id: "startsWith",
    label: "starts with",
    operands: 1,
    test: (value, [prefix = ""], p) =>
      value !== null && fold(text(value, p)).startsWith(fold(prefix.trim())),
  }
}

/** "is any of": the value is one of the operands, each read by `parse`. */
export function anyOfFilter<V extends string, P>(
  parse: (text: string, prepared: P) => ParseResult<V | null>
): Op<V, P> {
  return {
    id: "isAnyOf",
    label: "is any of",
    operands: "many",
    test: (value, operands, p) =>
      value !== null &&
      operands.some((text) => {
        const parsed = parse(text, p)
        return parsed.ok && parsed.value === value
      }),
  }
}

/**
 * Ordered comparisons, with operands read by the type's `parse`: "=", "<",
 * ">" and "between" (both ends included). An operand that does not parse
 * matches nothing.
 */
export function orderFilters<V extends number | string, P>(
  parse: (text: string, prepared: P) => ParseResult<V | null>,
  labels: { lt: string; gt: string } = { lt: "<", gt: ">" }
): Op<V, P>[] {
  const read = (text: string | undefined, p: P): V | null => {
    if (text === undefined) return null
    const parsed = parse(text, p)
    return parsed.ok ? parsed.value : null
  }
  const op = (
    id: string,
    label: string,
    operands: 1 | 2,
    holds: (value: V, a: V, b: V) => boolean
  ): Op<V, P> => ({
    id,
    label,
    operands,
    test: (value, [x, y], p) => {
      const a = read(x, p)
      const b = operands === 2 ? read(y, p) : a
      return value !== null && a !== null && b !== null && holds(value, a, b)
    },
  })
  return [
    op("equals", "=", 1, (v, a) => v === a),
    op("lessThan", labels.lt, 1, (v, a) => v < a),
    op("greaterThan", labels.gt, 1, (v, a) => v > a),
    op("between", "between", 2, (v, a, b) => v >= a && v <= b),
  ]
}
