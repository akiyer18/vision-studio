import { useStudio } from "../../state/studio.ts"

export function Readouts() {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const tempo = brief?.slots.tempo?.value?.trim()
  const key = brief?.slots.key?.value?.trim()
  const bars = brief?.slots.structure?.value.match(/\d+/)?.[0]
  const coverage = typeof brief?.coverage === "number" ? `${Math.round(brief.coverage * 100)}%` : undefined

  return (
    <div className="fact-row" aria-label="Session readouts">
      <Fact label="Tempo" value={tempo} />
      <Fact label="Key" value={key} />
      <Fact label="Bars" value={bars} />
      <Fact label="Coverage" value={coverage} />
    </div>
  )
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <p>
      <span className="fact-label">{label}</span>
      {value ? <span className="fact-value">{value}</span> : null}
    </p>
  )
}
