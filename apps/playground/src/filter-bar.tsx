import {
  canFilter,
  describeCondition,
  filterChoices,
  foldText,
  isFilterGroup,
  PERIOD_CHOICES,
  resolveColumnType,
  valueChoices,
  type Column,
  type FilterChoice,
  type FilterCondition,
  type FilterGroup,
  type SheetView,
} from "@sheetcn/core"
import type { Sheet } from "@sheetcn/react"
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react"

// The filter bar: a row above the grid with one chip per condition (column,
// operator, value, remove), built from the columns' types. Each part of a
// chip opens its own small popover; a new filter goes through all three in
// turn, and Enter moves on, so a filter is typed without the mouse.

type AnySheet = Sheet<Record<string, unknown>>
type AnyColumn = Column<Record<string, unknown>>
type Item = FilterCondition | FilterGroup

/** A filter being made or changed: which chip, which step, and its draft. */
export type FilterFlow = {
  /** The chip's place among the filter's items, or null for a new one. */
  index: number | null
  step: "column" | "op" | "value"
  draft: FilterCondition
}

/** The flow that starts a new filter: pick a column. */
export const NEW_FILTER: FilterFlow = {
  index: null,
  step: "column",
  draft: { column: "", op: "", values: [] },
}

const itemsOf = (view: SheetView): readonly Item[] => view.filter?.items ?? []

/** The view with its top-level filter items replaced. */
function withItems(view: SheetView, items: readonly Item[]): SheetView {
  const { filter, ...rest } = view
  return items.length
    ? { ...rest, filter: { match: filter?.match ?? "all", items } }
    : rest
}

/** The ids of the columns a filter names, at any depth. */
export function filteredColumns(view: SheetView): ReadonlySet<string> {
  const ids = new Set<string>()
  const walk = (items: readonly Item[]) => {
    for (const item of items) {
      if (isFilterGroup(item)) walk(item.items)
      else ids.add(item.column)
    }
  }
  walk(itemsOf(view))
  return ids
}

/** Whether a condition has every value its filter needs. */
function complete(column: AnyColumn | undefined, draft: FilterCondition) {
  if (!column || !draft.op) return false
  const choice = filterChoices(column).find((c) => c.op === draft.op)
  if (!choice) return false
  const filled = draft.values.filter((v) => v.trim() !== "").length
  if (choice.operands === "many") return filled > 0
  return filled >= choice.operands
}

/** The first words of a column header that a query starts. */
function matchesQuery(header: string, query: string): boolean {
  const words = foldText(header).split(/[^\p{L}\p{N}]+/u)
  return foldText(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((q) => words.some((w) => w.startsWith(q)))
}

const ICONS = {
  filter: "M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z",
  plus: "M8 3v10M3 8h10",
  x: "M4.5 4.5l7 7M11.5 4.5l-7 7",
}

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg aria-hidden className="i" viewBox="0 0 16 16">
      <path d={ICONS[name]} />
    </svg>
  )
}

export function FilterBar({
  sheet,
  flow,
  onFlow,
  onGrid,
}: {
  sheet: AnySheet
  flow: FilterFlow | null
  onFlow: (flow: FilterFlow | null) => void
  /** Puts the focus back on the grid's active cell. */
  onGrid: () => void
}) {
  const view = sheet.getView()
  const items = itemsOf(view)
  const issues = sheet.getViewIssues()
  const barRef = useRef<HTMLDivElement>(null)
  // One tab stop: the item that last had the focus (roving tabindex).
  const [rove, setRove] = useState(0)
  // The view before each removal, for undo, and the last removal's words.
  const [removed, setRemoved] = useState<SheetView[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const focusAfter = useRef<string | null>(null)
  const hintId = useId()

  const columnOf = (id: string) => sheet.getColumn(id)
  const setItems = (next: readonly Item[]) =>
    sheet.setView((v) => withItems(v, next))

  // Focus moves after the render that shows its target.
  useLayoutEffect(() => {
    const key = focusAfter.current
    if (!key) return
    focusAfter.current = null
    barRef.current
      ?.querySelector<HTMLElement>(`[data-bar-key="${key}"]`)
      ?.focus()
  })

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  // The bar shows while there is a filter, one is being made, or an undo is
  // on offer.
  if (!items.length && !flow && !toast) return null

  const remove = (index: number) => {
    const item = items[index]
    if (!item) return
    setRemoved((r) => [...r, view])
    setToast(
      isFilterGroup(item)
        ? "a group of filters"
        : describeCondition(item, columnOf(item.column)).sentence
    )
    setItems(items.filter((_, i) => i !== index))
    const next = Math.min(index, items.length - 2)
    focusAfter.current = next >= 0 ? `chip-${next}` : "filter"
  }

  const undo = () => {
    const last = removed.at(-1)
    if (!last) return
    setRemoved((r) => r.slice(0, -1))
    setToast(null)
    sheet.setView(last)
  }

  const clear = () => {
    setRemoved((r) => [...r, view])
    setToast(items.length === 1 ? "1 filter" : `${items.length} filters`)
    setItems([])
    onFlow(null)
    onGrid()
  }

  /** Writes a finished condition: a new chip, or the chip it changes. */
  const commit = (draft: FilterCondition, index: number | null) => {
    if (index === null) setItems([...items, draft])
    else setItems(items.map((item, i) => (i === index ? draft : item)))
  }

  const close = (focus: string | null) => {
    onFlow(null)
    focusAfter.current = focus
  }

  const startNew = () => onFlow(NEW_FILTER)
  const editChip = (index: number, step: FilterFlow["step"]) => {
    const item = items[index]
    if (!item || isFilterGroup(item)) return
    onFlow({ index, step, draft: item })
  }

  // Keys on the bar itself; popovers handle their own.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLElement && e.target.closest(".pop")) return
    const mod = e.ctrlKey || e.metaKey
    const focusables = [
      ...(barRef.current?.querySelectorAll<HTMLElement>("[data-bar-key]") ??
        []),
    ]
    const at = focusables.indexOf(e.target as HTMLElement)
    const chip = (e.target as HTMLElement).dataset.chip
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const step = e.key === "ArrowRight" ? 1 : -1
      focusables[
        Math.max(0, Math.min(focusables.length - 1, at + step))
      ]?.focus()
    } else if (e.key === "Home") {
      focusables[0]?.focus()
    } else if (e.key === "End") {
      focusables.at(-1)?.focus()
    } else if ((e.key === "Backspace" || e.key === "Delete") && chip) {
      remove(Number(chip))
    } else if (e.key === "Enter" && chip) {
      const index = Number(chip)
      const item = items[index]
      if (item && !isFilterGroup(item)) {
        const choice = filterChoices(columnOf(item.column) as AnyColumn).find(
          (c) => c.op === item.op
        )
        editChip(index, choice?.operands === 0 ? "op" : "value")
      }
    } else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      undo()
    } else if (e.key.toLowerCase() === "f" && !mod && !e.altKey) {
      startNew()
    } else if (e.key === "Escape") {
      onGrid()
    } else {
      return
    }
    e.preventDefault()
  }

  let k = 0
  const roving = (key: string) => {
    const index = k++
    return {
      "data-bar-key": key,
      tabIndex: rove === index ? 0 : -1,
      onFocus: () => setRove(index),
    }
  }

  const issueAt = (i: number) =>
    issues.find(
      (x) => x.part === "filter" && x.path.length >= 1 && x.path[0] === i
    )

  const anchorKey = flow
    ? flow.index === null
      ? "draft"
      : `chip-${flow.index}`
    : null

  const shown = sheet.getRows().length
  const total = sheet.getTotalRowCount()

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label="Filters"
      className="filter-bar"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="btn"
        {...roving("filter")}
        onClick={startNew}
      >
        <Icon name="filter" />
        Filter
      </button>
      {view.filter?.match === "any" && items.length > 1 && (
        <span className="mode">Match any</span>
      )}
      {items.map((item, i) =>
        isFilterGroup(item) ? (
          <span key={i} className="fchip" data-anchor={`chip-${i}`}>
            <span
              className="v"
              role="button"
              aria-label={`A group of ${item.items.length} filters, set in code. Backspace removes it.`}
              data-chip={i}
              {...roving(`chip-${i}`)}
            >
              Advanced
            </span>
            <button
              type="button"
              className="x"
              tabIndex={-1}
              aria-label="Remove the group of filters"
              onClick={() => remove(i)}
            >
              <Icon name="x" />
            </button>
          </span>
        ) : (
          <Chip
            key={i}
            index={i}
            condition={item}
            column={columnOf(item.column)}
            issue={issueAt(i)?.message}
            open={flow?.index === i ? flow.step : null}
            roving={roving(`chip-${i}`)}
            hintId={hintId}
            onEdit={(step) => editChip(i, step)}
            onRemove={() => remove(i)}
          />
        )
      )}
      {flow?.index === null && <DraftChip sheet={sheet} draft={flow.draft} />}
      <button
        type="button"
        className="btn ghost icon"
        aria-label="Add a filter"
        title="Add a filter"
        {...roving("add")}
        onClick={startNew}
      >
        <Icon name="plus" />
      </button>
      <span className="sp" />
      <span className="count" aria-live="polite">
        <b>{shown.toLocaleString("en-US")}</b> of{" "}
        {total.toLocaleString("en-US")} rows
      </span>
      {items.length > 0 && (
        <button
          type="button"
          className="btn ghost"
          {...roving("clear")}
          onClick={clear}
        >
          Clear filters
        </button>
      )}
      <span id={hintId} hidden>
        Enter changes it, Backspace removes it
      </span>
      {toast && (
        <div role="status" className="toast">
          Removed {toast}
          <button type="button" onClick={undo}>
            Undo
          </button>
        </div>
      )}
      {flow && anchorKey && (
        <Popover
          barRef={barRef}
          anchorKey={anchorKey}
          onClose={() => close(anchorKey)}
        >
          <FlowSteps
            sheet={sheet}
            flow={flow}
            onFlow={onFlow}
            preview={(draft) =>
              withItems(
                view,
                flow.index === null
                  ? [...items, draft]
                  : items.map((item, i) => (i === flow.index ? draft : item))
              )
            }
            onCommit={(draft) => commit(draft, flow.index)}
            onDone={(draft) => {
              commit(draft, flow.index)
              close(flow.index === null ? `chip-${items.length}` : anchorKey)
            }}
            onCancel={() => close(flow.index === null ? "filter" : anchorKey)}
            onRemoveLast={() => items.length && remove(items.length - 1)}
          />
        </Popover>
      )}
    </div>
  )
}

function Chip({
  index,
  condition,
  column,
  issue,
  open,
  roving,
  hintId,
  onEdit,
  onRemove,
}: {
  hintId: string
  index: number
  condition: FilterCondition
  column: AnyColumn | undefined
  issue: string | undefined
  open: FilterFlow["step"] | null
  roving: Record<string, unknown>
  onEdit: (step: FilterFlow["step"]) => void
  onRemove: () => void
}) {
  const words = describeCondition(condition, column)
  const label = issue
    ? `${words.sentence}. Not applied: ${issue}`
    : words.sentence
  const main = words.value ? "value" : "op"
  return (
    <span
      className={cx("fchip", issue && "bad", open && "editing")}
      data-anchor={`chip-${index}`}
      title={issue ? `Not applied: ${issue}` : undefined}
    >
      <button
        type="button"
        className={cx("f", open === "column" && "open")}
        tabIndex={-1}
        aria-label={`Column: ${words.column}`}
        onClick={() => onEdit("column")}
      >
        {words.column}
      </button>
      <button
        type="button"
        className={cx("o", open === "op" && "open")}
        aria-label={main === "op" ? label : `Operator: ${words.op}`}
        aria-describedby={main === "op" ? hintId : undefined}
        aria-invalid={issue ? true : undefined}
        data-chip={main === "op" ? index : undefined}
        {...(main === "op" ? roving : { tabIndex: -1 })}
        onClick={() => onEdit("op")}
      >
        {words.op}
      </button>
      {words.value && (
        <button
          type="button"
          className={cx("v", open === "value" && "open")}
          aria-label={label}
          aria-describedby={hintId}
          aria-invalid={issue ? true : undefined}
          data-chip={index}
          {...roving}
          onClick={() => onEdit("value")}
        >
          {words.value}
        </button>
      )}
      <button
        type="button"
        className="x"
        tabIndex={-1}
        aria-label={`Remove ${words.sentence}`}
        onClick={onRemove}
      >
        <Icon name="x" />
      </button>
    </span>
  )
}

/** The chip a new filter shows while it is made: dashed, not applied yet. */
function DraftChip({
  sheet,
  draft,
}: {
  sheet: AnySheet
  draft: FilterCondition
}) {
  const column = draft.column ? sheet.getColumn(draft.column) : undefined
  const words = column && draft.op ? describeCondition(draft, column) : null
  return (
    <span className="fchip draft" data-anchor="draft" aria-hidden>
      <span className="f">{column?.header ?? "Column"}</span>
      {draft.op && <span className="o">{words?.op}</span>}
      {draft.op && <span className="v">{words?.value || "value"}</span>}
    </span>
  )
}

/** A popover under its anchor in the bar. A press outside closes it. */
function Popover({
  barRef,
  anchorKey,
  onClose,
  children,
}: {
  barRef: RefObject<HTMLDivElement | null>
  anchorKey: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(0)
  useLayoutEffect(() => {
    const bar = barRef.current
    const anchor = bar?.querySelector<HTMLElement>(
      `[data-anchor="${anchorKey}"]`
    )
    if (!bar || !anchor) return
    const max = bar.clientWidth - (ref.current?.offsetWidth ?? 0) - 8
    setLeft(Math.max(8, Math.min(anchor.offsetLeft - bar.scrollLeft, max)))
  }, [barRef, anchorKey])
  const latest = useRef(onClose)
  useLayoutEffect(() => {
    latest.current = onClose
  })
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      const anchor = barRef.current?.querySelector(
        `[data-anchor="${anchorKey}"]`
      )
      if (anchor?.contains(target)) return
      latest.current()
    }
    document.addEventListener("pointerdown", onDown, true)
    return () => document.removeEventListener("pointerdown", onDown, true)
  }, [barRef, anchorKey])
  return (
    <div ref={ref} className="pop" style={{ left }}>
      {children}
    </div>
  )
}

function FlowSteps({
  sheet,
  flow,
  onFlow,
  preview,
  onCommit,
  onDone,
  onCancel,
  onRemoveLast,
}: {
  sheet: AnySheet
  flow: FilterFlow
  onFlow: (flow: FilterFlow | null) => void
  /** The view with the draft in place, for the count of rows it keeps. */
  preview: (draft: FilterCondition) => SheetView
  /** Applies the draft and keeps the popover open (a chip being changed). */
  onCommit: (draft: FilterCondition) => void
  /** Applies the draft and closes the popover. */
  onDone: (draft: FilterCondition) => void
  onCancel: () => void
  onRemoveLast: () => void
}) {
  const { draft } = flow
  const column = draft.column ? sheet.getColumn(draft.column) : undefined

  if (flow.step === "column" || !column) {
    return (
      <ColumnStep
        sheet={sheet}
        current={draft.column}
        onCancel={onCancel}
        onBackspace={flow.index === null ? onRemoveLast : undefined}
        onPick={(picked) => {
          const next = sheet.getColumn(picked) as AnyColumn
          const sameType =
            column !== undefined &&
            resolveColumnType(next).def === resolveColumnType(column).def
          if (sameType && complete(next, { ...draft, column: picked })) {
            onDone({ ...draft, column: picked })
            return
          }
          const first = filterChoices(next)[0] as FilterChoice
          onFlow({
            ...flow,
            step: "op",
            draft: { column: picked, op: first.op, values: [] },
          })
        }}
      />
    )
  }
  if (flow.step === "op") {
    return (
      <OpStep
        column={column}
        current={draft}
        onCancel={onCancel}
        onPick={(choice) => {
          const before = filterChoices(column).find((c) => c.op === draft.op)
          // Values carry over while they still fit: "is" to "is not" keeps them.
          const values =
            before && before.operands === choice.operands ? draft.values : []
          const next: FilterCondition = choice.not
            ? { column: draft.column, op: choice.op, values, not: true }
            : { column: draft.column, op: choice.op, values }
          if (choice.operands === 0 || complete(column, next)) {
            if (choice.operands === 0 || flow.index !== null) {
              onDone(choice.operands === 0 ? { ...next, values: [] } : next)
              return
            }
          }
          onFlow({ ...flow, step: "value", draft: next })
        }}
      />
    )
  }
  return (
    <ValueStep
      sheet={sheet}
      column={column}
      draft={draft}
      preview={preview}
      onChange={(next) => {
        onFlow({ ...flow, draft: next })
        // A chip being changed follows each edit; a new one waits for Enter.
        if (flow.index !== null && complete(column, next)) onCommit(next)
      }}
      onDone={(next) => {
        if (complete(column, next)) onDone(next)
      }}
      onCancel={onCancel}
    />
  )
}

/** Keys of a list with a highlight: arrows, Home and End. */
function listKeys(
  e: KeyboardEvent,
  count: number,
  active: number,
  setActive: (i: number) => void
): boolean {
  const last = count - 1
  if (e.key === "ArrowDown") setActive(Math.min(last, active + 1))
  else if (e.key === "ArrowUp") setActive(Math.max(0, active - 1))
  else if (e.key === "Home") setActive(0)
  else if (e.key === "End") setActive(last)
  else return false
  e.preventDefault()
  return true
}

function ColumnStep({
  sheet,
  current,
  onPick,
  onCancel,
  onBackspace,
}: {
  sheet: AnySheet
  current: string
  onPick: (columnId: string) => void
  onCancel: () => void
  onBackspace: (() => void) | undefined
}) {
  const [query, setQuery] = useState("")
  const columns = sheet.columns.filter(canFilter)
  const matches = columns.filter((c) => matchesQuery(c.header, query))
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      columns.findIndex((c) => c.id === current)
    )
  )
  const at = Math.min(active, Math.max(0, matches.length - 1))
  const listId = useId()
  const optionId = (i: number) => `${listId}-${i}`
  return (
    <div role="dialog" aria-label="Filter by column" className="step">
      <div className="srch">
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={matches.length ? optionId(at) : undefined}
          aria-autocomplete="list"
          aria-label="Filter by column"
          placeholder="Filter by column"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (listKeys(e, matches.length, at, setActive)) return
            if (e.key === "Enter") {
              e.preventDefault()
              const pick = matches[at]
              if (pick) onPick(pick.id)
            } else if (e.key === "Escape") {
              e.preventDefault()
              onCancel()
            } else if (e.key === "Backspace" && query === "" && onBackspace) {
              e.preventDefault()
              onBackspace()
            }
          }}
        />
      </div>
      <div role="listbox" id={listId} aria-label="Columns" className="list">
        {matches.map((c, i) => (
          <div
            key={c.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === at}
            className={cx("opt", i === at && "on")}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onPick(c.id)}
            onPointerEnter={() => setActive(i)}
          >
            {c.header}
            <span className="sm">{resolveColumnType(c).def.label}</span>
          </div>
        ))}
        {!matches.length && (
          <div className="opt dim">No column matches &quot;{query}&quot;.</div>
        )}
      </div>
      <div className="ft">
        <kbd>↑</kbd>
        <kbd>↓</kbd> move <kbd>Enter</kbd> pick
        <span className="rt">
          <kbd>Esc</kbd> close
        </span>
      </div>
    </div>
  )
}

function OpStep({
  column,
  current,
  onPick,
  onCancel,
}: {
  column: AnyColumn
  current: FilterCondition
  onPick: (choice: FilterChoice) => void
  onCancel: () => void
}) {
  const choices = filterChoices(column)
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      choices.findIndex(
        (c) => c.op === current.op && c.not === (current.not === true)
      )
    )
  )
  const listId = useId()
  const optionId = (i: number) => `${listId}-${i}`
  return (
    <div
      role="dialog"
      aria-label={`${column.header}: pick an operator`}
      className="step"
    >
      <div className="hdr">
        <b>{column.header}</b>{" "}
        {resolveColumnType(column).def.label.toLowerCase()}
      </div>
      <div
        tabIndex={0}
        role="listbox"
        id={listId}
        aria-label="Operators"
        aria-activedescendant={optionId(active)}
        className="list"
        ref={focusOnMount}
        onKeyDown={(e) => {
          if (listKeys(e, choices.length, active, setActive)) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onPick(choices[active] as FilterChoice)
          } else if (e.key === "Escape") {
            e.preventDefault()
            onCancel()
          } else if (e.key.length === 1 && /\S/.test(e.key)) {
            // Type-ahead: the next operator that starts with the letter.
            const letter = e.key.toLowerCase()
            for (let n = 1; n <= choices.length; n++) {
              const i = (active + n) % choices.length
              if (choices[i]?.label.startsWith(letter)) {
                setActive(i)
                break
              }
            }
          }
        }}
      >
        {choices.map((c, i) => (
          <div
            key={`${c.op}-${c.not}`}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={cx("opt", i === active && "on")}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            onPointerEnter={() => setActive(i)}
          >
            {c.label}
          </div>
        ))}
      </div>
    </div>
  )
}

const UNITS = ["days", "weeks", "months", "years"] as const

function ValueStep({
  sheet,
  column,
  draft,
  preview,
  onChange,
  onDone,
  onCancel,
}: {
  sheet: AnySheet
  column: AnyColumn
  draft: FilterCondition
  preview: (draft: FilterCondition) => SheetView
  onChange: (draft: FilterCondition) => void
  onDone: (draft: FilterCondition) => void
  onCancel: () => void
}) {
  const choice = filterChoices(column).find(
    (c) => c.op === draft.op && c.not === (draft.not === true)
  ) as FilterChoice
  const words = describeCondition(draft, column)
  const set = (values: string[]) => onChange({ ...draft, values })
  // What the filter keeps with the draft in place, counted over every row.
  const count = useMemo(
    () => (complete(column, draft) ? sheet.countRows(preview(draft)) : null),
    // `preview` is new each render; the draft decides the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, column, draft]
  )

  const keys = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      onDone(draft)
    } else if (e.key === "Escape") {
      e.preventDefault()
      onCancel()
    }
  }

  let body: ReactNode
  if (draft.op === "inLast" || draft.op === "inNext") {
    const [n = "", unit = "days"] = draft.values
    body = (
      <div className="two">
        <input
          autoFocus
          inputMode="numeric"
          aria-label="How many"
          className="inp num"
          value={n}
          onChange={(e) => set([e.target.value, unit])}
          onKeyDown={keys}
        />
        <select
          aria-label="Unit"
          className="inp"
          value={unit}
          onChange={(e) => set([n, e.target.value])}
          onKeyDown={keys}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
    )
  } else if (draft.op === "within") {
    body = (
      <PickOne
        options={PERIOD_CHOICES}
        value={draft.values[0] ?? ""}
        label="Periods"
        onPick={(value) => onDone({ ...draft, values: [value] })}
        onCancel={onCancel}
      />
    )
  } else if (choice.operands === "many") {
    body = (
      <Checklist
        sheet={sheet}
        column={column}
        values={draft.values}
        onChange={set}
        onDone={() => onDone(draft)}
        onCancel={onCancel}
      />
    )
  } else if (choice.operands === 2) {
    const [a = "", b = ""] = draft.values
    body = (
      <div className="two">
        <input
          autoFocus
          aria-label="From"
          className="inp"
          value={a}
          onChange={(e) => set([e.target.value, b])}
          onKeyDown={keys}
        />
        and
        <input
          aria-label="To"
          className="inp"
          value={b}
          onChange={(e) => set([a, e.target.value])}
          onKeyDown={keys}
        />
      </div>
    )
  } else {
    const date = resolveColumnType(column).def.id === "date"
    body = (
      <input
        autoFocus
        aria-label={`${column.header} ${choice.label}`}
        className="inp"
        placeholder={date ? "YYYY-MM-DD or today" : "Value"}
        value={draft.values[0] ?? ""}
        onChange={(e) => set([e.target.value])}
        onKeyDown={keys}
      />
    )
  }
  return (
    <div
      role="dialog"
      aria-label={`${words.column} ${words.op}`}
      className="step value"
    >
      <div className="hdr">
        <b>{words.column}</b> {words.op}
      </div>
      <div className="body">{body}</div>
      <div className="ft" aria-live="polite">
        {count === null
          ? "Give a value"
          : `${count.toLocaleString("en-US")} ${count === 1 ? "row matches" : "rows match"}`}
        <span className="rt">
          {choice.operands === "many" && (
            <>
              <kbd>Space</kbd> tick{" "}
            </>
          )}
          <kbd>Enter</kbd>
        </span>
      </div>
    </div>
  )
}

/** A list to pick one value from, such as a period. */
function PickOne({
  options,
  value,
  label,
  onPick,
  onCancel,
}: {
  options: readonly { value: string; label: string }[]
  value: string
  label: string
  onPick: (value: string) => void
  onCancel: () => void
}) {
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value)
    )
  )
  const listId = useId()
  return (
    <div
      tabIndex={0}
      role="listbox"
      aria-label={label}
      aria-activedescendant={`${listId}-${active}`}
      className="list"
      ref={focusOnMount}
      onKeyDown={(e) => {
        if (listKeys(e, options.length, active, setActive)) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onPick((options[active] as { value: string }).value)
        } else if (e.key === "Escape") {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      {options.map((o, i) => (
        <div
          key={o.value}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === active}
          className={cx("opt", i === active && "on")}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onPick(o.value)}
          onPointerEnter={() => setActive(i)}
        >
          {o.label}
        </div>
      ))}
    </div>
  )
}

/** Most values a checklist shows at once; searching narrows the rest. */
const CHECKLIST_LIMIT = 200

/** "is any of": the column's values with a count each, to tick. */
function Checklist({
  sheet,
  column,
  values,
  onChange,
  onDone,
  onCancel,
}: {
  sheet: AnySheet
  column: AnyColumn
  values: readonly string[]
  onChange: (values: string[]) => void
  onDone: () => void
  onCancel: () => void
}) {
  const rows = sheet.store.getRows()
  const all = useMemo(() => valueChoices(rows, column), [rows, column])
  const [query, setQuery] = useState("")
  const matches = all
    .filter((c) => matchesQuery(c.label, query))
    .slice(0, CHECKLIST_LIMIT)
  const [active, setActive] = useState(0)
  const at = Math.min(active, Math.max(0, matches.length - 1))
  const listId = useId()
  const ticked = new Set(values)
  // Ticked values keep the column's order, whatever order they were ticked
  // in; values the column no longer holds stay at the end.
  const toggle = (text: string) => {
    const next = new Set(ticked)
    if (next.has(text)) next.delete(text)
    else next.add(text)
    const known = all.map((c) => c.text).filter((t) => next.has(t))
    const rest = values.filter((v) => next.has(v) && !known.includes(v))
    onChange([...known, ...rest])
  }
  return (
    <>
      <div className="srch">
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={matches.length ? `${listId}-${at}` : undefined}
          aria-label="Search values"
          placeholder="Search values"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (listKeys(e, matches.length, at, setActive)) return
            if (e.key === " " && matches[at]) {
              e.preventDefault()
              toggle(matches[at].text)
            } else if (e.key === "Enter") {
              e.preventDefault()
              onDone()
            } else if (e.key === "Escape") {
              e.preventDefault()
              onCancel()
            }
          }}
        />
      </div>
      <div
        role="listbox"
        id={listId}
        aria-label="Values"
        aria-multiselectable="true"
        className="list"
      >
        {matches.map((c, i) => (
          <div
            key={c.text}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={ticked.has(c.text)}
            className={cx("opt", i === at && "on")}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => toggle(c.text)}
            onPointerEnter={() => setActive(i)}
          >
            <span
              aria-hidden
              className={cx("cb", ticked.has(c.text) && "on")}
            />
            {c.label}
            <span className="sm">{c.count.toLocaleString("en-US")}</span>
          </div>
        ))}
        {!matches.length && <div className="opt dim">No value matches.</div>}
      </div>
    </>
  )
}

// A stable callback ref: React calls it once, when the element mounts.
function focusOnMount(el: HTMLElement | null) {
  el?.focus({ preventScroll: true })
}

function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(" ")
}
