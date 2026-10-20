import { useId, useState } from "react"

import type { SlotSource } from "../types/slot_source.ts"
import { SourceBadge } from "./SourceBadge.tsx"
import { VuMeter } from "./VuMeter.tsx"

type Props = {
  label: string
  value: string
  source: SlotSource
  confidence: number
  reason: string
  onChange?: (value: string) => void
}

export function ChannelStrip({ label, value, source, confidence, reason, onChange }: Props) {
  const reasonId = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function commit() {
    setEditing(false)
    if (draft !== value) onChange?.(draft)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  return (
    <div className="group relative flex w-36 max-w-full shrink-0 flex-col gap-3 rounded-panel border border-walnut-line bg-walnut-glass p-3 backdrop-blur-[24px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-dust">{label}</p>
          {editing ? (
            <input
              className="mt-1 w-full bg-transparent font-serif text-2xl leading-tight text-tape-cream outline-none"
              value={draft}
              aria-label={`Edit ${label}`}
              aria-describedby={reasonId}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur()
                if (event.key === "Escape") cancel()
              }}
            />
          ) : (
            <button
              type="button"
              aria-describedby={reasonId}
              className="mt-1 text-left font-serif text-2xl leading-tight break-words text-tape-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
              onClick={() => {
                setDraft(value)
                setEditing(true)
              }}
            >
              {value || "Not set"}
            </button>
          )}
        </div>
        <VuMeter value={confidence} label={`${label} confidence`} />
      </div>
      <SourceBadge source={source} />
      <p id={reasonId} className="sr-only">
        {reason}
      </p>
      <p
        aria-hidden
        className="pointer-events-none absolute top-full left-0 z-20 mt-2 hidden w-56 max-w-[calc(100vw-2rem)] rounded-button border border-walnut-line bg-studio-night p-3 text-sm text-dust group-focus-within:block group-hover:block"
      >
        {reason}
      </p>
    </div>
  )
}
