import { useEffect, useState } from "react"

import { SLOT_LABEL } from "../brief/slots.ts"
import { useStudio } from "../state/studio.ts"
import type { SlotName } from "../types/slot_name.ts"
import { ChannelStrip } from "./ChannelStrip.tsx"

const SHOWN: SlotName[] = ["mood", "energy", "world", "key", "tempo", "style", "palette", "structure", "must_keep"]

export function BriefPanel({ mark = null }: { mark?: string | null }) {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const overrides = useStudio((state) => state.overrides)
  const queueOverride = useStudio((state) => state.queueOverride)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const filled = SHOWN.filter((slot) => Boolean(overrides[slot] ?? brief?.slots[slot]?.value))
  const signature = SHOWN.map(
    (slot) => `${slot}:${overrides[slot] ?? brief?.slots[slot]?.value ?? ""}:${brief?.slots[slot]?.confidence ?? 0}`,
  ).join("|")

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const next: Record<string, number> = {}
      for (const slot of SHOWN) {
        if (!(overrides[slot] ?? brief?.slots[slot]?.value)) continue
        next[slot] = brief?.slots[slot]?.confidence ?? 0
      }
      setLevels(next)
    })
    return () => cancelAnimationFrame(frame)
  }, [signature, brief, overrides])

  return (
    <div>
      <h2>Brief</h2>
      {filled.length === 0 ? <p className="mt-2 text-dust">Slots appear here as they are filled.</p> : null}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-4">
        {filled.map((slot) => {
          const value = brief?.slots[slot]
          const pending = overrides[slot]
          const text = pending ?? value?.value ?? ""
          return (
            <div key={slot} data-slot={slot}>
              <ChannelStrip
                label={SLOT_LABEL[slot]}
                value={text}
                source={pending ? "you" : value?.source}
                confidence={levels[slot] ?? 0}
                reason={pending ? "This will go with the next turn." : (value?.reason ?? "This has not been set.")}
                onChange={(next) => queueOverride(slot, next)}
                appearance={slot === "tempo" || slot === "key" ? "mark" : "cell"}
                marked={mark === slot}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
