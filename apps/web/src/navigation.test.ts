import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { features } from "./features.ts"
import { showBuildTip, visibleRooms } from "./navigation.ts"

test("the sidebar lists Home, Train, Create, and Analyse", () => {
  assert.equal(features.genre, false)
  assert.equal(features.edits, false)
  assert.equal(features.analyser, true)
  assert.deepEqual(
    visibleRooms(features).map((item) => item.label),
    ["Home", "Train", "Create", "Analyse"],
  )
  assert.deepEqual(
    visibleRooms(features).map((item) => item.path),
    ["/", "/train", "/create", "/analyse"],
  )
})

test("Genres and Tweak have no links while their flags are off", () => {
  const paths = visibleRooms(features).map((item) => item.path).join(" ")
  assert.equal(paths.includes("/genres"), false)
  assert.equal(paths.includes("/tweak"), false)
  const sidebar = readFileSync(new URL("./components/sidebar/Sidebar.tsx", import.meta.url), "utf8")
  const home = readFileSync(new URL("./components/layout/Home.tsx", import.meta.url), "utf8")
  assert.equal(sidebar.includes("Genres"), false)
  assert.equal(sidebar.includes("Tweak"), false)
  assert.equal(home.includes("/genres"), false)
  assert.equal(home.includes("Tweak"), false)
})

test("the Build now tip is only for Create", () => {
  assert.equal(showBuildTip("create"), true)
  for (const page of ["home", "train", "analyse", "genre"]) {
    assert.equal(showBuildTip(page), false)
  }
})
