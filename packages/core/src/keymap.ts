import type { Direction, Navigation } from "./selection.js"
import type { ColumnType } from "./types.js"

/**
 * How a cell is being edited, as in spreadsheets:
 * - "replace": started by typing. The typed text replaces the value, and the
 *   arrow keys commit and move.
 * - "edit": started with Enter, F2 or a double click. The value is kept, and
 *   the arrow keys move the caret.
 *
 * F2 switches between the two.
 */
export type EditMode = "replace" | "edit"

/** What a key press asks the sheet to do. */
export type SheetCommand =
  | Navigation
  | {
      type: "startEdit"
      mode: EditMode
      /** Text that replaces the value ("replace" mode). */
      text?: string
      /**
       * An input method is composing. The editor opens empty and the key's
       * default action must run, so the composition continues in the editor.
       */
      composing?: boolean
    }
  | { type: "setEditMode"; mode: EditMode }
  /** Commits the editor, then moves the active cell one step (or stays). */
  | { type: "commitEdit"; move: Direction | null }
  | { type: "cancelEdit" }
  /** Flips a boolean cell, which has no editor. */
  | { type: "toggle" }
  /** Empties the selected cells. */
  | { type: "clear" }
  | { type: "undo" }
  | { type: "redo" }
  /** Drops a cut that is waiting for a paste; nothing is cleared. */
  | { type: "cancelCut" }

/** The fields of a keyboard event the map reads. A DOM `KeyboardEvent` fits. */
export type KeyInput = {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing?: boolean
}

/** The state of the sheet that decides what a key does. */
export type KeyContext = {
  /** The editor's mode, or null when no cell is being edited. */
  editing: EditMode | null
  /** The column type of the active cell. */
  activeColumnType?: ColumnType | null
  /** A cut is waiting for a paste. Escape cancels it. */
  cutPending?: boolean
}

const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
}

const graphemes = new Intl.Segmenter()

/**
 * True for a key that types one character (named keys such as "Enter" or
 * "F5" are words). Ctrl and Cmd shortcuts are not typing, except Ctrl+Alt,
 * which is how some keyboard layouts report AltGr.
 */
function isTyping(e: KeyInput): boolean {
  const segments = graphemes.segment(e.key)[Symbol.iterator]()
  if (segments.next().done || !segments.next().done) return false
  if (e.metaKey) return false
  return !e.ctrlKey || e.altKey
}

/**
 * Maps a key press to a sheet command, or null when the sheet should leave
 * the key alone (the browser or the editor handles it). Ctrl and Cmd are both
 * treated as the shortcut modifier. Copy, cut and paste are not keys here:
 * they arrive as clipboard events.
 *
 * The conventions: Enter edits the active cell (and, while editing, commits
 * and moves down); Escape cancels an edit, then a pending cut, then collapses
 * the selection to the active cell.
 */
export function keyToCommand(
  e: KeyInput,
  context: KeyContext
): SheetCommand | null {
  return context.editing ? editingKey(e, context.editing) : gridKey(e, context)
}

function editingKey(e: KeyInput, mode: EditMode): SheetCommand | null {
  if (e.isComposing || e.key === "Process") return null
  const mod = e.metaKey || e.ctrlKey
  switch (e.key) {
    case "Escape":
      return { type: "cancelEdit" }
    case "Enter":
      if (mod || e.altKey) return null
      return { type: "commitEdit", move: e.shiftKey ? "up" : "down" }
    case "Tab":
      if (mod || e.altKey) return null
      return { type: "commitEdit", move: e.shiftKey ? "left" : "right" }
    case "F2":
      return { type: "setEditMode", mode: mode === "edit" ? "replace" : "edit" }
  }
  const direction = ARROWS[e.key]
  if (direction && mode === "replace" && !mod && !e.altKey && !e.shiftKey) {
    return { type: "commitEdit", move: direction }
  }
  return null
}

function gridKey(e: KeyInput, context: KeyContext): SheetCommand | null {
  if (e.isComposing || e.key === "Process" || e.key === "Dead") {
    return { type: "startEdit", mode: "replace", text: "", composing: true }
  }
  const mod = e.metaKey || e.ctrlKey
  const extend = e.shiftKey
  const boolean = context.activeColumnType === "boolean"

  const direction = ARROWS[e.key]
  if (direction) {
    if (e.altKey) return null
    return { type: mod ? "jump" : "move", direction, extend }
  }

  switch (e.key) {
    case "Tab":
      if (mod || e.altKey) return null
      return {
        type: "move",
        direction: e.shiftKey ? "left" : "right",
        extend: false,
      }
    case "Enter":
      if (mod || e.altKey) return null
      if (e.shiftKey) return { type: "move", direction: "up", extend: false }
      return boolean ? { type: "toggle" } : { type: "startEdit", mode: "edit" }
    case "F2":
      if (mod || e.altKey || e.shiftKey || boolean) return null
      return { type: "startEdit", mode: "edit" }
    case "Escape":
      return context.cutPending ? { type: "cancelCut" } : { type: "collapse" }
    case "Delete":
    case "Backspace":
      if (mod || e.altKey) return null
      return { type: "clear" }
    case "Home":
      return { type: mod ? "gridStart" : "rowStart", extend }
    case "End":
      return { type: mod ? "gridEnd" : "rowEnd", extend }
    case "PageUp":
    case "PageDown": {
      const forward = e.key === "PageDown"
      if (mod) return null
      const direction: Direction = e.altKey
        ? forward
          ? "right"
          : "left"
        : forward
          ? "down"
          : "up"
      return { type: "page", direction, extend }
    }
    case " ":
      if (e.shiftKey && !mod) return { type: "selectRows" }
      if (mod && !e.shiftKey && !e.altKey) return { type: "selectColumns" }
      if (boolean && !e.altKey) return { type: "toggle" }
      break
  }

  if (mod && !e.altKey) {
    switch (e.key.toLowerCase()) {
      case "a":
        return e.shiftKey ? null : { type: "selectAll" }
      case "z":
        return { type: e.shiftKey ? "redo" : "undo" }
      case "y":
        return e.shiftKey ? null : { type: "redo" }
    }
    return null
  }

  if (isTyping(e)) return { type: "startEdit", mode: "replace", text: e.key }
  return null
}
