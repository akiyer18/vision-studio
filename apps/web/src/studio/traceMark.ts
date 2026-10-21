import { SLOT_LABEL } from "../brief/slots.ts"
import type { SlotName } from "../types/slot_name.ts"
import type { TraceStep } from "../types/trace_step.ts"
import { LANES } from "./lanes.ts"

const SLOTS: SlotName[] = ["mood", "energy", "world", "style", "palette", "must_keep", "structure", "key", "tempo", "output"]

export function traceTarget(step: TraceStep): string | null {
  const text = `${step.step} ${step.detail}`
  for (const layer of LANES) {
    const name = layer.replaceAll("_", " ")
    if (hasWord(text, name)) return layer
  }
  for (const slot of SLOTS) {
    const label = SLOT_LABEL[slot]
    if (hasWord(text, label) || hasWord(text, slot.replaceAll("_", " "))) return slot
  }
  return null
}

export function polishNote(steps: TraceStep[], layer: string): string | null {
  const name = layer.replaceAll("_", " ")
  for (const step of [...steps].reverse()) {
    const detail = step.detail
    if (detail === `Claude polished the ${name} prompt`) return "Claude polished"
    const kept = `Kept the template for the ${name} prompt`
    if (detail.startsWith(kept)) {
      const reason = detail.slice(kept.length).replace(/^:\s*/, "")
      return reason ? `Template kept: ${reason}` : "Template kept"
    }
  }
  return null
}

function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`, "i").test(text)
}
