import { useState, useSyncExternalStore } from "react"

import { ApiError } from "../../api/client.ts"
import { inFlight } from "../../conversation/flight.ts"
import { composerRecording, subscribeRecording } from "../../composer/recording.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { useStudio } from "../../state/studio.ts"
import { Button } from "../Button.tsx"
import { PageHeader } from "./PageHeader.tsx"

export function Transport({ filled, briefOpen, onBrief }: { filled: number; briefOpen: boolean; onBrief: () => void }) {
  const status = useStudio((state) => state.status)
  const recording = useSyncExternalStore(subscribeRecording, composerRecording, () => false)
  const [error, setError] = useState<string | null>(null)

  async function buildNow() {
    if (inFlight() || recording || useStudio.getState().status === "working") return
    setError(null)
    try {
      await postTurn({ build_now: true })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
      setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Create" title="Shape your idea" subtitle="Describe it, record it, or drop a file. I ask only what is missing.">
        <button type="button" className="brief-toggle" data-tour="brief" aria-expanded={briefOpen} onClick={onBrief}>
          Brief
          <span className="brief-count">{filled}</span>
        </button>
        <SessionStatus />
        <Button data-tour="build" disabled={status === "working" || recording} onClick={() => void buildNow()}>
          Build now
        </Button>
      </PageHeader>
      {error ? (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function SessionStatus() {
  const status = useStudio((state) => state.status)
  const layerOrder = useStudio((state) => state.layerOrder)
  const runs = useStudio((state) => state.runs)
  const building = layerOrder.length > 0 || Object.keys(runs).length > 0
  const word = statusWord(status, building)
  const light = word === "ready" ? "is-ready" : word === "thinking" || word === "building" ? "is-thinking" : word === "error" ? "is-error" : ""
  return (
    <p className="status-readout">
      <span className={`status-light ${light}`} aria-hidden="true" />
      <span className="sr-only">Status</span>
      {word}
    </p>
  )
}

function statusWord(status: string, building: boolean): string {
  if (status === "working") return building ? "building" : "thinking"
  if (status === "ready") return "ready"
  if (status === "error") return "error"
  return "idle"
}
