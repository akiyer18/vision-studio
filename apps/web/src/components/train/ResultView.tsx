import type { TrainCell, TrainFeedback, TrainResult } from "../../api/client.ts"
import { Button } from "../Button.tsx"
import { PageHeader } from "../layout/PageHeader.tsx"

const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

const sections = [
  ["What you got right", "right"],
  ["What differs", "differs"],
  ["How to improve", "improve"],
  ["What to focus on next", "next"],
] as const

const icons = ["✓", "≠", "→", "◎"]

type Props = {
  feedback: TrainFeedback
  result: TrainResult
  busy?: boolean
  error?: string
  onBack: () => void
  onNext: () => void
}

export function ResultView({ feedback, result, busy = false, error = "", onBack, onNext }: Props) {
  return (
    <section className="review-layout" aria-label="Feedback">
      <PageHeader
        eyebrow="Train"
        title="Feedback"
        subtitle={result.approximate ? "This comparison is an estimate from the audio." : "This comparison is from the MIDI."}
      />
      <p className="train-score" aria-label={`${feedback.stars} of 3`}>
        <span className="readout-label">Score</span>
        <span aria-hidden="true">{stars(feedback.stars)}</span>
      </p>
      <div className="train-feedback">
        {sections.map(([title, key], index) => (
          <article key={key} className="card train-copy">
            <h3 className="section-title">
              <span className="train-mark" aria-hidden="true">
                {icons[index]}
              </span>
              {title}
            </h3>
            <p>{feedback[key]}</p>
          </article>
        ))}
      </div>
      {typeof result.progression_correct === "boolean" ? (
        <p>
          Progression {result.progression_correct ? "matches" : "differs"}. Voicing similarity{" "}
          {result.voicing_similarity ?? 0}.
        </p>
      ) : null}
      <Comparison result={result} />
      <div className="train-actions">
        <Button onClick={onBack}>Try again</Button>
        <Button tone="secondary" disabled={busy} onClick={onNext}>
          {busy ? "Preparing the reference" : "Next exercise"}
        </Button>
      </div>
      {error ? <p className="train-error">{error}</p> : null}
    </section>
  )
}

function Comparison({ result }: { result: TrainResult }) {
  const drums = result.grid?.drums
  const bass = result.grid?.bass
  const chords = result.grid?.chords
  if (!drums && !bass && !chords) return null
  return (
    <div className="train-compare">
      <h2 className="section-title">Reference and your recreation</h2>
      <p className="text-secondary">Highlighted steps differ. K kick, S snare, g ghost snare, H closed hat, O open hat.</p>
      {drums?.map((bar, index) => (
        <div key={`drums-${index + 1}`} className="train-bar">
          <p className="readout-label">Bar {index + 1}</p>
          <p className="text-secondary">Reference</p>
          <div className="train-grid-scroll">
            <div className="train-grid">{bar.map((cell) => cellView(cell, cell.reference))}</div>
          </div>
          <p className="text-secondary">Yours</p>
          <div className="train-grid-scroll">
            <div className="train-grid">{bar.map((cell) => cellView(cell, cell.yours))}</div>
          </div>
        </div>
      ))}
      {bass?.map((bar, index) => (
        <div key={`bass-${index + 1}`} className="train-bar">
          <p className="readout-label">Bass, bar {index + 1}</p>
          <p className="text-secondary">Reference</p>
          <div className="train-grid-scroll">
            <div className="train-grid">{bar.map((cell) => cellView(cell, pitch(cell.reference)))}</div>
          </div>
          <p className="text-secondary">Yours</p>
          <div className="train-grid-scroll">
            <div className="train-grid">{bar.map((cell) => cellView(cell, pitch(cell.yours)))}</div>
          </div>
        </div>
      ))}
      {chords ? (
        <div className="train-chords">
          {chords.map((chord) => (
            <article key={chord.bar} className={chord.diff ? "card train-chord is-diff" : "card train-chord"}>
              <h3 className="section-title">Bar {chord.bar}</h3>
              <p>Reference {chord.reference}</p>
              <p>Yours {chord.yours.length > 0 ? chord.yours.map(pitchName).join(" ") : "No chord read"}</p>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function cellView(cell: TrainCell, label: string[] | string | number | null) {
  const text = Array.isArray(label) ? label.join("") : typeof label === "number" || label ? String(label) : ""
  const hit = text.length > 0
  return (
    <span key={cell.step} className={`train-cell${hit ? " has-hit" : ""}${cell.diff ? " is-diff" : ""}`}>
      {text}
    </span>
  )
}

function pitch(value: TrainCell["reference"]) {
  if (typeof value !== "number") return ""
  return pitchName(value)
}

function pitchName(pitchValue: number) {
  return `${names[pitchValue % 12]}${Math.floor(pitchValue / 12) - 1}`
}

function stars(count: number) {
  return `${"★".repeat(count)}${"☆".repeat(Math.max(0, 3 - count))}`
}
