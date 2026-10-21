import { inputBridge } from "../input/bridge.ts"
import { transport } from "../playback/transport.ts"
import { renderBusy } from "../studio/renderSession.ts"
import { useStudio } from "../state/studio.ts"
import type { ScenarioId } from "./scenarios.ts"

const OUTPUT_QUESTION = "What would help most right now?"
const KEY_QUESTION = "Any colour in mind for the harmony?"
const STYLE_QUESTION = "Is there an artist or song near this idea?"
const ABOUT_QUESTION = "What is this song about?"

let running = false

export async function runScenario(id: ScenarioId): Promise<void> {
  if (running) throw new Error("A scenario is already running.")
  running = true
  try {
    await until(
      () => useStudio.getState().status !== "working" && !renderBusy(),
      "Wait for the studio to finish, then run the scenario again.",
    )
    transport.stop()
    useStudio.getState().resetSession()
    if (id === "rainy") await rainy()
    else if (id === "loop") await detectedLoop()
    else await summer()
  } finally {
    running = false
  }
}

async function rainy() {
  inputBridge().apply("a rainy night drive, missing someone", null)
  await frames()
  click("Send the idea")
  await expectQuestion(OUTPUT_QUESTION)
  click("all layers separately")
  await expectQuestion(KEY_QUESTION)
  click("Skip this")
  await expectQuestion(STYLE_QUESTION)
  click("Skip all and build")
  await promptsReady(5)
  click("Send to Stable Audio")
  await renderFinished(5)
}

async function detectedLoop() {
  const file = await loadLoop()
  inputBridge().apply("", file)
  await frames()
  click("Send the idea")
  await until(() => findButton("Confirm this reading") !== null, "The reading was not offered for confirmation.")
  if (!pageHas("BPM") || !pageHas("A minor")) throw new Error("The key and tempo should be on screen.")
  click("Confirm this reading")
  await expectQuestion(OUTPUT_QUESTION)
  if (questionCard()?.textContent?.includes(KEY_QUESTION)) throw new Error("The key question should not be asked.")
  const key = useStudio.getState().turn?.brief.slots.key
  if (key?.source !== "detected" || !/a minor/i.test(key.value)) {
    throw new Error("The brief should keep the detected key.")
  }
  if (!pageHas("bpm:")) throw new Error("The trace should show the detected tempo.")
  click("Skip all and build")
  await promptsReady(5)
  click("Send to Stable Audio")
  await renderFinished(5)
}

async function summer() {
  inputBridge().apply("summer", null)
  await frames()
  click("Send the idea")
  await expectQuestion(OUTPUT_QUESTION)
  if (questionCard()?.textContent?.includes(ABOUT_QUESTION)) {
    throw new Error("One word should still build, without the empty-input question.")
  }
  click("Skip all and build")
  await promptsReady(5)
  click("Send to Stable Audio")
  await renderFinished(5)
}

async function loadLoop(): Promise<File> {
  const response = await fetch(new URL("/fixtures/detected-loop.wav", window.location.origin))
  if (!response.ok) throw new Error("The demo loop did not load from this app.")
  const blob = await response.blob()
  return new File([blob], "detected-loop.wav", { type: "audio/wav" })
}

async function promptsReady(count: number) {
  await until(() => {
    const turn = useStudio.getState().turn
    const prompts = turn?.prompts ?? []
    return turn?.status === "ready" && prompts.length >= count && prompts.every((item) => item.prompt.trim().length > 0)
  }, "The prompts did not fill in.")
  await until(() => findButton("Send to Stable Audio") !== null, "Send to Stable Audio did not appear.")
}

async function renderFinished(layers: number) {
  await until(
    () => document.querySelectorAll("[data-variant]").length >= layers * 3,
    "The variations did not land.",
    90000,
  )
  await until(() => {
    const state = useStudio.getState()
    return state.status !== "working" && Object.keys(state.runs).length === 0
  }, "The render did not finish.", 90000)
  const state = useStudio.getState()
  if (state.renders.length !== layers * 3) throw new Error("Each layer should have three variations.")
  if (Object.keys(state.failures).length > 0) throw new Error("A layer failed to render.")
  for (const layer of state.layerOrder) {
    if (state.takes[layer] !== 1) throw new Error("The first render should stay on take 1.")
  }
}

async function expectQuestion(text: string) {
  await until(() => questionCard()?.textContent?.includes(text) ?? false, `Missing the question: ${text}`)
}

function questionCard(): Element | null {
  return document.querySelector("article[aria-live='polite']")
}

function pageHas(text: string): boolean {
  return document.body.textContent?.includes(text) ?? false
}

function findButton(label: string): HTMLButtonElement | null {
  for (const button of document.querySelectorAll("button")) {
    if (button.textContent?.trim() === label && !button.disabled) return button
  }
  return null
}

function click(label: string) {
  const button = findButton(label)
  if (!button) throw new Error(`Missing the ${label} button.`)
  button.click()
}

function frames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function until(check: () => boolean, message: string, ms = 20000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    function tick() {
      if (check()) {
        resolve()
        return
      }
      if (Date.now() - start > ms) {
        reject(new Error(message))
        return
      }
      window.setTimeout(tick, 40)
    }
    tick()
  })
}
