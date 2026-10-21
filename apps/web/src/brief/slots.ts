import type { SlotName } from "../types/slot_name.ts"

export const SLOT_ORDER: SlotName[] = [
  "output",
  "mood",
  "energy",
  "world",
  "key",
  "style",
  "palette",
  "structure",
  "must_keep",
]

export const SLOT_LABEL: Record<SlotName, string> = {
  output: "Output",
  mood: "Mood",
  energy: "Energy",
  world: "World",
  key: "Key",
  style: "Style",
  palette: "Palette",
  structure: "Structure",
  must_keep: "Must keep",
}
