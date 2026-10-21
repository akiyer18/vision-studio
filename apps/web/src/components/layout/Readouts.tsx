import type { ReactNode } from "react"

import { useStudio } from "../../state/studio.ts"
import type { SlotSource } from "../../types/slot_source.ts"
import { SourceBadge } from "../SourceBadge.tsx"

export function Readouts() {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const tempo = brief?.slots.tempo
  const key = brief?.slots.key
  const structure = brief?.slots.structure
  const bars = structure?.value.match(/\d+/)?.[0]
  const coverage = brief?.coverage

  return (
    <div className="readout-row" aria-label="Session readouts">
      <Tile label="Tempo" value={tempo?.value} source={tempo?.source} reason={tempo?.reason} visual={<Pulse active={Boolean(tempo?.value)} />} />
      <Tile label="Key" value={key?.value} source={key?.source} reason={key?.reason} visual={<KeyWheel name={key?.value} />} />
      <Tile label="Bars" value={bars} source={structure?.source} reason={structure?.reason} visual={<BarTicks count={bars ? Number(bars) : 0} />} />
      <Tile
        label="Brief coverage"
        value={typeof coverage === "number" ? `${Math.round(coverage * 100)}%` : undefined}
        source={typeof coverage === "number" ? "guessed" : undefined}
        visual={<CoverageRing amount={typeof coverage === "number" ? coverage : 0} />}
      />
    </div>
  )
}

function Tile({
  label,
  value,
  source,
  reason,
  visual,
}: {
  label: string
  value?: string
  source?: SlotSource
  reason?: string
  visual: ReactNode
}) {
  const shown = value?.trim()
  return (
    <section className="card readout-tile p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="readout-label">{label}</p>
        {visual}
      </div>
      <p className={`readout ${shown ? "" : "is-empty"}`}>{shown || "auto"}</p>
      {shown ? <SourceBadge source={source ?? "guessed"} reason={reason} /> : <p className="readout-hint">set from your words</p>}
    </section>
  )
}

function Pulse({ active }: { active: boolean }) {
  return (
    <svg width="56" height="20" viewBox="0 0 56 20" aria-hidden="true">
      <polyline
        fill="none"
        stroke={active ? "#FF9A5C" : "#6E675F"}
        strokeWidth="1.5"
        points="0,12 8,12 12,4 16,16 20,8 28,8 34,2 40,14 46,10 56,10"
      />
    </svg>
  )
}

function KeyWheel({ name }: { name?: string }) {
  const letters = "CDEFGAB"
  const mark = name?.trim().charAt(0).toUpperCase() ?? ""
  const index = letters.indexOf(mark)
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      {Array.from({ length: 12 }, (_, step) => {
        const angle = (step / 12) * Math.PI * 2 - Math.PI / 2
        const active = index >= 0 && step === index
        return (
          <line
            key={step}
            x1={14 + Math.cos(angle) * 6}
            y1={14 + Math.sin(angle) * 6}
            x2={14 + Math.cos(angle) * 12}
            y2={14 + Math.sin(angle) * 12}
            stroke={active ? "#FF6A2B" : "#6E675F"}
            strokeWidth={active ? 2 : 1}
          />
        )
      })}
    </svg>
  )
}

function BarTicks({ count }: { count: number }) {
  const ticks = Math.min(Math.max(count, 4), 16)
  return (
    <svg width="56" height="16" viewBox="0 0 56 16" aria-hidden="true">
      {Array.from({ length: ticks }, (_, step) => (
        <rect key={step} x={step * (56 / ticks)} y={count ? 4 : 7} width="2" height={count ? 8 : 2} fill={count ? "#FF9A5C" : "#6E675F"} />
      ))}
    </svg>
  )
}

function CoverageRing({ amount }: { amount: number }) {
  const radius = 10
  const span = 2 * Math.PI * radius
  const clamped = Math.min(Math.max(amount, 0), 1)
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r={radius} fill="none" stroke="#6E675F" strokeWidth="2" />
      <circle
        cx="14"
        cy="14"
        r={radius}
        fill="none"
        stroke="#FF6A2B"
        strokeWidth="2"
        strokeDasharray={`${span * clamped} ${span}`}
        strokeLinecap="round"
        transform="rotate(-90 14 14)"
      />
    </svg>
  )
}
