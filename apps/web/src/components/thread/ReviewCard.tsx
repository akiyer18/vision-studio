import { useState, type ReactNode } from "react"

import { ApiError } from "../../api/client.ts"
import { SLOT_LABEL, SLOT_ORDER } from "../../brief/slots.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { inFlight } from "../../conversation/flight.ts"
import { layerTitle } from "../../studio/output.ts"
import { useStudio } from "../../state/studio.ts"
import type { SlotName } from "../../types/slot_name.ts"
import type { SlotValue } from "../../types/slot_value.ts"
import { Button } from "../Button.tsx"

const LOCKED: SlotName[] = ["tempo", "key", "progression", "structure", "palette", "sound", "meter"]

export function ReviewCard() {
  const brief = useStudio((state) => state.turn?.brief)
  const working = useStudio((state) => state.status === "working")
  const [error, setError] = useState<string | null>(null)
  if (!brief) return null
  const locked = SLOT_ORDER.filter((name) => LOCKED.includes(name) && brief.slots[name]?.source === "you")
  const chosen = SLOT_ORDER.filter((name) => brief.slots[name]?.source === "you" && !locked.includes(name))
  const defaults = SLOT_ORDER.filter((name) => {
    return brief.slots[name]?.source === "guessed"
  })
  const rest = SLOT_ORDER.filter((name) => {
    const slot = brief.slots[name]
    return slot && !locked.includes(name) && !chosen.includes(name) && !defaults.includes(name)
  })

  async function save(slot: SlotName, value: string) {
    if (inFlight() || useStudio.getState().status === "working") return
    const next = value.trim()
    if (!next || brief?.slots[slot]?.value === next) return
    useStudio.getState().queueOverride(slot, next)
    setError(null)
    try {
      await postTurn({ review: true })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
      setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
    }
  }

  async function saveNoise(value: string) {
    const noise = Number(value)
    if (!Number.isFinite(noise)) return
    setError(null)
    try {
      await postTurn({ noise })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
      setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
    }
  }

  async function act(flag: "write_prompts" | "back_to_questions") {
    if (inFlight() || useStudio.getState().status === "working") return
    setError(null)
    try {
      await postTurn({ [flag]: true })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
      setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink">Review</p>
      <Group title="Locked facts">
        {locked.map((name) => (
          <Fact key={name} name={name} slot={brief.slots[name]} locked onCommit={(value) => void save(name, value)} />
        ))}
      </Group>
      <Group title="Chosen">
        {chosen.map((name) => (
          <Fact key={name} name={name} slot={brief.slots[name]} onCommit={(value) => void save(name, value)} />
        ))}
      </Group>
      <Group title="Defaults">
        {defaults.map((name) => (
          <Fact key={name} name={name} slot={brief.slots[name]} mark="auto" onCommit={(value) => void save(name, value)} />
        ))}
      </Group>
      <Group title="Heard">
        {rest.map((name) => (
          <Fact key={name} name={name} slot={brief.slots[name]} onCommit={(value) => void save(name, value)} />
        ))}
      </Group>
      {brief.arc ? (
        <p className="text-secondary">
          Arc: {brief.arc.label}. {brief.arc.start} to {brief.arc.end}.
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-secondary">
        Audio intent
        <input
          defaultValue={brief.audio_intent ?? ""}
          disabled={working}
          onBlur={(event) => void save("intent", event.target.value)}
          className="rounded-[6px] border border-[var(--line)] bg-raised px-2 py-1 text-ink outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-secondary">
        How different
        <input
          defaultValue={String(brief.noise ?? 0.5)}
          inputMode="decimal"
          disabled={working}
          onBlur={(event) => void saveNoise(event.target.value)}
          className="rounded-[6px] border border-[var(--line)] bg-raised px-2 py-1 text-ink outline-none"
        />
      </label>
      <p className="text-secondary">Layers: {brief.output.map((layer) => layerTitle(layer)).join(", ") || "—"}</p>
      {error ? <p className="text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={working} onClick={() => void act("write_prompts")}>
          Write prompts
        </Button>
        <Button tone="secondary" disabled={working} onClick={() => void act("back_to_questions")}>
          Back to questions
        </Button>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children]
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-secondary">{title}</p>
      {children}
    </div>
  )
}

function Fact({
  name,
  slot,
  locked = false,
  mark,
  onCommit,
}: {
  name: SlotName
  slot?: SlotValue
  locked?: boolean
  mark?: string
  onCommit: (value: string) => void
}) {
  if (!slot) return null
  return (
    <label className="flex flex-col gap-1 text-secondary">
      <span className="flex items-center gap-2">
        {SLOT_LABEL[name]}
        {locked ? <LockMark /> : null}
        {mark ? <span className="text-[13px]">{mark}</span> : null}
      </span>
      <input
        defaultValue={slot.value}
        onBlur={(event) => onCommit(event.target.value)}
        className="rounded-[6px] border border-[var(--line)] bg-raised px-2 py-1 text-ink outline-none"
      />
    </label>
  )
}

function LockMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-label="Locked" className="text-ink">
      <rect x="2.2" y="5" width="7.6" height="5.5" rx="1" fill="none" stroke="currentColor" />
      <path d="M4 5V3.6a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" />
    </svg>
  )
}
