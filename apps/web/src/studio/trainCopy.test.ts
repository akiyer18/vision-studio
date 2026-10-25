import assert from "node:assert/strict"
import test from "node:test"

import { isTrainExerciseText } from "./trainCopy.ts"

test("the drum exercise prompt is not a Create facet", () => {
  const prompt =
    "Create a 4-bar drum loop at 100 BPM. Kick on beats 1 and 3, snare on beats 2 and 4, with steady eighth-note hi-hats."
  assert.equal(isTrainExerciseText(prompt), true)
  assert.equal(isTrainExerciseText(`Kick: ${prompt}`), true)
})

test("facet labels from kb/facets stay visible", () => {
  assert.equal(isTrainExerciseText("punchy club"), false)
  assert.equal(isTrainExerciseText("distorted industrial"), false)
  assert.equal(isTrainExerciseText("short tight"), false)
})
