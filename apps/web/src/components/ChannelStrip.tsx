import { useId, useState } from "react"

import type { SlotSource } from "../types/slot_source.ts"
import { SourceBadge } from "./SourceBadge.tsx"
import { VuMeter } from "./VuMeter.tsx"

type Props = {
  label: string
  value: string
  source?: SlotSource
  confidence: number
  reason: string
  onChange?: (value: string) => void
  appearance?: "cell" | "mark"
  meter?: boolean
  marked?: boolean
}

export function ChannelStrip({
  label,
  value,
  source,
  confidence,
  reason,
  onChange,
  appearance = "cell",
  meter = false,
  marked = false,
}: Props) {
  const reasonId = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const large = appearance === "mark"
  const ring = marked ? "outline outline-2 outline-offset-2 outline-lamp" : ""

  function commit() {
    setEditing(false)
    if (draft !== value) onChange?.(draft)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  return (
    <div className={`group relative min-w-0 ${ring}`}>
      <div className={large ? "flex items-end gap-3" : "flex items-start justify-between gap-2"}>
        <div className="min-w-0">
          <p className="text-dust">{label}</p>
          {editing ? (
            <input
              className={`mt-1 w-full bg-transparent text-lamp outline-none ${large ? "tempo-mark" : ""}`}
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
              className={`mt-1 text-left text-lamp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp ${large ? "tempo-mark" : "break-words"}`}
              onClick={() => {
                setDraft(value)
                setEditing(true)
              }}
            >
              {value ? (
                value
              ) : (
                <>
                  <span className="mt-2 block h-px w-8 bg-rule" />
                  <span className="sr-only">Not set</span>
                </>
              )}
            </button>
          )}
        </div>
        {meter ? <VuMeter value={confidence} label={`${label} confidence`} /> : null}
      </div>
      {source ? <SourceBadge source={source} /> : null}
      <p id={reasonId} className="sr-only">
        {reason}
      </p>
      <p
        aria-hidden
        className="pointer-events-none absolute top-full left-0 z-20 mt-2 hidden w-56 max-w-[calc(100vw-2rem)] border border-rule bg-desk p-3 text-dust group-focus-within:block group-hover:block"
      >
        {reason}
      </p>
    </div>
  )
}
