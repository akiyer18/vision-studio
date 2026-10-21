import type { SlotSource } from "../types/slot_source.ts"

const labels: Record<SlotSource, string> = {
  you: "you",
  detected: "detected",
  guessed: "default",
  reference: "reference",
}

export function SourceBadge({ source, reason }: { source: SlotSource; reason?: string }) {
  return (
    <span className={`source-tag ${source === "detected" ? "is-detected" : ""}`} title={reason}>
      {labels[source]}
    </span>
  )
}
