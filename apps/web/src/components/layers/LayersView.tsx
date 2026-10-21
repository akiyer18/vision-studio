import { motion, useReducedMotion } from "framer-motion"
import { memo, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react"

import { fileName, fileUrl } from "../../api/client.ts"
import { features } from "../../features.ts"
import { transport } from "../../playback/transport.ts"
import { lanePaint } from "../../studio/lanes.ts"
import { LANES } from "../../studio/lanes.ts"
import { regenerateLayer, renderCurrent } from "../../studio/renderSession.ts"
import { layerTitle } from "../../studio/output.ts"
import { useStudio } from "../../state/studio.ts"
import type { RenderResult } from "../../types/render_result.ts"
import { Button } from "../Button.tsx"
import { Waveform } from "../Waveform.tsx"

export function LayersView() {
  const renders = useStudio((state) => state.renders)
  const layerOrder = useStudio((state) => state.layerOrder)
  const status = useStudio((state) => state.status)
  const runId = useStudio((state) => state.runId)
  const reduce = useReducedMotion()
  const results = useRef<HTMLDivElement>(null)
  const seen = useRef(0)
  const allowed = features.fullMix ? LANES : LANES.filter((layer) => layer !== "full_mix")
  const ordered = layerOrder.filter((layer) => (allowed as readonly string[]).includes(layer))
  const lanes = ordered.length > 0 ? ordered : allowed.filter((layer) => renders.some((item) => item.layer === layer))

  useEffect(() => {
    if (runId === 0 || seen.current === runId) return
    seen.current = runId
    results.current?.focus()
  }, [runId])

  return (
    <div id="results" ref={results} tabIndex={-1} className="flex flex-col gap-3 outline-none" aria-busy={status === "working" || undefined}>
      <h2 className="text-secondary">Your layers</h2>
      {lanes.length === 0 ? <p className="text-secondary">The takes are being built.</p> : null}
      {lanes.map((layer) => (
        <LayerCard key={layer} layer={layer} reduce={reduce === true} />
      ))}
    </div>
  )
}

const LayerCard = memo(function LayerCard({ layer, reduce }: { layer: string; reduce: boolean }) {
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
  const [tab, setTab] = useState(1)
  const isMuted = muted.includes(layer)

  function onKey(event: ReactKeyboardEvent<HTMLElement>) {
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
    <motion.section
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
      className="flex flex-col gap-3 p-4 outline-none"
      style={{
        background: paint.fill,
        color: paint.ink,
        borderRadius: 16,
        boxShadow: layer === "full_mix" ? "0 0 0 1px rgba(255,255,255,0.35), 0 0 0 3px rgba(255,255,255,0.18)" : undefined,
      }}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.28 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-medium">{title}</h3>
        {features.soloMute ? (
          <>
            <Button tone="secondary" aria-pressed={solo === layer} aria-label={`Solo ${title}`} onClick={() => toggleSolo(layer)}>
              Solo
            </Button>
            <Button tone="secondary" aria-pressed={isMuted} aria-label={`Mute ${title}`} onClick={() => toggleMute(layer)}>
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
      </div>
      {run ? <p>Building variation {run.variant} of {run.total}.</p> : null}
      {failure ? (
        <div role="alert">
          <p>{failure.message}</p>
          <Button
            tone="secondary"
            className="mt-2"
            onClick={() => void (failure.action === "regenerate" ? regenerateLayer(layer) : renderCurrent(layer))}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {variations.length > 0 ? (
        <div role="tablist" aria-label={`${title} variations`} className="flex gap-2">
          {variations.map((item) => (
            <button
              key={item.variant}
              type="button"
              role="tab"
              aria-selected={tab === item.variant}
              className="rounded-full border px-3 py-1 text-sm"
              style={{ borderColor: paint.ink, background: tab === item.variant ? paint.ink : "transparent", color: tab === item.variant ? paint.fill : paint.ink }}
              onClick={() => setTab(item.variant)}
            >
              {item.variant}
            </button>
          ))}
        </div>
      ) : (
        <p>Each layer comes back as three variations.</p>
      )}
      {variations.map((item) => (
        <Variation key={item.variant} result={item} take={take} selected={tab === item.variant} ink={paint.ink} wave={paint.wave} progress={paint.progress} />
      ))}
    </motion.section>
  )
})

function Variation({
  result,
  take,
  selected,
  ink,
  wave,
  progress,
}: {
  result: RenderResult
  take: number
  selected: boolean
  ink: string
  wave: string
  progress: string
}) {
  const id = `${result.layer}:${result.variant}`
  const picked = useStudio((state) => state.picks[result.layer] === result.variant)
  const togglePick = useStudio((state) => state.togglePick)
  const sessionId = useStudio((state) => state.sessionId)
  const playback = useSyncExternalStore(transport.subscribe, transport.getState, transport.getState)
  const seekRef = useRef<((seconds: number) => void) | null>(null)
  const sought = useRef<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const url = fileUrl(sessionId, result.path, take)
  const name = fileName(result.path)
  const title = layerTitle(result.layer)
  const solo = playback.mode === "one" && playback.activeId === id
  const grouped = playback.mode === "together" && playback.togetherIds.includes(id)
  const moving = solo || grouped

  useEffect(() => transport.register(id, url), [id, url])
  useEffect(() => {
    transport.prefetch(url)
  }, [url])
  useEffect(() => {
    const next = moving ? playback.seconds : 0
    if (sought.current === next) return
    sought.current = next
    seekRef.current?.(next)
  }, [moving, playback.seconds])
  useEffect(() => {
    return () => {
      if (useStudio.getState().heard) return
      const state = transport.getState()
      if (state.activeId === id || state.togetherIds.includes(id)) transport.stop()
    }
  }, [id])

  async function toggle() {
    setProblem(null)
    if (transport.getState().mode === "one" && transport.getState().activeId === id) {
      transport.stop()
      return
    }
    try {
      await transport.playOne(id)
    } catch {
      setProblem("This variation did not play. Try again.")
    }
  }

  async function download() {
    setProblem(null)
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error("missing")
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      setProblem("This variation did not download. Try again.")
    }
  }

  return (
    <div hidden={!selected} data-layer={result.layer} data-variant={result.variant} data-seconds={moving ? playback.seconds.toFixed(3) : undefined}>
      {selected ? <Waveform url={url} label={`${title} variation ${result.variant} waveform`} seek={seekRef} wave={wave} progress={progress} /> : null}
      <p className="mt-2 truncate text-sm">{name}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button tone="secondary" aria-pressed={solo} aria-label={solo ? `Pause ${title} variation ${result.variant}` : `Play ${title} variation ${result.variant}`} onClick={() => void toggle()} style={{ color: ink }}>
          {solo ? "Pause" : "Play"}
        </Button>
        <Button
          tone="secondary"
          aria-pressed={picked}
          aria-label={`Pick ${title} variation ${result.variant}`}
          className={picked ? "outline outline-2 outline-offset-2 outline-accent" : ""}
          onClick={() => togglePick(result.layer, result.variant)}
        >
          Pick
        </Button>
        <Button tone="ghost" aria-label={`Download ${title} variation ${result.variant}`} onClick={() => void download()}>
          Download
        </Button>
      </div>
      {problem ? <p role="alert" className="mt-2">{problem}</p> : null}
    </div>
  )
}
