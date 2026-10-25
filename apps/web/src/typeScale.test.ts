import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8")
const rootPx = 16 * 1.125

function block(start: string, end: string): string {
  const from = css.indexOf(start)
  const to = css.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from)
  return css.slice(from, to)
}

function rem(source: string, name: string): number {
  const match = source.match(new RegExp(`--${name}:\\s*([0-9.]+)rem`))
  assert.ok(match, name)
  return Number(match[1])
}

function px(value: number): number {
  return value * rootPx
}

test("the root is 112.5 percent and the desktop scale hits the type sizes", () => {
  assert.match(css, /html\s*\{[^}]*font-size:\s*112\.5%/)
  const root = block(":root {", "@theme")
  assert.ok(Math.abs(px(rem(root, "text-page")) - 36) < 0.05)
  assert.ok(Math.abs(px(rem(root, "text-card")) - 19) < 0.05)
  assert.ok(Math.abs(px(rem(root, "text-body")) - 17) < 0.05)
  assert.ok(Math.abs(px(rem(root, "text-label")) - 15) < 0.05)
  assert.ok(Math.abs(px(rem(root, "text-small")) - 15) < 0.05)
  for (const name of ["text-hero", "text-page", "text-section", "text-card", "text-body", "text-nav", "text-label", "text-small", "text-readout"]) {
    assert.ok(px(rem(root, name)) >= 15, name)
  }
})

test("the narrow scale stays at least 15px", () => {
  const mobile = block("@media (max-width: 767px)", "@media (max-width: 1023px)")
  for (const name of ["text-hero", "text-page", "text-section", "text-card", "text-body", "text-nav", "text-label", "text-small", "text-readout"]) {
    assert.ok(px(rem(mobile, name)) >= 15, name)
  }
})

test("narrow layouts stack the home grids and clip sideways overflow", () => {
  const columns = css.indexOf(".home-room-board,\n.home-people {\n  grid-template-columns: repeat(3, minmax(0, 1fr));")
  const stack = css.lastIndexOf(".home-room-board,\n  .home-people,\n  .home-skills {\n    grid-template-columns: 1fr;")
  assert.ok(columns > 0)
  assert.ok(stack > columns)
  const narrow = block("@media (max-width: 1023px) {\n  html", ".studio-shell {")
  assert.match(narrow, /overflow-x:\s*clip/)
})
