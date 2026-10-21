import assert from "node:assert/strict"
import test from "node:test"

import type { RecentDraft } from "./recentIdeas.ts"
import { deleteRecentFrom, missingLayers, readRecentFrom, relativeDate, renameRecentIn, restoreRecentFrom, saveRecentTo, titleFor } from "./recentIdeas.ts"

function memory() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

function draft(id: string, idea: string, extra: Partial<RecentDraft> = {}): RecentDraft {
  return {
    id,
    sessionId: id,
    idea,
    audioOnly: false,
    brief: { slots: { mood: { value: "peaceful", source: "you", reason: "Heard it", confidence: 1 } }, output: ["all_layers"], questions_asked: 1, skipped: [] },
    prompts: [{ layer: "drums", prompt: "soft kit", negative: "vocals", seeds: [1, 2, 3], kb_sources: [] }],
    layers: ["all_layers"],
    renders: [{ layer: "drums", variant: 1, path: `/renders/${id}/drums_v1.wav`, seconds: 8, bpm: 90 }],
    thread: [{ id: 1, text: idea }],
    trace: [{ step: "extract", detail: "mood: peaceful" }],
    status: "ready",
    ...extra,
  }
}

test("save keeps the latest 20, newest first, with a short title", () => {
  const store = memory()
  const first = saveRecentTo(store, draft("a", "a calm morning"), new Date("2026-10-21T10:00:00Z"))
  assert.equal(first.title, "a calm morning")
  assert.equal(first.renders[0]?.path, "/renders/a/drums_v1.wav")

  const long = "a rainy night drive, missing someone at the edge of the city"
  const saved = saveRecentTo(store, draft("b", long), new Date("2026-10-21T11:00:00Z"))
  assert.equal(saved.title, long.slice(0, 40))
  assert.equal(titleFor("", true), "Audio idea")
  const audio = saveRecentTo(store, draft("c", "", { audioOnly: true, thread: [{ id: 1, text: "loop.wav" }] }), new Date("2026-10-21T12:00:00Z"))
  assert.equal(audio.title, "Audio idea")

  for (let index = 0; index < 20; index += 1) {
    saveRecentTo(store, draft(`n${index}`, `idea ${index}`), new Date(Date.UTC(2026, 9, 21, 13, index)))
  }
  const list = readRecentFrom(store)
  assert.equal(list.length, 20)
  assert.equal(list[0]?.id, "n19")
  assert.equal(list.some((item) => item.id === "a"), false)
})

test("restore returns the brief, prompts, layers, and render paths", () => {
  const store = memory()
  saveRecentTo(store, draft("song", "summer festival"), new Date("2026-10-21T10:00:00Z"))
  const restored = restoreRecentFrom(store, "song")
  assert.ok(restored)
  assert.equal(restored.brief.slots.mood?.value, "peaceful")
  assert.equal(restored.prompts[0]?.prompt, "soft kit")
  assert.deepEqual(restored.layers, ["all_layers"])
  assert.deepEqual(restored.renders.map((item) => item.path), ["/renders/song/drums_v1.wav"])
  assert.equal(restored.thread[0]?.text, "summer festival")
  assert.equal(restoreRecentFrom(store, "missing"), null)
})

test("a later save updates the same idea without renaming it", () => {
  const store = memory()
  saveRecentTo(store, draft("song", "calm morning"), new Date("2026-10-21T10:00:00Z"))
  renameRecentIn(store, "song", "Sunday sketch")
  const updated = saveRecentTo(
    store,
    draft("song", "a completely different sentence", {
      brief: { slots: {}, output: ["drums"], questions_asked: 2, skipped: ["style"] },
      layers: ["drums"],
      renders: [],
      thread: [{ id: 1, text: "calm morning" }, { id: 2, text: "drums" }],
    }),
    new Date("2026-10-21T12:00:00Z"),
  )
  assert.equal(updated.title, "Sunday sketch")
  assert.deepEqual(updated.layers, ["drums"])
  assert.equal(readRecentFrom(store).filter((item) => item.id === "song").length, 1)
})

test("delete removes the idea", () => {
  const store = memory()
  saveRecentTo(store, draft("song", "calm morning"))
  saveRecentTo(store, draft("other", "summer"))
  const left = deleteRecentFrom(store, "song")
  assert.deepEqual(left.map((item) => item.id), ["other"])
  assert.equal(restoreRecentFrom(store, "song"), null)
  assert.equal(renameRecentIn(store, "song", "Nope"), null)
})

test("relative dates and missing render files", () => {
  const now = Date.parse("2026-10-21T12:00:00Z")
  assert.equal(relativeDate("2026-10-21T11:59:30Z", now), "Just now")
  assert.equal(relativeDate("2026-10-21T11:00:00Z", now), "1 hour ago")
  assert.equal(relativeDate("2026-10-20T12:00:00Z", now), "Yesterday")
  assert.equal(relativeDate("2026-10-18T12:00:00Z", now), "3 days ago")
  const gone = new Set(["/renders/song/drums_v1.wav"])
  assert.deepEqual(missingLayers([{ layer: "drums", path: "/renders/song/drums_v1.wav" }, { layer: "bass", path: "/renders/song/bass_v1.wav" }], gone), ["drums"])
})
