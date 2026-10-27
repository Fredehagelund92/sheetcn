import type { FilterEnv, TextFilterOp, ValueFilterOp } from "../type-def.js"
import type { CellValue, ParseResult } from "../types.js"
import { fail, ok } from "../values.js"

/**
 * Orders text as words in the host's language, as people read it: the
 * order of `new Intl.Collator().compare`.
 */
export const collator = new Intl.Collator()

/** An empty options object, for types with no options. */
export const noOptions: object = {}

// `format` may meet a value of another shape (a number stored in a text
// column, say), so the built-in types fall back to `String`.
export const asText = (value: unknown) => String(value)

// Text with no character above U+007F has no accents to fold.
const NOT_ASCII = /[\u0080-\uffff]/

/**
 * Folds case and accents away, for matching names people type: "Café"
 * gives "cafe". Text filters match folded text.
 */
export const fold = (text: string) =>
  !NOT_ASCII.test(text)
    ? text.toLowerCase()
    : text
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

// Filter builders shared by the built-in types. Every filter but "empty"
// fails on an empty cell; a view turns any filter around with `not`, so "does
// not contain" passes empty cells.

type ValueOp<V extends CellValue, P> = ValueFilterOp<V, P>
type TextOp<V extends CellValue, P> = TextFilterOp<V, P>

/** "is empty": the cell holds nothing. */
export function emptyFilter<V extends CellValue, P>(): ValueOp<V, P> {
  return {
    id: "empty",
    label: "is empty",
    notLabel: "is not empty",
    operands: 0,
    compile: () => ok((value) => value === null),
  }
}

/** "contains": the text holds the operand, ignoring case and accents. */
export function containsFilter<V extends CellValue, P>(
  text: (value: V, prepared: P) => string = asText
): TextOp<V, P> {
  return {
    id: "contains",
    label: "contains",
    notLabel: "does not contain",
    operands: 1,
    text,
    compile: ([needle = ""]) => {
      const n = fold(needle)
      return ok((folded) => folded !== null && folded.includes(n))
    },
  }
}

/**
 * "is": the text equals the operand, ignoring case, accents and spaces
 * around the operand.
 */
export function isTextFilter<V extends CellValue, P>(
  text: (value: V, prepared: P) => string = asText
): TextOp<V, P> {
  return {
    id: "is",
    label: "is",
    notLabel: "is not",
    operands: 1,
    text,
    compile: ([operand = ""]) => {
      const n = fold(operand.trim())
      return ok((folded) => folded === n)
    },
  }
}

/** "starts with", ignoring case and accents. */
export function startsWithFilter<V extends CellValue, P>(
  text: (value: V, prepared: P) => string = asText
): TextOp<V, P> {
  return {
    id: "startsWith",
    label: "starts with",
    notLabel: "does not start with",
    operands: 1,
    text,
    compile: ([prefix = ""]) => {
      const n = fold(prefix.trim())
      return ok((folded) => folded !== null && folded.startsWith(n))
    },
  }
}

/**
 * "is any of": the value is one of the operands, each read by `parse`. An
 * operand that does not parse is an error, so the filter is skipped.
 */
export function anyOfFilter<V extends string, P>(
  parse: (text: string, prepared: P) => ParseResult<V | null>
): ValueOp<V, P> {
  return {
    id: "isAnyOf",
    label: "is any of",
    notLabel: "is none of",
    operands: "many",
    compile: (operands, p) => {
      const values = new Set<V>()
      for (const text of operands) {
        const parsed = parse(text, p)
        if (!parsed.ok) return parsed
        if (parsed.value !== null) values.add(parsed.value)
      }
      return ok((value) => value !== null && values.has(value))
    },
  }
}

/** Reads one operand of an ordered filter, such as a number or a date. */
export type OperandReader<V, P> = (
  text: string,
  prepared: P,
  env: FilterEnv
) => ParseResult<V | null>

/**
 * Ordered comparisons, with operands read by `read` (usually the type's
 * parse): "is", "less than", "greater than" and "between" (both ends
 * included). An operand that does not parse is an error, so the filter is
 * skipped.
 */
export function orderFilters<V extends number | string, P>(
  read: OperandReader<V, P>,
  labels: { lt: string; gt: string } = {
    lt: "less than",
    gt: "greater than",
  }
): ValueOp<V, P>[] {
  const op = (
    id: string,
    label: string,
    notLabel: string | undefined,
    operands: 1 | 2,
    holds: (value: V, a: V, b: V) => boolean
  ): ValueOp<V, P> => {
    const filter: ValueOp<V, P> = {
      id,
      label,
      operands,
      compile: (texts, p, env) => {
        const values: V[] = []
        for (const text of texts.slice(0, operands)) {
          const parsed = read(text, p, env)
          if (!parsed.ok) return parsed
          if (parsed.value === null) return fail("A value is missing")
          values.push(parsed.value)
        }
        const a = values[0] as V
        const b = values[1] ?? a
        return ok((value) => value !== null && holds(value, a, b))
      },
    }
    if (notLabel !== undefined) filter.notLabel = notLabel
    return filter
  }
  return [
    op("equals", "is", "is not", 1, (v, a) => v === a),
    op("lessThan", labels.lt, undefined, 1, (v, a) => v < a),
    op("greaterThan", labels.gt, undefined, 1, (v, a) => v > a),
    op(
      "between",
      "between",
      "is not between",
      2,
      (v, a, b) => v >= a && v <= b
    ),
  ]
}
