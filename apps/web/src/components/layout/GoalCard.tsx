import { useState } from "react"

import { useStudio } from "../../state/studio.ts"
import type { SlotName } from "../../types/slot_name.ts"

type Props = {
  idea?: string
}

export function GoalCard({ idea }: Props) {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const overrides = useStudio((state) => state.overrides)
  const originalName = useStudio((state) => state.originalName)
  const queueOverride = useStudio((state) => state.queueOverride)
  const tempo = shown(overrides.tempo, brief?.slots.tempo?.value)
  const key = shown(overrides.key, brief?.slots.key?.value)
  const bars = barCount(shown(overrides.structure, brief?.slots.structure?.value))
  const coverage = typeof brief?.coverage === "number" ? `${Math.round(brief.coverage * 100)}%` : undefined
  const title = idea?.trim() || originalName || "Describe the goal"

  function commit(slot: SlotName, value: string) {
    const next = value.trim()
    if (!next) return
    const current = slot === "structure" ? bars : slot === "tempo" ? tempo : key
    const stored = slot === "structure" ? `${next.replace(/\s*bars?$/i, "")} bars` : next
    if (stored === current || (slot === "structure" && next === current)) return
    queueOverride(slot, stored)
  }

  return (
    <article className="card goal-card">
      <h2 className="section-title">Goal</h2>
      <p>{title}</p>
      <div className="goal-fields">
        <Field label="Tempo" value={tempo} onCommit={(value) => commit("tempo", value)} />
        <Field label="Key" value={key} onCommit={(value) => commit("key", value)} />
        <Field label="Bars" value={bars} onCommit={(value) => commit("structure", value)} />
        {coverage ? (
          <p>
            <span className="fact-label">Coverage</span>
            <span className="fact-value">{coverage}</span>
          </p>
        ) : null}
      </div>
    </article>
  )
}

function Field({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shownValue = draft ?? value
  return (
    <label>
      <span className="fact-label">{label}</span>
      <input
        className="field goal-input"
        value={shownValue}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          onCommit(shownValue)
          setDraft(null)
        }}
      />
    </label>
  )
}

function shown(override: string | undefined, value: string | undefined): string {
  return (override ?? value ?? "").trim()
}

function barCount(value: string): string {
  return value.match(/\d+/)?.[0] ?? value
}
