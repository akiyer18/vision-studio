import type { OutputChoice } from "../types/output_choice.ts"

export const OUTPUTS: { choice: OutputChoice; label: string }[] = [
  { choice: "drums", label: "Drums" },
  { choice: "chords", label: "Chords" },
  { choice: "bass", label: "Bass" },
  { choice: "melody", label: "Melody" },
  { choice: "texture", label: "Texture" },
  { choice: "all_layers", label: "All layers separately" },
  { choice: "full_mix", label: "Full mix" },
]

export function layerTitle(layer: string): string {
  const words = layer.replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function clipLength(bars: number, bpm: number): string {
  const seconds = Math.round(((bars * 4 * 60) / bpm) * 10) / 10
  return `${bars} bars at ${bpm} BPM, ${seconds.toFixed(1)} s`
}

export function bpmFromPrompt(prompt: string): number | null {
  const matches = [...prompt.matchAll(/(\d+)\s+BPM/g)]
  const last = matches.at(-1)
  return last ? Number(last[1]) : null
}

export function barsFromStructure(structure: string | undefined): number {
  const match = structure?.match(/(\d+)/)
  return match ? Number(match[1]) : 8
}
