import type { Sheet } from "@sheetcn/react"

// Measurement harness, driven from the page (the Measure button) or from the
// browser console as `window.__playground`.

/** Row renders, counted by the row component. */
export const renderCount = { rows: 0 }

/** Resolves in the first task after the current frame has been produced. */
const afterFrame = (then: () => void) => {
  const channel = new MessageChannel()
  channel.port1.onmessage = () => then()
  channel.port2.postMessage(0)
}

/** Resolves after the next frame has been produced: a frame, then a task. */
export const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => afterFrame(resolve))
  )

/**
 * Runs `work` at the start of a frame and resolves with the time until that
 * frame has been produced: the work, React's render, style, layout and paint.
 * Starting at a frame boundary leaves out the wait for the next frame that a
 * commit made at a random moment would add (up to 16.7 ms at 60 Hz).
 */
export const timeToPaint = (work: () => void) =>
  new Promise<number>((resolve) =>
    requestAnimationFrame(() => {
      const start = performance.now()
      work()
      afterFrame(() => resolve(performance.now() - start))
    })
  )

export type Stats = {
  runs: number
  median: number
  p95: number
  max: number
  rowRendersPerCommit: number
}

const round = (n: number) => Math.round(n * 100) / 100

function stats(times: number[], rowRenders: number): Stats {
  const sorted = [...times].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))] ?? 0
  return {
    runs: sorted.length,
    median: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted.at(-1) ?? 0),
    rowRendersPerCommit: round(rowRenders / Math.max(1, sorted.length)),
  }
}

/**
 * Commits one cell `runs` times, each from an open editor, and times each
 * commit to the frame that shows it (see `timeToPaint`). The cells are in the
 * first ten rows of the "price" column, so the rows they repaint are on
 * screen.
 *
 * With `enter`, each commit is an Enter keydown dispatched on the editor, so
 * it runs the same handlers as a key press: commit, move down, scroll and
 * focus. Otherwise it calls `commitEdit` directly and stays on the cell.
 */
export async function measureCommits(
  sheet: Sheet<Record<string, unknown>>,
  runs = 30,
  { enter = false } = {}
): Promise<Stats> {
  const column = sheet.columnIndexOf("price")
  const times: number[] = []
  let rowRenders = 0
  for (let i = 0; i < runs + 3; i++) {
    const rowIndex = i % 10
    sheet.select({
      anchor: { rowIndex, columnIndex: column },
      focus: { rowIndex, columnIndex: column },
    })
    sheet.startEdit("replace", String(100 + i + Math.random()))
    await nextPaint()
    const editor = document.activeElement
    const before = renderCount.rows
    const time = await timeToPaint(() => {
      if (enter && editor instanceof HTMLInputElement) {
        editor.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        )
      } else sheet.commitEdit(null)
    })
    // The first runs warm up.
    if (i >= 3) {
      times.push(time)
      rowRenders += renderCount.rows - before
    }
  }
  return stats(times, rowRenders)
}

/**
 * Times real key presses of Enter that commit an editor, two ways:
 * - `eventTiming`: the browser's own Event Timing duration, from the key
 *   press to the next frame presented (the definition INP uses). The browser
 *   reports only events of 16 ms or more, rounded to 8 ms, so faster presses
 *   are counted in `under16`.
 * - `toFrameTask`: from the page's handler to the first task after the next
 *   frame. Other tasks queued meanwhile (a test driver's) delay it.
 * Drive it with real keys (type a value, press Enter, repeat), then read
 * `stats()`.
 */
export function armKeyTimings(sheet: Sheet<Record<string, unknown>>) {
  const handled: number[] = []
  const toFrameTask: number[] = []
  const eventTiming: number[] = []
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || !sheet.getState().editing) return
    const start = performance.now()
    handled.push(start)
    void nextPaint().then(() => toFrameTask.push(performance.now() - start))
  }
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as PerformanceEventTiming[]) {
      if (entry.name !== "keydown") continue
      const enter = handled.some(
        (t) => t >= entry.processingStart && t <= entry.processingEnd
      )
      if (enter) eventTiming.push(entry.duration)
    }
  })
  // durationThreshold is missing from TypeScript's DOM types.
  observer.observe({
    type: "event",
    durationThreshold: 16,
  } as PerformanceObserverInit)
  window.addEventListener("keydown", onKeyDown, { capture: true })
  return {
    stats: () => ({
      presses: handled.length,
      eventTiming: {
        ...stats(eventTiming, 0),
        under16: handled.length - eventTiming.length,
      },
      toFrameTask: stats(toFrameTask, 0),
    }),
    disarm: () => {
      observer.disconnect()
      window.removeEventListener("keydown", onKeyDown, { capture: true })
    },
  }
}

export type ScrollStats = {
  frames: number
  /** Frames per second over the whole run. */
  fps: number
  /** Work per frame: the scroll, React's render, style, layout and paint. */
  work: Stats
  /** Frames that took longer than one 60 Hz frame (16.7 ms). */
  slowFrames: number
}

/**
 * Scrolls the grid `frames` times, `step` pixels down each frame (three rows
 * by default), and times each frame's work as `timeToPaint` does. A frame
 * keeps up with 60 Hz when its work stays under 16.7 ms.
 */
export async function measureScroll(
  frames = 300,
  { step = 96 } = {}
): Promise<ScrollStats> {
  const grid = document.querySelector<HTMLElement>("[role=grid]")
  if (!grid) throw new Error("There is no grid")
  grid.scrollTop = 0
  await nextPaint()
  const times: number[] = []
  const start = performance.now()
  for (let i = 0; i < frames; i++) {
    times.push(
      await timeToPaint(() => {
        grid.scrollTop += step
        // Send the scroll event now, so the render it causes lands in this
        // frame; the browser would send it with the next one.
        grid.dispatchEvent(new Event("scroll"))
      })
    )
  }
  const elapsed = performance.now() - start
  return {
    frames,
    fps: round((frames * 1000) / elapsed),
    work: stats(times, 0),
    slowFrames: times.filter((t) => t > 1000 / 60).length,
  }
}

export function installBench(sheet: Sheet<Record<string, unknown>>) {
  const api = {
    sheet,
    renderCount,
    measureCommits: (runs?: number, options?: { enter?: boolean }) =>
      measureCommits(sheet, runs, options),
    measureScroll: (frames?: number, options?: { step?: number }) =>
      measureScroll(frames, options),
    armKeyTimings: () => armKeyTimings(sheet),
    dom: () => {
      const grid = document.querySelector("[role=grid]")
      return {
        rows: grid?.querySelectorAll("[role=row]").length ?? 0,
        cells: grid?.querySelectorAll("[role=gridcell]").length ?? 0,
      }
    },
  }
  Object.assign(window, { __playground: api })
  return () => {
    Reflect.deleteProperty(window, "__playground")
  }
}
