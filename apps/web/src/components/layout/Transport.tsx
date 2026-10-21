import { renderCurrent } from "../../studio/renderSession.ts"
import { useStudio } from "../../state/studio.ts"
import { Button } from "../Button.tsx"

export function Transport({ sessionName }: { sessionName: string }) {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const status = useStudio((state) => state.status)
  const layerOrder = useStudio((state) => state.layerOrder)
  const runs = useStudio((state) => state.runs)
  const prompts = useStudio((state) => (state.turn?.status === "ready" ? state.turn.prompts : undefined))
  const tempo = brief?.slots.tempo?.value || "—"
  const key = brief?.slots.key?.value || "—"
  const bars = barCount(brief?.slots.structure?.value)
  const cards = prompts?.length ?? 0
  const building = layerOrder.length > 0 || Object.keys(runs).length > 0
  const word = statusWord(status, building)
  const canBuild = cards > 0 && status !== "working" && status !== "error"

  return (
    <header className="studio-transport">
      <p className="wordmark" data-tour="welcome">
        Vision Studio
      </p>
      <p className="session-name">{sessionName}</p>
      <div className="transport-readouts" aria-label="Session readouts">
        <div>
          <span className="readout-label">Tempo</span>
          <p className="readout">{tempo}</p>
        </div>
        <div>
          <span className="readout-label">Key</span>
          <p className="readout">{key}</p>
        </div>
        <div>
          <span className="readout-label">Bars</span>
          <p className="readout-bars">{bars}</p>
        </div>
        <div>
          <span className="readout-label">Status</span>
          <p className={`status-readout ${word === "thinking" || word === "building" ? "is-live" : ""}`}>{word}</p>
        </div>
      </div>
      <Button data-tour="build" disabled={!canBuild} title={cards === 0 ? "Send an idea first." : undefined} onClick={() => void renderCurrent()}>
        Build
      </Button>
    </header>
  )
}

function barCount(value: string | undefined): string {
  const match = value?.match(/\d+/)
  return match ? match[0] : "—"
}

function statusWord(status: string, building: boolean): string {
  if (status === "working") return building ? "building" : "thinking"
  if (status === "ready") return "ready"
  if (status === "error") return "error"
  return "idle"
}
