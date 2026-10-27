import { builtInTypes } from "./built-in-types.js"
import { resolveColumnType } from "./cells.js"
import {
  assertColumns,
  type AccessorColumnOptions,
  type KeyColumnOptions,
  type KeysOfType,
} from "./columns.js"
import type {
  AnyColumnTypeDef,
  TypeOptions,
  TypeRequired,
  TypeValue,
} from "./type-def.js"
import type { CellValue, Column, ColumnSpec } from "./types.js"

type TypeOptionsArg<O, R extends string> = Partial<Omit<O, R>> &
  Pick<O, Extract<R, keyof O>>

/**
 * Makes a column of one type. Options the column itself does not have are
 * the type's options (`typeOptions`), such as a select's `options`. `R` names
 * the options the type requires.
 */
export type TypeHelper<
  Row,
  V extends CellValue,
  O,
  R extends string = never,
> = {
  (
    key: KeysOfType<Row, V>,
    ...args: [R] extends [never]
      ? [options?: KeyColumnOptions<Row, V> & TypeOptionsArg<O, R>]
      : [options: KeyColumnOptions<Row, V> & TypeOptionsArg<O, R>]
  ): Column<Row, V>
  (
    id: string,
    options: AccessorColumnOptions<Row, V> & TypeOptionsArg<O, R>
  ): Column<Row, V>
}

/**
 * One helper per type of a registry, named by the type's id. A type whose id
 * is not a literal type has no helper.
 */
export type TypeHelpers<Row, Defs extends readonly AnyColumnTypeDef[]> = {
  [D in Defs[number] as string extends D["id"] ? never : D["id"]]: TypeHelper<
    Row,
    TypeValue<D>,
    TypeOptions<D>,
    TypeRequired<D>
  >
}

/** The helpers of the built-in types, which `defineColumns` hands out. */
export type ColumnHelpers<Row> = TypeHelpers<Row, typeof builtInTypes>

/** The column types one sheet can use, by id. */
export type TypeRegistry<
  Defs extends readonly AnyColumnTypeDef[] = readonly AnyColumnTypeDef[],
> = {
  /** The definitions, in the order given. */
  readonly definitions: Defs
  get(this: void, id: string): AnyColumnTypeDef | undefined
  /**
   * Builds a typed column list with one helper per type. Each helper checks
   * that a key holds that type's values, and the result is a plain
   * `Column<Row>[]`:
   *
   * ```ts
   * const columns = types.defineColumns<Item>((c) => [
   *   c.text("name", { header: "Name" }),
   *   c.select("status", { options: [{ value: "open", label: "Open" }] }),
   *   c.rating("stars", { max: 10 }),
   * ])
   * ```
   */
  defineColumns<Row>(
    this: void,
    build: (c: TypeHelpers<Row, Defs>) => Column<Row>[]
  ): Column<Row>[]
  /**
   * The column a spec describes. It reads and writes the row property named
   * by the spec's id. Throws when the type is unknown or rejects the options.
   */
  fromSpec<Row>(this: void, spec: ColumnSpec): Column<Row>
}

// The properties a helper keeps on the column. Every other option is the
// type's.
const COLUMN_KEYS = new Set([
  "id",
  "header",
  "value",
  "write",
  "readOnly",
  "width",
  "minWidth",
  "maxWidth",
  "grow",
  "pin",
  "format",
  "parse",
  "validate",
  "type",
  "typeOptions",
  "typeDef",
])

type AnyRow = Record<string, unknown>
type AnyColumn = Column<AnyRow>

const writeKey =
  (key: string) =>
  (row: AnyRow, next: CellValue): AnyRow => ({ ...row, [key]: next })

function makeHelper(def: AnyColumnTypeDef) {
  return (keyOrId: string, input: Record<string, unknown> = {}): AnyColumn => {
    const own: Record<string, unknown> = {}
    const typeOptions: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) {
      if (COLUMN_KEYS.has(k)) own[k] = v
      else if (k in def.defaultOptions) typeOptions[k] = v
      else {
        throw new Error(
          `Column "${keyOrId}" has the option "${k}", which the type "${def.id}" does not have`
        )
      }
    }
    for (const k of def.requiredOptions ?? []) {
      if (typeOptions[k] === undefined) {
        throw new Error(
          `Column "${keyOrId}" needs the option "${k}" for the type "${def.id}"`
        )
      }
    }
    const { value, id, ...rest } = own as Partial<AnyColumn>
    const typed = {
      type: def.id,
      typeDef: def,
      ...(Object.keys(typeOptions).length ? { typeOptions } : {}),
    }
    if (typeof value === "function") {
      return { header: keyOrId, ...rest, id: keyOrId, value, ...typed }
    }
    return {
      write: writeKey(keyOrId),
      header: id ?? keyOrId,
      ...rest,
      id: id ?? keyOrId,
      value: keyOrId,
      ...typed,
    }
  }
}

/**
 * A registry of column types for one sheet. Pass it to the sheet as `types`.
 * Throws when two types share an id, or when a type has an option named like
 * a column property (such as `width`).
 *
 * ```ts
 * const types = createTypeRegistry([...builtInTypes, rating])
 * ```
 */
export function createTypeRegistry<
  const Defs extends readonly AnyColumnTypeDef[],
>(types: Defs): TypeRegistry<Defs> {
  const byId = new Map<string, AnyColumnTypeDef>()
  const helpers: Record<string, ReturnType<typeof makeHelper>> = {}
  for (const def of types) {
    if (byId.has(def.id)) throw new Error(`Two types have the id "${def.id}"`)
    for (const key of Object.keys(def.defaultOptions)) {
      if (COLUMN_KEYS.has(key)) {
        throw new Error(
          `Type "${def.id}" has an option named "${key}", which columns use`
        )
      }
    }
    byId.set(def.id, def)
    helpers[def.id] = makeHelper(def)
  }
  const get = (id: string) => byId.get(id)
  return {
    definitions: types,
    get,
    defineColumns: <Row>(
      build: (c: TypeHelpers<Row, Defs>) => Column<Row>[]
    ): Column<Row>[] => {
      const columns = build(helpers as unknown as TypeHelpers<Row, Defs>)
      assertColumns(columns, { get })
      return columns
    },
    fromSpec: <Row>(spec: ColumnSpec): Column<Row> => {
      const def = byId.get(spec.type)
      if (!def) {
        throw new Error(
          `Column "${spec.id}" has the type "${spec.type}", which this registry does not include`
        )
      }
      const column: AnyColumn = {
        ...spec,
        value: spec.id,
        write: writeKey(spec.id),
        typeDef: def,
      }
      resolveColumnType(column)
      return column as unknown as Column<Row>
    },
  }
}

/** The built-in types, which sheets use when given no `types`. */
export const builtInTypeRegistry = createTypeRegistry(builtInTypes)

/**
 * Builds a typed column list of the built-in types. Each helper checks that a
 * key holds the right kind of value, and the result is a plain
 * `Column<Row>[]`:
 *
 * ```ts
 * const columns = defineColumns<Item>((c) => [
 *   c.text("name", { header: "Name" }),
 *   c.number("price", { format: (v) => v.toFixed(2) }),
 *   c.number("total", { value: (row) => row.price * row.qty }),
 * ])
 * ```
 *
 * For other types, use a registry's `defineColumns`.
 */
export const defineColumns: <Row>(
  build: (c: ColumnHelpers<Row>) => Column<Row>[]
) => Column<Row>[] = builtInTypeRegistry.defineColumns
