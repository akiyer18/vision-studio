import { useState } from "react"
import { Button } from "../Button.tsx"

const roles = [
  { id: "kick", label: "Kick" },
  { id: "snare", label: "Snare" },
  { id: "hat", label: "Closed hat" },
  { id: "open_hat", label: "Open hat" },
  { id: "bass", label: "Bass" },
]

type Props = {
  notes: number[]
  busy: boolean
  onCompare: (mapping: Record<string, string>) => void
}

export function MappingDialog({ notes, busy, onCompare }: Props) {
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const ready = notes.every((note) => mapping[String(note)])

  return (
    <form
      className="card train-copy"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onCompare(mapping)
      }}
    >
      <h2 className="section-title">Match the drum notes</h2>
      <p>
        These notes are not the usual drum notes. Kick is 36, snare is 38 or 40, closed hat is 42, and open hat is 46. Choose
        what each note is, then compare again.
      </p>
      <div className="train-map">
        {notes.map((note) => (
          <label key={note}>
            Note {note}
            <select
              value={mapping[String(note)] ?? ""}
              onChange={(event) => setMapping((current) => ({ ...current, [String(note)]: event.target.value }))}
            >
              <option value="">Choose</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <Button type="submit" disabled={!ready || busy}>
        Compare
      </Button>
    </form>
  )
}
