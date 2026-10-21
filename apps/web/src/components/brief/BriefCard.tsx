import { motion, useReducedMotion } from "framer-motion"
import { useState } from "react"

import { SLOT_LABEL } from "../../brief/slots.ts"
import { inFlight } from "../../conversation/flight.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { useStudio } from "../../state/studio.ts"
import type { FacetAnswer } from "../../types/facet_answer.ts"
import type { SlotName } from "../../types/slot_name.ts"
import type { SlotSource } from "../../types/slot_source.ts"
import type { SongBrief } from "../../types/song_brief.ts"
import { layerTitle } from "../../studio/output.ts"
import { SourceBadge } from "../SourceBadge.tsx"

const ROWS: SlotName[] = ["mood", "energy", "world", "style", "palette", "structure", "must_keep", "sound", "genre", "brightness", "pattern", "production"]

type Props = {
  mark: string | null
  onDescribe: () => void
}

export function BriefCard({ mark, onDescribe }: Props) {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const ready = useStudio((state) => state.turn?.status === "ready")
  const overrides = useStudio((state) => state.overrides)
  const queueOverride = useStudio((state) => state.queueOverride)
  const tempo = field("tempo", brief, overrides)
  const key = field("key", brief, overrides)
  const rows = ROWS.filter((slot) => Boolean(overrides[slot] ?? brief?.slots[slot]?.value))
  const facets = brief?.facets ?? []
  const arc = brief?.arc
  const empty = !tempo && !key && rows.length === 0 && facets.length === 0 && !arc
  const reduce = useReducedMotion()

  return (
    <motion.section
      className="glass panel-brief flex flex-col gap-4 p-4"
      data-tour="brief"
      aria-label="Song brief"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.22 }}
    >
      <h2 className="section-title">Song brief</h2>
      {empty ? (
        <div>
          <p className="text-secondary">Slots appear here as they are filled.</p>
          <button type="button" className="mt-3 text-ink underline-offset-4 hover:underline" onClick={onDescribe}>
            Describe a feeling
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {tempo || key ? (
            <div className="flex flex-wrap gap-6">
              {tempo ? (
                <Mark
                  slot="tempo"
                  label="Tempo"
                  text={tempo.text}
                  source={tempo.source}
                  confidence={tempo.confidence}
                  reason={tempo.reason}
                  marked={mark === "tempo"}
                  onChange={(value) => queueOverride("tempo", value)}
                />
              ) : null}
              {key ? (
                <Mark
                  slot="key"
                  label="Key"
                  text={key.text}
                  source={key.source}
                  confidence={key.confidence}
                  reason={key.reason}
                  marked={mark === "key"}
                  onChange={(value) => queueOverride("key", value)}
                />
              ) : null}
            </div>
          ) : null}
          {rows.map((slot) => {
            const item = field(slot, brief, overrides)
            if (!item) return null
            return (
              <SlotRow
                key={slot}
                slot={slot}
                label={SLOT_LABEL[slot]}
                text={item.text}
                source={item.source}
                confidence={item.confidence}
                reason={item.reason}
                marked={mark === slot}
                onChange={(value) => queueOverride(slot, value)}
              />
            )
          })}
          <FacetBlock facets={facets} arcLabel={arc?.label} ready={ready} />
        </div>
      )}
    </motion.section>
  )
}

function FacetBlock({ facets, arcLabel, ready }: { facets: FacetAnswer[]; arcLabel?: string; ready: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (facets.length === 0 && !arcLabel) return null
  const groups = groupFacets(facets)
  const layers = [...new Set(groups.map((group) => group.layer))]

  async function choose(id: string, value: string) {
    if (inFlight() || useStudio.getState().status === "working") return
    setError(null)
    try {
      const posted = await postTurn({ answer: { slot: "palette", action: "answer", value, facet: id } })
      if (posted) setOpen(null)
    } catch {
      setError("That change did not go through.")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {arcLabel ? <p className="text-ink">{arcLabel}</p> : null}
      {layers.map((layer) => (
        <div key={layer} className="flex flex-col gap-1">
          <p className="text-sm text-muted">{layerTitle(layer)}</p>
          {groups
            .filter((group) => group.layer === layer)
            .map((group) => (
              <div key={group.key}>
                <button
                  type="button"
                  className="text-left text-sm text-ink disabled:cursor-default"
                  disabled={!ready}
                  aria-expanded={open === group.key}
                  onClick={() => setOpen(open === group.key ? null : group.key)}
                >
                  {group.label}: {group.text}
                </button>
                {open === group.key ? (
                  <div className="mt-2 flex flex-col gap-2">
                    {group.items.map((item) => (
                      <div key={item.id} className="flex flex-wrap gap-2">
                        {item.options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            className="rounded-full border border-white/15 px-3 py-1 text-sm text-ink"
                            aria-pressed={option === item.value}
                            onClick={() => void choose(item.id, option)}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
        </div>
      ))}
      {error ? <p className="text-danger">{error}</p> : null}
    </div>
  )
}

function groupFacets(facets: FacetAnswer[]) {
  const grouped = new Map<string, FacetAnswer[]>()
  for (const facet of facets) {
    const key = `${facet.layer}:${facet.label}`
    const items = grouped.get(key) ?? []
    items.push(facet)
    grouped.set(key, items)
  }
  return [...grouped.entries()].map(([key, items]) => ({
    key,
    layer: items[0]?.layer ?? "",
    label: items[0]?.label ?? "",
    text: items.map((item) => item.value).join(", "),
    items,
  }))
}

function field(slot: SlotName, brief: SongBrief | null, overrides: Record<string, string>) {
  const value = brief?.slots[slot]
  const pending = overrides[slot]
  const text = pending ?? value?.value ?? ""
  if (!text) return null
  return {
    text,
    source: (pending ? "you" : value?.source) as SlotSource | undefined,
    confidence: value?.confidence ?? 0,
    reason: pending ? "This will go with the next turn." : (value?.reason ?? "This has not been set."),
  }
}

function Mark({
  slot,
  label,
  text,
  source,
  confidence,
  reason,
  marked,
  onChange,
}: {
  slot: string
  label: string
  text: string
  source?: SlotSource
  confidence: number
  reason: string
  marked: boolean
  onChange: (value: string) => void
}) {
  return (
    <div data-slot={slot} className={marked ? "rounded-xl outline outline-2 outline-offset-2 outline-accent" : ""}>
      <p className="text-sm text-muted">{label}</p>
      <Editable text={text} label={label} large onChange={onChange} />
      <Meta source={source} confidence={confidence} reason={reason} />
    </div>
  )
}

function SlotRow({
  slot,
  label,
  text,
  source,
  confidence,
  reason,
  marked,
  onChange,
}: {
  slot: string
  label: string
  text: string
  source?: SlotSource
  confidence: number
  reason: string
  marked: boolean
  onChange: (value: string) => void
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      data-slot={slot}
      className={`flex flex-col gap-1 ${marked ? "rounded-xl outline outline-2 outline-offset-2 outline-accent" : ""}`}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.22 }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted">{label}</p>
        <Editable text={text} label={label} onChange={onChange} />
      </div>
      <Meta source={source} confidence={confidence} reason={reason} />
    </motion.div>
  )
}

function Editable({
  text,
  label,
  large = false,
  onChange,
}: {
  text: string
  label: string
  large?: boolean
  onChange: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const face = large ? "tempo-mark text-left text-ink" : "text-right text-ink"

  if (!editing) {
    return (
      <button
        type="button"
        className={face}
        onClick={() => {
          setDraft(text)
          setEditing(true)
        }}
      >
        {text}
      </button>
    )
  }

  return (
    <input
      aria-label={`Edit ${label}`}
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false)
        if (draft !== text) onChange(draft)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          setDraft(text)
          setEditing(false)
        }
      }}
      className={`w-full bg-transparent outline-none ${face}`}
    />
  )
}

function Meta({ source, confidence, reason }: { source?: SlotSource; confidence: number; reason: string }) {
  const reduce = useReducedMotion()
  const width = `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`
  return (
    <div className="mt-1">
      <div className="flex items-center gap-2">
        {source ? <SourceBadge source={source} /> : null}
        <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/10" role="meter" aria-label="Confidence" aria-valuemin={0} aria-valuemax={1} aria-valuenow={confidence} aria-valuetext={reason}>
          <motion.div
            className="h-full bg-accent"
            initial={reduce ? false : { width: 0 }}
            animate={{ width }}
            transition={{ duration: reduce ? 0 : 0.35 }}
          />
        </div>
      </div>
    </div>
  )
}
