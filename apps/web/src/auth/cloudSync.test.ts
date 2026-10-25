import assert from "node:assert/strict"
import test from "node:test"

import { importMarkers } from "./cloudSync.ts"

test("import targets the live localStorage keys", () => {
  const keys = importMarkers()
  assert.equal(keys.ideasKey, "vision-studio-recent")
  assert.equal(keys.trainKey, "vision-studio-train-progress")
})
