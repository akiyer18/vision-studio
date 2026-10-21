import type { UiStatus } from "../state/studio.ts"

const labels: Record<UiStatus, string> = {
  idle: "Waiting",
  working: "Working",
  ready: "Ready",
  error: "Error",
}

const tones: Record<UiStatus, string> = {
  idle: "text-dust",
  working: "text-signal-violet",
  ready: "text-vu-amber",
  error: "text-clip-red",
}

export function SessionMark({
  sessionId,
  status,
  detail,
}: {
  sessionId: string
  status: UiStatus
  detail?: string | null
}) {
  const line = status === "error" && detail ? detail : labels[status]
  return (
    <p className="min-w-0 text-sm leading-tight">
      <span className="tabular block truncate text-lamp">Session {sessionId.slice(0, 8)}</span>
      <span className={tones[status]}>{line}</span>
    </p>
  )
}
