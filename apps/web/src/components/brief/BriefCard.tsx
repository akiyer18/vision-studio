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

const CORE: SlotName[] = ["tempo", "key", "structure", "mood", "energy", "world"]
const EXTRA: SlotName[] = ["style", "palette", "must_keep", "sound", "genre", "brightness", "pattern", "production"]

type Props = {
  mark: string | null
  onDescribe: () => void
}

export function BriefCard({ mark, onDescribe }: Props) {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const ready = useStudio((state) => state.turn?.status === "ready")
  const overrides = useStudio((state) => state.overrides)
  const queueOverride = useStudio((state) => state.queueOverride)
  const facets = brief?.facets ?? []
  const arc = brief?.arc
  const extras = EXTRA.filter((slot) => Boolean(overrides[slot] ?? brief?.slots[slot]?.value))
  const output = brief?.output?.length ? brief.output.join(", ") : ""

  return (
    <section className="panel-brief flex flex-col gap-3 p-3" data-tour="brief" aria-label="Song brief">
      <h2 className="section-title">Song brief</h2>
      <div className="param-grid">
        {CORE.map((slot) => {
          const item = field(slot, brief, overrides)
          return (
            <Cell
              key={slot}
              slot={slot}
              label={slot === "structure" ? "Bars" : SLOT_LABEL[slot]}
              text={item?.text ?? ""}
              source={item?.source}
              reason={item?.reason}
              marked={mark === slot}
              onChange={(value) => queueOverride(slot, value)}
            />
          )
        })}
        {extras.map((slot) => {
          const item = field(slot, brief, overrides)
          if (!item) return null
          return (
            <Cell
              key={slot}
              slot={slot}
              label={SLOT_LABEL[slot]}
              text={item.text}
              source={item.source}
              reason={item.reason}
              marked={mark === slot}
              onChange={(value) => queueOverride(slot, value)}
            />
          )
        })}
        <Cell slot="output" label="Output" text={output} />
      </div>
      {facets.length === 0 && !arc && !brief ? (
        <button type="button" className="self-start text-[13px] text-secondary underline-offset-4 hover:underline" onClick={onDescribe}>
          Describe a feeling
        </button>
      ) : null}
      <FacetBlock facets={facets} arcLabel={arc?.label} ready={ready} />
    </section>
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
                            className="pad text-ink"
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
    reason: pending ? "This will go with the next turn." : (value?.reason ?? "This has not been set."),
  }
}

function Cell({
  slot,
  label,
  text,
  source,
  reason,
  marked = false,
  onChange,
}: {
  slot: string
  label: string
  text: string
  source?: SlotSource
  reason?: string
  marked?: boolean
  onChange?: (value: string) => void
}) {
  return (
    <div data-slot={slot} className={`param-cell ${marked ? "is-marked" : ""}`}>
      <p className="text-[13px] text-secondary">{label}</p>
      {text && onChange ? <Editable text={text} label={label} onChange={onChange} /> : <p className="mono text-[15px] text-ink">{text || "—"}</p>}
      {source ? <SourceBadge source={source} reason={reason} /> : null}
    </div>
  )
}

function Editable({
  text,
  label,
  onChange,
}: {
  text: string
  label: string
  onChange: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const face = "mono text-left text-[15px] text-ink"

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

