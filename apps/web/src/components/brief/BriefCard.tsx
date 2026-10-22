import { useState } from "react"
import { Lock } from "lucide-react"

import { SLOT_LABEL } from "../../brief/slots.ts"
import { inFlight } from "../../conversation/flight.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { useStudio } from "../../state/studio.ts"
import type { FacetAnswer } from "../../types/facet_answer.ts"
import type { SlotName } from "../../types/slot_name.ts"
import type { SlotSource } from "../../types/slot_source.ts"
import type { SongBrief } from "../../types/song_brief.ts"
import { layerTitle } from "../../studio/output.ts"
import { LayersCard } from "../layers/LayersCard.tsx"
import { Skeleton } from "../Skeleton.tsx"
import { SourceBadge } from "../SourceBadge.tsx"

const CORE: SlotName[] = ["mood", "energy", "world"]
const HIDDEN = new Set<SlotName>(["tempo", "key", "structure"])
const EXTRA: SlotName[] = ["style", "palette", "must_keep", "sound", "genre", "brightness", "pattern", "production", "progression", "meter", "intent"]
const LOCKED: SlotName[] = ["tempo", "key", "progression", "structure", "palette", "sound", "meter"]

type Props = {
  mark: string | null
  hot?: boolean
}

export function BriefCard({ mark, hot = false }: Props) {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const ready = useStudio((state) => state.turn?.status === "ready")
  const overrides = useStudio((state) => state.overrides)
  const queueOverride = useStudio((state) => state.queueOverride)
  const facets = brief?.facets ?? []
  const arc = brief?.arc
  const working = useStudio((state) => state.status === "working")
  const [open, setOpen] = useState(true)
  const rows = rowsFor(brief, overrides, mark)
  const loading = working && rows.length === 0
  const output = brief?.output?.length ? brief.output.map((item) => (item === "all_layers" ? "All layers" : item)).join(", ") : ""
  const summary = rows.slice(0, 3).map((row) => row.text).join(" · ") || "Details appear here as we talk."

  return (
    <section className={`card brief-card flex flex-col gap-4 p-5 ${hot ? "is-hot" : ""}`} data-open={open ? "true" : "false"} aria-label="Song brief">
      <button type="button" className="brief-summary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="section-title">Brief</span>
        <span className="mono text-secondary">{summary}</span>
      </button>
      <div className="brief-body flex flex-col gap-3">
        <h2 className="section-title">Brief</h2>
        {(["locked", "you", "detected", "defaults"] as const).map((name) => {
          const items = rows.filter((row) => row.group === name)
          const withOutput =
            name === "you" && output
              ? [...items, { slot: "output", label: "Output", text: output, source: "you" as const, reason: undefined, marked: false, group: "you" as const }]
              : items
          if (withOutput.length === 0) return null
          return (
            <div key={name} className="flex flex-col gap-2">
              <p className="text-[12px] font-medium text-secondary">{GROUP_LABEL[name]}</p>
              {withOutput.map((row) => (
                <Cell
                  key={row.slot}
                  slot={row.slot}
                  label={row.label}
                  text={row.text}
                  source={row.source}
                  reason={row.reason}
                  marked={row.marked}
                  locked={row.group === "locked"}
                  onChange={row.slot === "output" ? undefined : (value) => queueOverride(row.slot as SlotName, value)}
                />
              ))}
            </div>
          )
        })}
        {loading ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="w-24" />
            <Skeleton className="w-40" />
          </div>
        ) : rows.length === 0 && !output ? (
          <p className="text-secondary">Details appear here as we talk.</p>
        ) : null}
        <FacetBlock facets={facets} arcLabel={arc?.label} ready={ready} />
        <LayersCard />
      </div>
    </section>
  )
}

const GROUP_LABEL = {
  locked: "Locked",
  you: "From you",
  detected: "Detected",
  defaults: "Defaults",
} as const

function rowsFor(brief: SongBrief | null, overrides: Record<string, string>, mark: string | null) {
  const slots = [...CORE, ...EXTRA].filter((slot) => !HIDDEN.has(slot))
  return [...new Set(slots)].flatMap((slot) => {
    const item = field(slot, brief, overrides)
    const text = item?.text ?? ""
    if (!text) return []
    const source = item?.source
    return [
      {
        slot,
        label: SLOT_LABEL[slot],
        text,
        source,
        reason: item?.reason,
        marked: mark === slot,
        group: groupFor(slot, source, text),
      },
    ]
  })
}

function groupFor(slot: SlotName, source: SlotSource | undefined, text: string): "locked" | "you" | "detected" | "defaults" {
  if (!text) return "defaults"
  if (source === "you" && LOCKED.includes(slot)) return "locked"
  if (source === "you") return "you"
  if (source === "detected") return "detected"
  return "defaults"
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
  locked = false,
  onChange,
}: {
  slot: string
  label: string
  text: string
  source?: SlotSource
  reason?: string
  marked?: boolean
  locked?: boolean
  onChange?: (value: string) => void
}) {
  return (
    <div data-slot={slot} className={`flex items-start justify-between gap-3 ${marked ? "is-marked" : ""}`}>
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-secondary">
          {locked ? <Lock aria-hidden="true" size={12} /> : null}
          {label}
        </p>
        {text && onChange ? (
          <Editable text={text} label={label} onChange={onChange} />
        ) : text ? (
          <p className="mono text-ink">{text}</p>
        ) : (
          <p className="text-secondary">
            auto <span className="readout-hint">set from your words</span>
          </p>
        )}
      </div>
      {text && source ? <SourceBadge source={source} reason={reason} /> : null}
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

