import type { UiStatus } from "../state/studio.ts"

const labels: Record<UiStatus, string> = {
  idle: "Idle",
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

export function SessionMark({ sessionId, status }: { sessionId: string; status: UiStatus }) {
  return (
    <p className="max-w-36 min-w-0 text-right text-sm leading-tight">
      <span className="block truncate text-tape-cream">Session {sessionId.slice(0, 8)}</span>
      <span className={tones[status]}>{labels[status]}</span>
    </p>
  )
}
