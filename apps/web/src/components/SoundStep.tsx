import { memo, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react"

import { features } from "../features.ts"
import { transport } from "../playback/transport.ts"
import { regenerateLayer, renderCurrent } from "../studio/renderSession.ts"
import { LANES, lanePaint } from "../studio/lanes.ts"
import { audibleLayers } from "../studio/mix.ts"
import { layerTitle } from "../studio/output.ts"
import { useStudio } from "../state/studio.ts"
import { Button } from "./Button.tsx"
import { Clip } from "./Clip.tsx"
import { EmptyState, StepFrame } from "./StepCopy.tsx"

export function SoundStep() {
  const status = useStudio((state) => state.status)
  const runId = useStudio((state) => state.runId)
  const renders = useStudio((state) => state.renders)
  const layerOrder = useStudio((state) => state.layerOrder)
  const playback = useSyncExternalStore(transport.subscribe, transport.getState, transport.getState)
  const results = useRef<HTMLDivElement>(null)
  const seen = useRef(0)
  const playRef = useRef<() => void>(() => undefined)
  const [sweep, setSweep] = useState(false)
  const [phase, setPhase] = useState(status)
  const [armed, setArmed] = useState(status === "working")
  const [problem, setProblem] = useState<string | null>(null)
  if (status !== phase) {
    setPhase(status)
    if (status === "working") setArmed(true)
    else if (armed && status === "ready" && renders.length > 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setArmed(false)
      setSweep(true)
    } else setArmed(false)
  }

  const allowed = features.fullMix ? LANES : LANES.filter((layer) => layer !== "full_mix")
  const ordered = layerOrder.filter((layer) => (allowed as readonly string[]).includes(layer))
  const lanes = ordered.length > 0 ? ordered : allowed.filter((layer) => renders.some((item) => item.layer === layer))

  useEffect(() => {
    if (runId === 0 || seen.current === runId) return
    seen.current = runId
    results.current?.focus()
  }, [runId])

  async function startTogether(): Promise<boolean> {
    const state = useStudio.getState()
    const ids = audibleLayers(state.layerOrder).flatMap((layer) => {
      const variant = state.picks[layer] ?? 1
      const match = state.renders.some((item) => item.layer === layer && item.variant === variant)
      return match ? [`${layer}:${variant}`] : []
    })
    if (ids.length === 0) {
      setProblem("Wait for a variation to finish, then play.")
      return false
    }
    try {
      await transport.playTogether(ids)
    } catch {
      setProblem("The layers did not play. Try again.")
      return false
    }
    if (transport.getState().mode !== "together") {
      setProblem("The layers did not play. Try again.")
      return false
    }
    return true
  }

  async function advance() {
    setProblem(null)
    if (transport.getState().mode !== "together") {
      const started = await startTogether()
      if (!started) return
    }
    useStudio.getState().hear()
  }

  useEffect(() => {
    playRef.current = () => {
      if (transport.getState().mode !== "idle") {
        transport.stop()
        return
      }
      setProblem(null)
      void startTogether()
    }
  })

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== " " || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest("input, textarea, button, a, select")) return
      if (document.getElementById("shortcut-help")?.contains(target)) return
      event.preventDefault()
      playRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  if (renders.length === 0) {
    return (
      <StepFrame title="Sound">
        <EmptyState
          title="The takes are being built"
          reason="Each layer comes back as three variations."
          action="Play"
          disabled
          onAction={() => undefined}
        />
      </StepFrame>
    )
  }

  return (
    <StepFrame title="Sound">
      <div
        id="results"
        ref={results}
        tabIndex={-1}
        className="relative outline-none focus:outline-2 focus:outline-offset-2 focus:outline-lamp"
        aria-busy={status === "working" || playback.mode === "together" || undefined}
      >
        {sweep ? <div className="playhead" aria-hidden onAnimationEnd={() => setSweep(false)} /> : null}
        <div className="flex flex-col">
          {lanes.map((layer) => (
            <Lane key={layer} layer={layer} reveal={sweep} />
          ))}
        </div>
      </div>
      {problem ? (
        <p role="alert" className="text-fault">
          {problem}
        </p>
      ) : null}
      <Button aria-label={problem ? "Try again" : "Play the layers together"} onClick={() => void advance()}>
        {problem ? "Try again" : "Play"}
      </Button>
    </StepFrame>
  )
}

const Lane = memo(function Lane({ layer, reveal }: { layer: string; reveal: boolean }) {
  const renders = useStudio((state) => state.renders)
  const run = useStudio((state) => state.runs[layer])
  const failure = useStudio((state) => state.failures[layer])
  const take = useStudio((state) => state.takes[layer] ?? 1)
  const solo = useStudio((state) => state.solo)
  const muted = useStudio((state) => state.muted)
  const toggleSolo = useStudio((state) => state.toggleSolo)
  const toggleMute = useStudio((state) => state.toggleMute)
  const setFocusedLane = useStudio((state) => state.setFocusedLane)
  const title = layerTitle(layer)
  const paint = lanePaint(layer)
  const variations = renders.filter((item) => item.layer === layer).sort((left, right) => left.variant - right.variant)
  const isMuted = muted.includes(layer)

  function onKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!features.soloMute) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target
    if (target instanceof HTMLElement && target.closest("input, textarea")) return
    if (event.key === "m" || event.key === "M") {
      event.preventDefault()
      toggleMute(layer)
      return
    }
    if ((event.key === "s" || event.key === "S") && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      toggleSolo(layer)
    }
  }

  return (
    <div
      data-lane={layer}
      tabIndex={0}
      aria-label={title}
      onKeyDown={onKey}
      onFocus={() => setFocusedLane(layer)}
      onBlur={(event) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        if (useStudio.getState().focusedLane === layer) setFocusedLane(null)
      }}
      className={`border-b border-rule px-3 py-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp ${layer === "full_mix" ? "border-y-2" : ""}`}
      style={{ borderLeft: `3px solid ${variations.length > 0 ? paint.fill : "var(--rule)"}` }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="lane-name text-lamp">{title}</h2>
        {features.soloMute ? (
          <>
            <Button tone="secondary" aria-pressed={solo === layer} aria-label={`Solo ${title}`} onClick={() => toggleSolo(layer)}>
              Solo
            </Button>
            <Button
              tone="secondary"
              aria-pressed={isMuted}
              aria-label={`Mute ${title}`}
              onClick={() => toggleMute(layer)}
            >
              Mute
            </Button>
          </>
        ) : null}
        {variations.length > 0 && !failure && !run ? (
          <Button
            tone="secondary"
            aria-label={`Another take for ${title}`}
            onClick={() => {
              transport.stop()
              void regenerateLayer(layer)
            }}
          >
            Another take
          </Button>
        ) : null}
        <span className="text-dust">{laneStatus(run, failure?.message, isMuted, solo === layer, variations.length > 0)}</span>
      </div>
      {run ? (
        <p role="status" className="mt-2 text-dust">
          {`${layer}: rendering take ${run.take}, variation ${run.variant} of ${run.total}`}
        </p>
      ) : null}
      {failure ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p role="alert" className="text-fault">
            {failure.message}
          </p>
          <Button
            tone="secondary"
            aria-label={`Try ${title} again`}
            onClick={() => void (failure.action === "regenerate" ? regenerateLayer(layer) : renderCurrent(layer))}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {variations.length > 0 ? (
        <div className="mt-3 flex flex-col gap-3">
          {variations.map((result) => (
            <Clip key={`${result.layer}:${result.variant}:${take}`} result={result} take={take} reveal={reveal} />
          ))}
        </div>
      ) : null}
    </div>
  )
})

function laneStatus(
  run: { take: number; variant: number; total: number } | undefined,
  failure: string | undefined,
  muted: boolean,
  solo: boolean,
  ready: boolean,
): string {
  if (run) return "Rendering"
  if (failure) return ""
  if (ready) return "Ready"
  if (features.soloMute && solo) return "Solo"
  if (features.soloMute && muted) return "Muted"
  return ""
}
