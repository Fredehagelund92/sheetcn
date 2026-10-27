import {
  anyOfFilter,
  asText,
  collator,
  containsFilter,
  emptyFilter,
  isTextFilter,
  noOptions,
  orderFilters,
  startsWithFilter,
} from "./column-types/shared.js"
import { readDateOperand, relativeDateFilters } from "./column-types/dates.js"
import { countryType } from "./column-types/country.js"
import { moneyType, percentType } from "./column-types/numeric.js"
import { phoneShapeType } from "./column-types/phone.js"
import {
  domainType,
  emailType,
  identifierType,
  longTextType,
  urlType,
} from "./column-types/text.js"
import { defineColumnType } from "./type-def.js"
import type { SelectOption } from "./types.js"
import {
  isIsoDate,
  ok,
  parseBoolean,
  parseDate,
  parseNumber,
  parseSelect,
} from "./values.js"

const NOT_TEXT = { message: "Not text" }
const NOT_NUMBER = { message: "Not a number" }
const NOT_DATE = { message: "Not a date in YYYY-MM-DD form" }
const NOT_BOOLEAN = { message: "Not yes or no" }
const NOT_AN_OPTION = { message: "Not one of the options" }

/** Text, kept exactly as typed. */
export const textType = defineColumnType({
  id: "text",
  label: "Text",
  group: "text",
  defaultOptions: noOptions,
  parse: (text) => ok(text),
  format: (value: string) => asText(value),
  validate: (value) => (typeof value === "string" ? null : NOT_TEXT),
  compare: (a, b) => collator.compare(a, b),
  filters: [
    containsFilter(),
    isTextFilter(),
    startsWithFilter(),
    emptyFilter(),
  ],
})

/**
 * A finite number. Text parses with `parseNumber`, so a comma is never read
 * as a decimal mark.
 */
export const numberType = defineColumnType({
  id: "number",
  label: "Number",
  group: "number",
  defaultOptions: noOptions,
  parse: (text) => parseNumber(text),
  format: (value: number) => String(value),
  validate: (value) =>
    typeof value === "number" && Number.isFinite(value) ? null : NOT_NUMBER,
  compare: (a, b) => a - b,
  filters: [...orderFilters((text) => parseNumber(text)), emptyFilter()],
  align: "end",
})

/** A date, stored as an ISO string ("2026-03-01"). Only that form parses. */
export const dateType = defineColumnType({
  id: "date",
  label: "Date",
  group: "date",
  defaultOptions: noOptions,
  parse: (text) => parseDate(text),
  format: (value: string) => asText(value),
  validate: (value) =>
    typeof value === "string" && isIsoDate(value) ? null : NOT_DATE,
  // ISO dates sort as text.
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  filters: [
    ...relativeDateFilters(),
    ...orderFilters(readDateOperand, { lt: "before", gt: "after" }),
    emptyFilter(),
  ],
})

/** True or false, flipped with Space or Enter. Formats as TRUE or FALSE. */
export const booleanType = defineColumnType({
  id: "boolean",
  label: "Checkbox",
  group: "choice",
  defaultOptions: noOptions,
  parse: (text) => parseBoolean(text),
  format: (value: boolean) => formatBoolean(value),
  validate: (value) => (typeof value === "boolean" ? null : NOT_BOOLEAN),
  compare: (a, b) => Number(a) - Number(b),
  filters: [
    {
      id: "is",
      label: "is",
      notLabel: "is not",
      operands: 1,
      compile: ([text = ""]) => {
        const parsed = parseBoolean(text)
        if (!parsed.ok) return parsed
        const want = parsed.value
        return ok((value) => value !== null && value === want)
      },
    },
    emptyFilter(),
  ],
  edit: "toggle",
})

function formatBoolean(value: unknown): string {
  return value === true ? "TRUE" : value === false ? "FALSE" : asText(value)
}

export type SelectOptions = { options: readonly SelectOption[] }

type PreparedSelect = {
  options: readonly SelectOption[]
  /** Option value to its label. */
  labels: ReadonlyMap<string, string>
  /** Option value to its position. */
  order: ReadonlyMap<string, number>
}

/**
 * One of a list of options. It stores the option's value and shows its label.
 * Text matches a label, then a value, then either ignoring case.
 */
export const selectType = defineColumnType<
  string,
  SelectOptions,
  PreparedSelect,
  "select",
  "options"
>({
  id: "select",
  label: "Select",
  group: "choice",
  defaultOptions: { options: [] },
  requiredOptions: ["options"],
  prepare: ({ options }) => {
    const labels = new Map<string, string>()
    const order = new Map<string, number>()
    const seenLabels = new Set<string>()
    for (const o of options) {
      if (o.label.trim() === "") throw new Error("An option has no label")
      // A pasted label must name one option.
      if (labels.has(o.value) || seenLabels.has(o.label)) {
        throw new Error(
          `Two options have the value "${o.value}" or the label "${o.label}"`
        )
      }
      labels.set(o.value, o.label)
      order.set(o.value, order.size)
      seenLabels.add(o.label)
    }
    return { options, labels, order }
  },
  parse: (text, p) => parseSelect(text, p.options),
  format: (value, p) => p.labels.get(value) ?? asText(value),
  validate: (value, p) =>
    typeof value === "string" && p.labels.has(value) ? null : NOT_AN_OPTION,
  // Option order; values that are not options come after, as text.
  compare: (a, b, p) => {
    const i = p.order.get(a) ?? p.order.size
    const j = p.order.get(b) ?? p.order.size
    return i - j || (i === p.order.size ? collator.compare(a, b) : 0)
  },
  filters: [
    anyOfFilter((text, p) => parseSelect(text, p.options)),
    emptyFilter(),
  ],
  edit: "popup",
})

/**
 * The built-in types, to start a registry from:
 * `createTypeRegistry([...builtInTypes, myType])`.
 */
export const builtInTypes = [
  textType,
  longTextType,
  numberType,
  percentType,
  moneyType,
  dateType,
  selectType,
  booleanType,
  identifierType,
  emailType,
  urlType,
  domainType,
  phoneShapeType,
  countryType,
] as const
