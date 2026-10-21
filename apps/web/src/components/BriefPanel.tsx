import { useEffect, useState } from "react"

import { SLOT_LABEL } from "../brief/slots.ts"
import { useStudio } from "../state/studio.ts"
import type { SlotName } from "../types/slot_name.ts"
import { ChannelStrip } from "./ChannelStrip.tsx"
import { Skeleton } from "./Skeleton.tsx"

const RULER: SlotName[] = ["mood", "energy", "world", "style", "palette", "must_keep"]

export function BriefPanel({ mark = null }: { mark?: string | null }) {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const status = useStudio((state) => state.status)
  const overrides = useStudio((state) => state.overrides)
  const queueOverride = useStudio((state) => state.queueOverride)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const signature = RULER.map((slot) => brief?.slots[slot]?.confidence ?? 0).join(",")

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setLevels(Object.fromEntries(RULER.map((slot) => [slot, brief?.slots[slot]?.confidence ?? 0])))
    })
    return () => cancelAnimationFrame(frame)
  }, [signature, brief])

  const loading = status === "working" && brief === null

  return (
    <div aria-busy={loading || undefined}>
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        {loading ? (
          <>
            <p className="sr-only">The brief is loading.</p>
            {RULER.map((slot) => (
              <Skeleton key={slot} className="h-16 w-28" />
            ))}
          </>
        ) : (
          RULER.map((slot) => {
            const filled = brief?.slots[slot]
            const pending = overrides[slot]
            const value = pending ?? filled?.value ?? ""
            return (
              <div key={slot} data-slot={slot}>
                <ChannelStrip
                  label={SLOT_LABEL[slot]}
                  value={value}
                  source={pending ? "you" : filled?.source}
                  confidence={levels[slot] ?? 0}
                  reason={pending ? "This will go with the next turn." : (filled?.reason ?? "This has not been set.")}
                  onChange={(next) => queueOverride(slot, next)}
                  marked={mark === slot}
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export function TransportMarks({ mark = null }: { mark?: string | null }) {
  return (
    <div className="flex flex-wrap items-end gap-6">
      <SlotMark slot="tempo" mark={mark} />
      <SlotMark slot="key" mark={mark} />
    </div>
  )
}

function SlotMark({ slot, mark }: { slot: "tempo" | "key"; mark: string | null }) {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const overrides = useStudio((state) => state.overrides)
  const queueOverride = useStudio((state) => state.queueOverride)
  const filled = brief?.slots[slot]
  const pending = overrides[slot]
  const value = pending ?? filled?.value ?? ""
  return (
    <div data-slot={slot}>
      <ChannelStrip
        appearance="mark"
        label={SLOT_LABEL[slot]}
        value={value}
        source={pending ? "you" : filled?.source}
        confidence={filled?.confidence ?? 0}
        reason={pending ? "This will go with the next turn." : (filled?.reason ?? "This has not been set.")}
        onChange={(next) => queueOverride(slot, next)}
        marked={mark === slot}
      />
    </div>
  )
}
