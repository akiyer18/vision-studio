import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workflow = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8")

test("CI runs lint, typecheck, tests, and the build on every push", () => {
  assert.match(workflow, /push:/)
  for (const step of ["make lint", "make typecheck", "make test", "make build"]) {
    assert.ok(workflow.includes(step), step)
  }
})
