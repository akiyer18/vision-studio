import { ApiError, exportSession, folderPath, regenerateEvents, renderEvents } from "../api/client.ts"
import type { RenderEvent } from "../api/client.ts"
import { useStudio } from "../state/studio.ts"
import type { RenderAction } from "../state/studio.ts"
import { audibleLayers } from "./mix.ts"

let busy = false

export function renderBusy(): boolean {
  return busy
}

export async function renderCurrent(layer?: string): Promise<void> {
  if (busy) return
  const prompts = currentPrompts(layer)
  if (prompts.length === 0) return
  busy = true
  const sessionId = useStudio.getState().sessionId
  if (layer) useStudio.getState().beginLayer(layer, "render")
  else useStudio.getState().beginRender(prompts.map((item) => item.layer))
  const token = useStudio.getState().streamToken
  try {
    await renderEvents({ session_id: sessionId, prompts, layer }, (event) => {
      if (useStudio.getState().streamToken === token) apply(event, "render")
    })
  } catch (error) {
    if (useStudio.getState().streamToken === token) failOpen(calm(error), "render")
  } finally {
    busy = false
    if (useStudio.getState().streamToken === token) useStudio.getState().finishRun()
  }
}

export async function regenerateLayer(layer: string): Promise<void> {
  if (busy) return
  busy = true
  const sessionId = useStudio.getState().sessionId
  useStudio.getState().beginLayer(layer, "regenerate")
  const token = useStudio.getState().streamToken
  try {
    await regenerateEvents({ session_id: sessionId, layer }, (event) => {
      if (useStudio.getState().streamToken === token) apply(event, "regenerate")
    })
  } catch (error) {
    if (useStudio.getState().streamToken === token) failOpen(calm(error), "regenerate")
  } finally {
    busy = false
    if (useStudio.getState().streamToken === token) useStudio.getState().finishRun()
  }
}

export async function exportCurrent(): Promise<void> {
  if (busy) return
  const state = useStudio.getState()
  if (Object.keys(state.runs).length > 0) return
  busy = true
  const defaults = Object.keys(state.picks).length === 0
  try {
    const response = await exportSession({
      session_id: state.sessionId,
      picks: defaults ? undefined : state.picks,
    })
    useStudio.getState().setExport({ folder: folderPath(response.files), files: response.files, defaults })
  } catch (error) {
    useStudio.getState().setExportError(calm(error))
  } finally {
    busy = false
  }
}

function currentPrompts(layer?: string) {
  const { turn, promptEdits } = useStudio.getState()
  const prompts = turn?.status === "ready" ? (turn.prompts ?? []) : []
  const mapped = prompts.map((item) => ({
    layer: item.layer,
    prompt: promptEdits[item.layer]?.prompt ?? item.prompt,
    negative: promptEdits[item.layer]?.negative ?? item.negative,
  }))
  if (layer) return mapped.filter((item) => item.layer === layer)
  const heard = new Set(audibleLayers(mapped.map((item) => item.layer)))
  return mapped.filter((item) => heard.has(item.layer))
}

function apply(event: RenderEvent, action: RenderAction) {
  const store = useStudio.getState()
  if (event.kind === "progress") {
    store.noteProgress(event.layer, { take: event.take, variant: event.variant, total: event.total })
    return
  }
  if (event.kind === "layer") {
    const layer = event.results[0]?.layer
    if (layer) store.finishLayer(layer, event.results, event.take)
    return
  }
  if (event.kind === "error") store.failLayer(event.layer, { message: event.message, action })
}

function failOpen(message: string, action: RenderAction) {
  const { runs, failLayer } = useStudio.getState()
  for (const layer of Object.keys(runs)) failLayer(layer, { message, action })
}

function calm(error: unknown): string {
  const message = error instanceof ApiError ? error.message : "That did not go through. Try again."
  const text = message.trim()
  return text.length > 0 && text.length < 160 ? text : "That did not go through. Try again."
}
