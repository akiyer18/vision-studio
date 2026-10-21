import { useEffect, useState } from "react"

import { SLOT_LABEL, SLOT_ORDER } from "../brief/slots.ts"
import { useStudio } from "../state/studio.ts"
import type { SlotName } from "../types/slot_name.ts"
import { ChannelStrip } from "./ChannelStrip.tsx"

const emptyLevels = Object.fromEntries(SLOT_ORDER.map((slot) => [slot, 0])) as Record<SlotName, number>

export function BriefPanel() {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const overrides = useStudio((state) => state.overrides)
  const queueOverride = useStudio((state) => state.queueOverride)
  const [levels, setLevels] = useState<Record<SlotName, number>>(emptyLevels)
  const signature = SLOT_ORDER.map((slot) => brief?.slots[slot]?.confidence ?? 0).join(",")

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setLevels(
        Object.fromEntries(SLOT_ORDER.map((slot) => [slot, brief?.slots[slot]?.confidence ?? 0])) as Record<SlotName, number>,
      )
    })
    return () => cancelAnimationFrame(frame)
  }, [signature, brief])

  return (
    <div>
      <h2 className="font-serif text-xl">Brief</h2>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-16">
        {SLOT_ORDER.map((slot) => {
          const filled = brief?.slots[slot]
          const pending = overrides[slot]
          const value = pending ?? filled?.value ?? ""
          return (
            <ChannelStrip
              key={slot}
              label={SLOT_LABEL[slot]}
              value={value}
              source={pending ? "you" : filled?.source}
              confidence={levels[slot] ?? 0}
              reason={pending ? "This will go with the next turn." : (filled?.reason ?? "This has not been set.")}
              onChange={(next) => queueOverride(slot, next)}
            />
          )
        })}
      </div>
    </div>
  )
}
