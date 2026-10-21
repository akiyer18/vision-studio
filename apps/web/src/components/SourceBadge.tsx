import type { SlotSource } from "../types/slot_source.ts"

const styles: Record<SlotSource, string> = {
  you: "text-lamp",
  detected: "text-dust",
  guessed: "text-dust",
  reference: "text-dust",
}

const labels: Record<SlotSource, string> = {
  you: "You",
  detected: "Detected",
  guessed: "Default",
  reference: "Reference",
}

export function SourceBadge({ source }: { source: SlotSource }) {
  return (
    <span className={`inline-flex rounded-chip px-2 py-0.5 text-xs ${styles[source]}`}>{labels[source]}</span>
  )
}
