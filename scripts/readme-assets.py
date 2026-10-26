#!/usr/bin/env python3
"""Captures the README images in .github/assets from the playground.

Every frame is a screenshot of the real playground in a browser, driven with
chrome-devtools-axi. Pillow adds the pointer and key captions and writes the
banner (PNG) and the demos (animated WebP).

Needs chrome-devtools-axi and Python 3 with Pillow. Serve the production build
first, then run this from the repository root:

  pnpm --filter @sheetcn/playground build
  pnpm --filter @sheetcn/playground preview --port 4173
  python3 scripts/readme-assets.py http://localhost:4173
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173").rstrip("/")
OUT = Path(__file__).resolve().parent.parent / ".github" / "assets"
TMP = Path(tempfile.mkdtemp(prefix="sheetcn-readme-"))
ENV = {**os.environ, "CHROME_DEVTOOLS_AXI_SESSION": "sheetcn-readme-assets"}

# Demo frames are captured at twice this size and scaled to DEMO_WIDTH.
DEMO_VIEWPORT = (1040, 560)
DEMO_WIDTH = 1280

# Page helpers: pointer events at cell centers, as a mouse would send them.
HELPERS = """() => {
  const grid = document.querySelector("[role=grid]")
  const cell = (r, c) =>
    c < 0
      ? document.querySelector(`.gutter[data-row-index="${r}"]`)
      : r < 0
        ? document.querySelector(`.head-cell[data-column-index="${c}"]`)
        : document.querySelector(
            `.cell[data-row-index="${r}"][data-column-index="${c}"]`
          )
  const at = (r, c) => {
    const box = cell(r, c).getBoundingClientRect()
    return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
  }
  const send = (type, p, mods = {}) => {
    const target = document.elementFromPoint(p.x, p.y)
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 1, pointerType: "mouse", isPrimary: true,
        button: 0, buttons: type === "pointerup" ? 0 : 1,
        clientX: p.x, clientY: p.y, ...mods,
      })
    )
    if (type === "pointerdown") {
      target.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true, cancelable: true, button: 0,
          clientX: p.x, clientY: p.y, ...mods,
        })
      )
    }
    return p
  }
  window.__demo = {
    at,
    down: (r, c, mods) => send("pointerdown", at(r, c), mods),
    move: (r, c) => send("pointermove", at(r, c)),
    up: (r, c) => send("pointerup", at(r, c)),
    scrollTo: (top) => { grid.scrollTop = top; return top },
  }
  return true
}"""


def axi(*args):
    done = subprocess.run(
        ["chrome-devtools-axi", *args], env=ENV, capture_output=True, text=True
    )
    if done.returncode != 0:
        sys.exit(f"chrome-devtools-axi {' '.join(args)} failed:\n{done.stdout}{done.stderr}")
    return done.stdout


def js(code):
    """Evaluates code in the page and returns its JSON value."""
    out = axi("eval", code)
    for line in out.splitlines():
        if line.startswith("result: "):
            raw = line[len("result: ") :]
            if raw == "undefined":
                return None
            value = json.loads(raw)
            return json.loads(value) if isinstance(value, str) else value
    sys.exit(f"eval returned no result:\n{code}\n{out}")


def wait_frames(n=2):
    js(f"new Promise((done) => {{ let n = {n}; const f = () => (--n ? requestAnimationFrame(f) : done(true)); requestAnimationFrame(f) }})")


def open_playground(scheme, viewport):
    axi("emulate", "--color-scheme", scheme, "--viewport", f"{viewport[0]}x{viewport[1]}x2")
    axi("open", f"{URL}/")
    js("new Promise((done) => { const f = () => (document.querySelector('[role=gridcell]') ? done(true) : setTimeout(f, 50)); f() })")
    js(HELPERS)
    # Keyboard focus on the active cell, as after a click.
    js("document.querySelector('.cell[tabindex=\"0\"]').focus()")
    wait_frames()


def font(size, bold=False):
    names = (
        ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"]
        + ["/usr/share/fonts/truetype/dejavu/DejaVuSans" + ("-Bold" if bold else "") + ".ttf"]
    )
    for name in names:
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default(size)


CURSOR = [(0, 0), (0, 17), (4.5, 13), (7.5, 20), (10, 19), (7, 12), (12.5, 12)]


def draw_cursor(image, point, scale):
    draw = ImageDraw.Draw(image)
    x, y = point
    shape = [(x + px * scale, y + py * scale) for px, py in CURSOR]
    draw.polygon(shape, fill="black", outline="white", width=max(1, round(scale)))


def draw_caption(image, text, dark):
    draw = ImageDraw.Draw(image)
    size = round(image.width / 50)
    face = font(size)
    box = draw.textbbox((0, 0), text, font=face)
    w, h = box[2] - box[0], box[3] - box[1]
    pad_x, pad_y = size, round(size * 0.6)
    x0 = (image.width - w) / 2 - pad_x
    y0 = image.height - h - 2 * pad_y - round(size * 1.6)
    fill, ink = ((250, 250, 250), (24, 24, 27)) if dark else ((24, 24, 27), (250, 250, 250))
    draw.rounded_rectangle(
        (x0, y0, x0 + w + 2 * pad_x, y0 + h + 2 * pad_y), radius=size * 0.7, fill=fill
    )
    draw.text((x0 + pad_x - box[0], y0 + pad_y - box[1]), text, font=face, fill=ink)


class Demo:
    def __init__(self, name, dark=False):
        self.name, self.dark, self.frames = name, dark, []

    def shot(self, ms, caption=None, pointer=None):
        wait_frames()
        path = TMP / f"{self.name}-{len(self.frames):03d}.png"
        axi("screenshot", str(path))
        self.frames.append((path, ms, caption, pointer))

    def save(self):
        images, durations = [], []
        for path, ms, caption, pointer in self.frames:
            image = Image.open(path).convert("RGB")
            if pointer:
                draw_cursor(image, (pointer["x"] * 2, pointer["y"] * 2), 2)
            image = image.resize(
                (DEMO_WIDTH, round(image.height * DEMO_WIDTH / image.width)),
                Image.Resampling.LANCZOS,
            )
            if caption:
                draw_caption(image, caption, self.dark)
            images.append(image)
            durations.append(ms)
        out = OUT / f"{self.name}.webp"
        images[0].save(
            out, save_all=True, append_images=images[1:], duration=durations,
            loop=0, quality=82, method=6, minimize_size=True,
        )
        print(f"{out.relative_to(OUT.parent.parent)}: {len(images)} frames, {out.stat().st_size // 1024} KB")


def press(key, demo, caption, ms=700):
    axi("press", key)
    demo.shot(ms, caption)


def banner():
    # The same view in both themes, split on a slant: light left, dark right.
    shots = []
    for scheme in ("light", "dark"):
        open_playground(scheme, (1200, 600))
        top = 48210  # the first row under the header
        js(f"__demo.scrollTo({top} * 32)")
        wait_frames(3)
        r = top + 3
        js(f"__demo.down({r}, 2)")
        js(f"__demo.move({r + 5}, 5)")
        js(f"__demo.up({r + 5}, 5)")
        path = TMP / f"banner-{scheme}.png"
        wait_frames()
        axi("screenshot", str(path))
        shots.append(Image.open(path).convert("RGB"))

    light, dark = shots
    w, h = light.size
    slant = w * 0.06
    split = Image.new("L", (w, h), 0)
    ImageDraw.Draw(split).polygon(
        [(w / 2 + slant, 0), (w, 0), (w, h), (w / 2 - slant, h)], fill=255
    )
    view = Image.composite(dark, light, split)

    radius, border = 24, 2
    canvas = Image.new("RGBA", (w + 2 * border, h + 2 * border), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).rounded_rectangle(
        (0, 0, w + 2 * border - 1, h + 2 * border - 1),
        radius=radius + border,
        fill=(161, 161, 170, 255),
    )
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    canvas.paste(view, (border, border), mask)
    out = OUT / "banner.png"
    canvas.save(out, optimize=True)
    print(f"{out.relative_to(OUT.parent.parent)}: {canvas.size[0]}x{canvas.size[1]}, {out.stat().st_size // 1024} KB")


def selection_demo():
    demo = Demo("selection")
    open_playground("light", DEMO_VIEWPORT)
    demo.shot(600)
    p = js("__demo.down(1, 1)")
    demo.shot(300, "Drag to select", p)
    for r, c in [(2, 1), (2, 2), (3, 2), (4, 3), (5, 3)]:
        p = js(f"__demo.move({r}, {c})")
        demo.shot(110, "Drag to select", p)
    p = js("__demo.up(5, 3)")
    demo.shot(900, "Drag to select", p)
    p = js("__demo.down(7, 4, { shiftKey: true })")
    js("__demo.up(7, 4)")
    demo.shot(1100, "Shift + click extends", p)
    p = js("__demo.down(2, 6, { ctrlKey: true })")
    demo.shot(90, "Ctrl or Cmd + drag adds a range", p)
    for r, c in [(3, 6), (4, 7), (5, 7), (6, 7), (7, 7), (8, 7)]:
        p = js(f"__demo.move({r}, {c})")
        demo.shot(90, "Ctrl or Cmd + drag adds a range", p)
    js("__demo.up(8, 7)")
    demo.shot(1200, "Ctrl or Cmd + drag adds a range", p)
    p = js("__demo.down(-1, 5)")
    js("__demo.up(-1, 5)")
    demo.shot(1100, "Click a header to select the column", p)
    p = js("__demo.down(7, -1)")
    demo.shot(110, "Drag row numbers to select rows", p)
    for r in (8, 9):
        p = js(f"__demo.move({r}, -1)")
        demo.shot(110, "Drag row numbers to select rows", p)
    js("__demo.up(9, -1)")
    demo.shot(1300, "Drag row numbers to select rows", p)
    demo.save()


def keyboard_demo():
    demo = Demo("keyboard")
    open_playground("light", DEMO_VIEWPORT)
    demo.shot(700)
    press("ArrowDown", demo, "Arrow keys move", 350)
    press("ArrowDown", demo, "Arrow keys move", 350)
    press("ArrowRight", demo, "Arrow keys move", 350)
    press("ArrowRight", demo, "Arrow keys move", 350)
    press("ArrowRight", demo, "Arrow keys move", 350)
    press("ArrowRight", demo, "Arrow keys move", 600)
    caption = "Type to replace the value"
    for i, ch in enumerate("349.5"):
        axi("press", ch)
        demo.shot(260 if i < 4 else 700, caption)
    press("Enter", demo, "Enter commits and moves down", 1000)
    press("Enter", demo, "Enter edits, keeping the value", 900)
    axi("press", "Backspace")
    axi("press", "Backspace")
    demo.shot(500, "Enter edits, keeping the value")
    axi("press", "x")
    demo.shot(600, "Enter edits, keeping the value")
    press("Enter", demo, "A value that does not parse is held back", 1600)
    press("Escape", demo, "Escape cancels the edit", 1100)
    for key in ("Shift+ArrowDown", "Shift+ArrowDown", "Shift+ArrowRight"):
        press(key, demo, "Shift + arrows extend the selection", 300)
    demo.shot(500, "Shift + arrows extend the selection")
    press("Control+z", demo, "Ctrl or Cmd + Z undoes", 1100)
    press("Control+Shift+z", demo, "Ctrl or Cmd + Shift + Z redoes", 1300)
    demo.save()


def scroll_demo():
    demo = Demo("scroll")
    open_playground("light", DEMO_VIEWPORT)
    demo.shot(800, "100,000 rows, only the visible ones are in the page")
    steps = 11
    for i in range(1, steps + 1):
        js(f"__demo.scrollTo({round(60_000 * 32 * (i / steps) ** 2)})")
        demo.shot(100, "Scroll")
    demo.shot(700, "Scroll")
    press("Control+ArrowDown", demo, "Ctrl or Cmd + arrow jumps to the edge of the data", 1500)
    press("Control+Home", demo, "Ctrl or Cmd + Home goes back to the first cell", 1400)
    demo.save()


def boolean_demo():
    demo = Demo("boolean")
    open_playground("light", DEMO_VIEWPORT)
    js("document.querySelector('[role=grid]').scrollLeft = 640")
    wait_frames()
    p = js("__demo.down(0, 9)")
    js("__demo.up(0, 9)")
    js("document.querySelector('.cell[tabindex=\"0\"]').focus()")
    demo.shot(800, "A boolean column", p)
    press(" ", demo, "Space toggles", 800)
    press("ArrowDown", demo, "Space toggles", 300)
    press(" ", demo, "Space toggles", 800)
    press("ArrowDown", demo, "Space toggles", 300)
    press("ArrowDown", demo, "Space toggles", 300)
    press(" ", demo, "Space toggles", 900)
    press("ArrowDown", demo, "Enter toggles too", 300)
    press("Enter", demo, "Enter toggles too", 900)
    press("ArrowDown", demo, "Typing does nothing here", 300)
    axi("press", "q")
    demo.shot(900, "Typing does nothing here")
    for _ in range(4):
        press("Control+z", demo, "Each toggle is one undo step", 450)
    demo.shot(900, "Each toggle is one undo step")
    demo.save()


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    steps = [banner, selection_demo, keyboard_demo, scroll_demo, boolean_demo]
    only = sys.argv[2:]  # optional: step names, such as keyboard_demo
    axi("start")
    axi("selectpage", "1")
    try:
        for step in steps:
            if not only or step.__name__ in only:
                step()
    finally:
        axi("stop")
