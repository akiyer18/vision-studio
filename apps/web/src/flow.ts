import { features } from "./features.ts"

export type FlowStep = "idea" | "questions" | "prompt" | "sound" | "export"

export const FLOW: { id: FlowStep; name: string }[] = [
  { id: "idea", name: "Idea" },
  { id: "questions", name: "Questions" },
  { id: "prompt", name: "Prompt" },
  { id: "sound", name: "Sound" },
  { id: "export", name: "Export" },
]

type Snapshot = {
  turn: { status: string } | null
  status: string
  renders: readonly unknown[]
  layerOrder: readonly unknown[]
  exportListing: unknown
  heard: boolean
}

export function flowStep(state: Snapshot): FlowStep {
  if (state.exportListing) return "export"
  const rendering = state.status === "working" && state.layerOrder.length > 0
  if (state.renders.length > 0 || rendering) return state.heard ? "export" : "sound"
  if (state.turn?.status === "ready") return "prompt"
  if (state.turn) return "questions"
  return "idea"
}

export function stepLine(id: FlowStep): string {
  if (id === "idea") {
    return features.record ? "Describe a feeling, or bring a sound." : "Describe a feeling, or drop a sound."
  }
  if (id === "questions") return "Answer a few, or skip them all."
  if (id === "prompt") return "Choose the layers, then build."
  if (id === "sound") return "Listen, pick a take, or try another."
  return "Send the chosen takes to Logic."
}

export function tourBody(id: FlowStep): string {
  const line = stepLine(id)
  if (id === "idea" && features.demo) return `${line} A 30 second demo is there if you want one.`
  if (id === "prompt" && features.fullMix) return `${line} Full mix is one of the choices.`
  if (id === "sound" && features.soloMute) return `${line} Solo and mute sit on each lane.`
  return line
}
