import type { SlotSource } from "../types/slot_source.ts"

const styles: Record<SlotSource, string> = {
  you: "bg-vu-amber/15 text-vu-amber",
  detected: "bg-tape-cream/10 text-tape-cream",
  guessed: "bg-signal-violet/15 text-signal-violet",
  reference: "bg-dust/15 text-dust",
}

const labels: Record<SlotSource, string> = {
  you: "You",
  detected: "Detected",
  guessed: "Guessed",
  reference: "Reference",
}

export function SourceBadge({ source }: { source: SlotSource }) {
  return (
    <span className={`inline-flex rounded-chip px-2 py-0.5 text-xs ${styles[source]}`}>{labels[source]}</span>
  )
}
