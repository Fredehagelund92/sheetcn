import { defineColumnType } from "../type-def.js"
import { fail, ok } from "../values.js"
import {
  asText,
  collator,
  containsFilter,
  emptyFilter,
  startsWithFilter,
} from "./shared.js"

/** E.164: "+" and at most 15 digits. Shorter than 7 is no full number. */
const E164 = /^\+\d{7,15}$/

/**
 * A phone number's international form: "tel:" dropped, spaces, dots,
 * dashes and brackets removed, and a leading "00" written as "+".
 */
export function phoneDigits(text: string): string {
  let t = text.trim().replace(/^tel:/i, "")
  t = t.replace(/[\s.\-()[\]]/g, "")
  if (t.startsWith("00")) t = `+${t.slice(2)}`
  return t
}

/**
 * A phone number in E.164 form ("+4420794600958"). The core checks the
 * shape only: a "+" and 7 to 15 digits. A number without its country code
 * needs `phoneType` from "@sheetcn/core/phone", which also checks that the
 * number can exist and shows it in groups.
 */
export const phoneShapeType = defineColumnType({
  id: "phone",
  label: "Phone",
  group: "link",
  defaultOptions: {},
  parse: (text) => {
    if (text.trim() === "") return ok(null)
    const t = phoneDigits(text)
    if (!t.startsWith("+")) {
      return fail(
        `"${text.trim()}" needs its country code, such as +44 or 0044`
      )
    }
    return E164.test(t)
      ? ok(t)
      : fail(`"${text.trim()}" is not a phone number of 7 to 15 digits`)
  },
  format: (value: string) => asText(value),
  validate: (value) =>
    typeof value === "string" && E164.test(value)
      ? null
      : { message: "Not a phone number" },
  compare: (a, b) => collator.compare(a, b),
  filters: [containsFilter(), startsWithFilter(), emptyFilter()],
})
