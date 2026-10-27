import { describe, expect, it } from "vitest"

import {
  keyToCommand,
  type KeyContext,
  type KeyInput,
  type SheetCommand,
} from "../src/index.js"

// "Shift+Mod+ArrowDown" style shortcuts. Mod is Ctrl here; Cmd is checked below.
function press(shortcut: string, extra: Partial<KeyInput> = {}): KeyInput {
  const parts = shortcut === "+" ? ["+"] : shortcut.split("+")
  const key = parts.pop()!
  return {
    key: key === "Space" ? " " : key,
    shiftKey: parts.includes("Shift"),
    ctrlKey: parts.includes("Mod") || parts.includes("Ctrl"),
    metaKey: parts.includes("Cmd"),
    altKey: parts.includes("Alt"),
    ...extra,
  }
}

const grid: KeyContext = { editing: null, activeEdit: "text" }
const cmd = (shortcut: string, context: KeyContext = grid) =>
  keyToCommand(press(shortcut), context)

describe("keyToCommand on the grid", () => {
  const cases: [string, SheetCommand | null][] = [
    ["ArrowDown", { type: "move", direction: "down", extend: false }],
    ["Shift+ArrowLeft", { type: "move", direction: "left", extend: true }],
    ["Mod+ArrowRight", { type: "jump", direction: "right", extend: false }],
    ["Shift+Mod+ArrowUp", { type: "jump", direction: "up", extend: true }],
    ["Alt+ArrowDown", null],
    ["Tab", { type: "move", direction: "right", extend: false }],
    ["Shift+Tab", { type: "move", direction: "left", extend: false }],
    ["Home", { type: "rowStart", extend: false }],
    ["Shift+End", { type: "rowEnd", extend: true }],
    ["Mod+Home", { type: "gridStart", extend: false }],
    ["Shift+Mod+End", { type: "gridEnd", extend: true }],
    ["PageDown", { type: "page", direction: "down", extend: false }],
    ["Shift+PageUp", { type: "page", direction: "up", extend: true }],
    ["Alt+PageDown", { type: "page", direction: "right", extend: false }],
    ["Alt+PageUp", { type: "page", direction: "left", extend: false }],
    ["Mod+A", { type: "selectAll" }],
    ["Mod+a", { type: "selectAll" }],
    ["Shift+Space", { type: "selectRows" }],
    ["Mod+Space", { type: "selectColumns" }],
    ["Mod+z", { type: "undo" }],
    ["Shift+Mod+Z", { type: "redo" }],
    ["Mod+y", { type: "redo" }],
    ["Delete", { type: "clear" }],
    ["Backspace", { type: "clear" }],
    ["Escape", { type: "collapse" }],
    // Copy, cut and paste arrive as clipboard events, not keys.
    ["Mod+c", null],
    ["Mod+x", null],
    ["Mod+v", null],
    ["Mod+r", null],
    ["F5", null],
    ["Shift", null],
  ]
  it.each(cases)("%s", (shortcut, expected) => {
    expect(cmd(shortcut)).toEqual(expected)
  })

  it("treats Cmd like Ctrl", () => {
    expect(cmd("Cmd+ArrowDown")).toEqual(cmd("Mod+ArrowDown"))
    expect(cmd("Cmd+z")).toEqual({ type: "undo" })
  })
})

describe("Enter edits the active cell", () => {
  it("starts editing with the value kept", () => {
    expect(cmd("Enter")).toEqual({ type: "startEdit", mode: "edit" })
    expect(cmd("F2")).toEqual({ type: "startEdit", mode: "edit" })
  })

  it("moves up with Shift+Enter", () => {
    expect(cmd("Shift+Enter")).toEqual({
      type: "move",
      direction: "up",
      extend: false,
    })
  })

  it("commits and moves down while editing", () => {
    for (const mode of ["edit", "replace"] as const) {
      const editing = { editing: mode }
      expect(cmd("Enter", editing)).toEqual({
        type: "commitEdit",
        move: "down",
      })
      expect(cmd("Shift+Enter", editing)).toEqual({
        type: "commitEdit",
        move: "up",
      })
      expect(cmd("Tab", editing)).toEqual({ type: "commitEdit", move: "right" })
      expect(cmd("Shift+Tab", editing)).toEqual({
        type: "commitEdit",
        move: "left",
      })
      expect(cmd("Escape", editing)).toEqual({ type: "cancelEdit" })
      // Alt+Enter is a line break in the editor.
      expect(cmd("Alt+Enter", editing)).toBeNull()
    }
  })
})

describe("typing", () => {
  it("starts a replacing edit with the typed character", () => {
    expect(cmd("x")).toEqual({ type: "startEdit", mode: "replace", text: "x" })
    expect(cmd("Shift+X")).toEqual({
      type: "startEdit",
      mode: "replace",
      text: "X",
    })
    expect(cmd("Space")).toEqual({
      type: "startEdit",
      mode: "replace",
      text: " ",
    })
    expect(cmd("=")).toEqual({ type: "startEdit", mode: "replace", text: "=" })
    // One grapheme made of several code points.
    expect(cmd("🇩🇰")).toEqual({
      type: "startEdit",
      mode: "replace",
      text: "🇩🇰",
    })
  })

  it("types with AltGr (Ctrl+Alt) and Option (Alt)", () => {
    expect(cmd("Ctrl+Alt+@")?.type).toBe("startEdit")
    expect(cmd("Alt+å")?.type).toBe("startEdit")
    expect(cmd("Cmd+Alt+x")).toBeNull()
  })

  it("opens an empty editor for an input method and keeps the key", () => {
    const composing = {
      type: "startEdit",
      mode: "replace",
      text: "",
      composing: true,
    }
    expect(keyToCommand(press("Process"), grid)).toEqual(composing)
    expect(keyToCommand(press("a", { isComposing: true }), grid)).toEqual(
      composing
    )
    expect(keyToCommand(press("Dead"), grid)).toEqual(composing)
  })

  it("leaves composition alone while editing", () => {
    const editing: KeyContext = { editing: "replace" }
    expect(
      keyToCommand(press("Enter", { isComposing: true }), editing)
    ).toBeNull()
    expect(keyToCommand(press("Process"), editing)).toBeNull()
  })
})

describe("arrows while editing", () => {
  it("commit and move in replace mode", () => {
    expect(cmd("ArrowRight", { editing: "replace" })).toEqual({
      type: "commitEdit",
      move: "right",
    })
    expect(cmd("Shift+ArrowRight", { editing: "replace" })).toBeNull()
  })

  it("move the caret in edit mode", () => {
    expect(cmd("ArrowRight", { editing: "edit" })).toBeNull()
    expect(cmd("ArrowUp", { editing: "edit" })).toBeNull()
  })

  it("F2 switches between the modes", () => {
    expect(cmd("F2", { editing: "replace" })).toEqual({
      type: "setEditMode",
      mode: "edit",
    })
    expect(cmd("F2", { editing: "edit" })).toEqual({
      type: "setEditMode",
      mode: "replace",
    })
  })

  it("leave other keys to the editor", () => {
    for (const k of ["a", "Backspace", "Delete", "Home", "Mod+z", "Mod+a"]) {
      expect(cmd(k, { editing: "edit" })).toBeNull()
    }
  })
})

describe("toggle cells (a boolean type)", () => {
  const boolean: KeyContext = { editing: null, activeEdit: "toggle" }
  it("toggle with Space or Enter and have no editor", () => {
    expect(cmd("Space", boolean)).toEqual({ type: "toggle" })
    expect(cmd("Enter", boolean)).toEqual({ type: "toggle" })
    expect(cmd("F2", boolean)).toBeNull()
    expect(cmd("Shift+Space", boolean)).toEqual({ type: "selectRows" })
  })

  it("swallow typed text and composition without editing", () => {
    for (const k of ["a", "7", "é"]) {
      expect(cmd(k, boolean)).toEqual({ type: "ignore" })
    }
    expect(cmd("Dead", boolean)).toEqual({ type: "ignore" })
    expect(cmd("Process", boolean)).toEqual({ type: "ignore" })
    expect(keyToCommand({ ...press("a"), isComposing: true }, boolean)).toEqual(
      { type: "ignore" }
    )
  })

  it("leave shortcuts alone", () => {
    expect(cmd("Mod+q", boolean)).toBeNull()
    expect(cmd("Mod+z", boolean)).toEqual({ type: "undo" })
  })
})

describe("cells not edited in place", () => {
  const none: KeyContext = { editing: null, activeEdit: "none" }
  it("open no editor and toggle nothing", () => {
    for (const k of ["Enter", "Space", "a", "Dead"]) {
      expect(cmd(k, none)).toEqual({ type: "ignore" })
    }
    expect(cmd("F2", none)).toBeNull()
  })

  it("still clear, move and select", () => {
    expect(cmd("Delete", none)).toEqual({ type: "clear" })
    expect(cmd("ArrowDown", none)).toMatchObject({ type: "move" })
    expect(cmd("Shift+Enter", none)).toMatchObject({ type: "move" })
  })
})

describe("popup cells", () => {
  const popup: KeyContext = { editing: null, activeEdit: "popup" }
  it("open their editor like text cells", () => {
    expect(cmd("Enter", popup)).toEqual({ type: "startEdit", mode: "edit" })
    expect(cmd("F2", popup)).toEqual({ type: "startEdit", mode: "edit" })
    expect(cmd("a", popup)).toEqual({
      type: "startEdit",
      mode: "replace",
      text: "a",
    })
  })
})

describe("Escape and a pending cut", () => {
  it("cancels the cut first, without clearing anything", () => {
    expect(cmd("Escape", { editing: null, cutPending: true })).toEqual({
      type: "cancelCut",
    })
  })

  it("cancels an edit before the cut", () => {
    expect(cmd("Escape", { editing: "edit", cutPending: true })).toEqual({
      type: "cancelEdit",
    })
  })
})
