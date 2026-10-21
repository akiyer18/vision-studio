import { useState, useSyncExternalStore } from "react"

import { ApiError } from "../../api/client.ts"
import { inFlight } from "../../conversation/flight.ts"
import { composerRecording, subscribeRecording } from "../../composer/recording.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { useStudio } from "../../state/studio.ts"
import { Button } from "../Button.tsx"

export function Transport() {
  const status = useStudio((state) => state.status)
  const layerOrder = useStudio((state) => state.layerOrder)
  const runs = useStudio((state) => state.runs)
  const recording = useSyncExternalStore(subscribeRecording, composerRecording, () => false)
  const [error, setError] = useState<string | null>(null)
  const building = layerOrder.length > 0 || Object.keys(runs).length > 0
  const word = statusWord(status, building)
  const light = word === "ready" ? "is-ready" : word === "thinking" || word === "building" ? "is-thinking" : word === "error" ? "is-error" : ""

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
    <header className="page-header">
      <div className="min-w-0">
        <p className="eyebrow">Create</p>
        <h1 className="page-title">Shape your idea</h1>
        <p className="page-sub">Describe it, record it, or drop a file. I ask only what is missing.</p>
      </div>
      <div className="page-actions">
        <p className="status-readout">
          <span className={`status-light ${light}`} aria-hidden="true" />
          <span className="sr-only">Status</span>
          {word}
        </p>
        <Button data-tour="build" disabled={status === "working" || recording} onClick={() => void buildNow()}>
          Build now
        </Button>
      </div>
      {error ? (
        <p role="alert" className="w-full text-danger">
          {error}
        </p>
      ) : null}
    </header>
  )
}

function statusWord(status: string, building: boolean): string {
  if (status === "working") return building ? "building" : "thinking"
  if (status === "ready") return "ready"
  if (status === "error") return "error"
  return "idle"
}
