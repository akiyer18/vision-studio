import { motion, useReducedMotion } from "framer-motion"
import { Download } from "lucide-react"
import { memo, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react"

import { explainResult, fileName, fileUrl, type Explanation } from "../../api/client.ts"
import { missingLayers } from "../../recentIdeas.ts"
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
  const restored = useStudio((state) => state.restored)
  const sessionId = useStudio((state) => state.sessionId)
  const setMissing = useStudio((state) => state.setMissing)
  const reduce = useReducedMotion()
  const results = useRef<HTMLDivElement>(null)
  const seen = useRef(0)
  const allowed = new Set<string>([...(features.fullMix ? LANES : LANES.filter((layer) => layer !== "full_mix")), "sound"])
  const ordered = layerOrder.filter((layer) => allowed.has(layer.replace(/_[ab]$/, "")))
  const lanes =
    ordered.length > 0
      ? ordered
      : [...allowed].filter((layer) => renders.some((item) => item.layer === layer || item.layer.replace(/_[ab]$/, "") === layer))

  useEffect(() => {
    if (runId === 0 || seen.current === runId) return
    seen.current = runId
    results.current?.focus()
  }, [runId])

  useEffect(() => {
    if (!restored || renders.length === 0) {
      setMissing([])
      return
    }
    let cancel = false
    void unavailablePaths(sessionId, renders).then((paths) => {
      if (!cancel) setMissing(missingLayers(renders, paths))
    })
    return () => {
      cancel = true
    }
  }, [restored, renders, sessionId, setMissing])

  return (
    <div id="results" ref={results} tabIndex={-1} className="flex flex-col gap-3 outline-none" aria-busy={status === "working" || undefined}>
      <h2 className="text-secondary">Your layers</h2>
      {lanes.length === 0 ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <span className="skeleton h-14 w-full" />
          <span className="skeleton h-14 w-full" />
        </div>
      ) : null}
      {lanes.map((layer) => (
        <LayerCard key={layer} layer={layer} reduce={reduce === true} />
      ))}
      <ExplainPanel />
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
  const unavailable = useStudio((state) => state.missing.includes(layer))
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
      className="lane outline-none"
      style={{ color: paint.ink }}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.15 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="lane-dot" style={{ background: paint.wave }} aria-hidden="true" />
        <h3 className="lane-name">{title}</h3>
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
        {unavailable ? (
          <Button tone="secondary" onClick={() => void renderCurrent(layer)}>
            Build again
          </Button>
        ) : null}
        {variations.length > 0 && !unavailable && !failure && !run ? (
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
      {unavailable ? null : variations.length > 0 ? (
        <div role="tablist" aria-label={`${title} variations`} className="flex gap-2">
          {variations.map((item) => (
            <button
              key={item.variant}
              type="button"
              role="tab"
              aria-selected={tab === item.variant}
              className={`pad ${tab === item.variant ? "is-on" : ""}`}
              style={{ borderColor: tab === item.variant ? paint.wave : undefined, color: paint.ink }}
              onClick={() => setTab(item.variant)}
            >
              {item.variant}
            </button>
          ))}
        </div>
      ) : (
        <p>Each layer comes back as three variations.</p>
      )}
      {unavailable
        ? null
        : variations.map((item) => (
            <Variation key={item.variant} result={item} take={take} selected={tab === item.variant} ink={paint.ink} />
          ))}
    </motion.section>
  )
})

function ExplainPanel() {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const prompts = useStudio((state) => (state.turn?.status === "ready" ? state.turn.prompts : undefined))
  const trace = useStudio((state) => state.turn?.trace)
  const stamp = prompts?.map((item) => item.prompt).join("\n") ?? ""
  const [explanation, setExplanation] = useState<{ stamp: string; value: Explanation } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const current = explanation?.stamp === stamp ? explanation.value : null

  useEffect(() => {
    if (!brief || !prompts || prompts.length === 0) return
    let cancel = false
    explainResult({ brief, prompts, trace: trace ?? [] }).then(
      (result) => {
        if (!cancel) setExplanation({ stamp, value: result })
      },
      () => {
        if (!cancel) setProblem("The explanation did not load.")
      },
    )
    return () => {
      cancel = true
    }
  }, [brief, prompts, stamp, trace])

  if (!prompts || prompts.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <details className="rounded-2xl border border-white/10 px-4 py-3">
        <summary className="cursor-pointer text-ink">How this was made</summary>
        <p className="mt-3 text-secondary">{current?.how ?? problem ?? "Writing the explanation."}</p>
      </details>
      <details className="rounded-2xl border border-white/10 px-4 py-3">
        <summary className="cursor-pointer text-ink">Make it in Logic</summary>
        {current ? (
          <ol className="mt-3 list-decimal pl-5 text-secondary">
            {current.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-secondary">{problem ?? "Writing the explanation."}</p>
        )}
      </details>
    </div>
  )
}

async function unavailablePaths(sessionId: string, renders: RenderResult[]): Promise<Set<string>> {
  const paths = [...new Set(renders.map((item) => item.path))]
  const missing = new Set<string>()
  await Promise.all(
    paths.map(async (path) => {
      try {
        const response = await fetch(fileUrl(sessionId, path), { method: "HEAD" })
        if (!response.ok) missing.add(path)
      } catch {
        missing.add(path)
      }
    }),
  )
  return missing
}

function Variation({
  result,
  take,
  selected,
  ink,
}: {
  result: RenderResult
  take: number
  selected: boolean
  ink: string
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
      {selected ? (
        <Waveform url={url} label={`${title} variation ${result.variant} waveform`} seek={seekRef} wave={["#8B5CF6", lanePaint(result.layer).wave]} progress={lanePaint(result.layer).wave} height={40} />
      ) : null}
      <p className="sr-only">{name}</p>
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
        <Button tone="ghost" aria-label={`Download ${title} variation ${result.variant}`} title={`Download ${title}`} onClick={() => void download()}>
          <Download aria-hidden="true" size={16} />
          <span className="sr-only">Download</span>
        </Button>
      </div>
      {problem ? <p role="alert" className="mt-2">{problem}</p> : null}
    </div>
  )
}
