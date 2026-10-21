import type { SlotSource } from "../types/slot_source.ts"

const labels: Record<SlotSource, string> = {
  you: "You",
  detected: "Detected",
  guessed: "Default",
  reference: "Reference",
}

export function SourceBadge({ source }: { source: SlotSource }) {
  return (
    <span className="inline-flex rounded-full border border-white/15 px-2 py-0.5 text-xs text-secondary">{labels[source]}</span>
  )
}
