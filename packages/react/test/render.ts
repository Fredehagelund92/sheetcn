// A minimal hook renderer: React DOM in jsdom, every update inside act().
import { act, createElement, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

export function renderHook<P, R>(hook: (props: P) => R, initialProps: P) {
  const result = { current: undefined as R, renders: 0 }
  let props = initialProps
  function Probe({ p }: { p: P }): ReactNode {
    result.current = hook(p)
    result.renders++
    return null
  }
  const root = createRoot(document.createElement("div"))
  act(() => root.render(createElement(Probe, { p: props })))
  return {
    result,
    rerender: (next: P = props) => {
      props = next
      act(() => root.render(createElement(Probe, { p: props })))
    },
    unmount: () => {
      act(() => root.unmount())
    },
  }
}

/** Runs a callback inside act(), so React flushes the updates it causes. */
export function inAct(fn: () => void) {
  act(fn)
}

/** Like inAct, and also flushes microtasks, where TanStack schedules resets. */
export async function inActAsync(fn: () => void) {
  await act(async () => {
    fn()
    await Promise.resolve()
  })
}
