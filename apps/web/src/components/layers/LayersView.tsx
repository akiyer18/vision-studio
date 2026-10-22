import { motion, useReducedMotion } from "framer-motion"
import { Download } from "lucide-react"
import { memo, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react"

import { explainResult, fileName, fileUrl, type Explanation } from "../../api/client.ts"
import { readRoll, type RollNote } from "../../studio/midiRoll.ts"
import { useLevel } from "../../level.ts"
import { missingLayers } from "../../recentIdeas.ts"
import { features } from "../../features.ts"
import { transport } from "../../playback/transport.ts"
import { lanePaint } from "../../studio/lanes.ts"
import { LANES } from "../../studio/lanes.ts"
import { regenerateLayer, renderCurrent } from "../../studio/renderSession.ts"
import { layerTitle } from "../../studio/output.ts"
import { traceSentence } from "../../studio/traceMark.ts"
import type { SongBrief } from "../../types/song_brief.ts"
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
      <h2 className="section-title">Alternatives</h2>
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
  const [inspect, setInspect] = useState<number | null>(null)
  const isMuted = muted.includes(layer)
  const pickedVariant = useStudio((state) => state.picks[layer])
  const board = pickedVariant ? variations.filter((item) => item.variant === pickedVariant) : variations
  const history = pickedVariant ? variations.filter((item) => item.variant !== pickedVariant) : []

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
      className="alt-lane outline-none"
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
        <>
          <div className="alt-board">
            {board.map((item) => (
              <Variation
                key={item.variant}
                result={item}
                take={take}
                ink={paint.ink}
                onInspect={() => setInspect(item.variant)}
              />
            ))}
          </div>
          {history.length > 0 ? (
            <div className="alt-history">
              <p className="section-title">History</p>
              <div className="alt-board">
                {history.map((item) => (
                  <Variation
                    key={item.variant}
                    result={item}
                    take={take}
                    ink={paint.ink}
                    onInspect={() => setInspect(item.variant)}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {inspect ? <InspectPanel key={`${layer}-${inspect}`} layer={layer} variant={inspect} onClose={() => setInspect(null)} /> : null}
        </>
      ) : (
        <p>Each layer comes back as three variations.</p>
      )}
    </motion.section>
  )
})

function ExplainPanel() {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const prompts = useStudio((state) => (state.turn?.status === "ready" ? state.turn.prompts : undefined))
  const trace = useStudio((state) => state.turn?.trace)
  const level = useLevel()
  const stamp = prompts?.map((item) => item.prompt).join("\n") ?? ""
  const [explanation, setExplanation] = useState<{ stamp: string; value: Explanation } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const current = explanation?.stamp === stamp ? explanation.value : null

  useEffect(() => {
    if (!brief || !prompts || prompts.length === 0) return
    let cancel = false
    explainResult({ brief, prompts, trace: trace ?? [], ...(level ? { depth: level } : {}) }).then(
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
  }, [brief, level, prompts, stamp, trace])

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
  ink,
  onInspect,
}: {
  result: RenderResult
  take: number
  ink: string
  onInspect: () => void
}) {
  const id = `${result.layer}:${result.variant}`
  const picked = useStudio((state) => state.picks[result.layer] === result.variant)
  const togglePick = useStudio((state) => state.togglePick)
  const sessionId = useStudio((state) => state.sessionId)
  const originalPath = useStudio((state) => state.originalPath)
  const playback = useSyncExternalStore(transport.subscribe, transport.getState, transport.getState)
  const seekRef = useRef<((seconds: number) => void) | null>(null)
  const sought = useRef<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const url = fileUrl(sessionId, result.path, take)
  const name = fileName(result.path)
  const title = layerTitle(result.layer)
  const letter = "ABC"[result.variant - 1] ?? String(result.variant)
  const originalId = `original:${result.layer}`
  const solo = playback.mode === "one" && playback.activeId === id
  const grouped = playback.mode === "together" && playback.togetherIds.includes(id)
  const moving = solo || grouped
  const hearingOriginal = playback.mode === "one" && playback.activeId === originalId

  useEffect(() => transport.register(id, url), [id, url])
  useEffect(() => {
    if (!originalPath) return
    return transport.register(originalId, fileUrl(sessionId, originalPath))
  }, [originalId, originalPath, sessionId])
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

  async function compare() {
    setProblem(null)
    try {
      await transport.playOne(hearingOriginal ? id : originalId)
    } catch {
      setProblem("The original did not play. Try again.")
    }
  }

  return (
    <article className="card alt-card" data-layer={result.layer} data-variant={result.variant} data-seconds={moving ? playback.seconds.toFixed(3) : undefined}>
      <h3 className="section-title">{letter}</h3>
      <Waveform url={url} label={`${title} variation ${result.variant} waveform`} seek={seekRef} wave={["#8B5CF6", lanePaint(result.layer).wave]} progress={lanePaint(result.layer).wave} height={40} />
      <p className="sr-only">{name}</p>
      <div className="flex flex-wrap gap-2">
        <Button tone="secondary" aria-pressed={solo} aria-label={solo ? `Pause ${title} variation ${result.variant}` : `Play ${title} variation ${result.variant}`} onClick={() => void toggle()} style={{ color: ink }}>
          {solo ? "Pause" : "Play"}
        </Button>
        {originalPath ? (
          <Button tone="secondary" aria-pressed={hearingOriginal} onClick={() => void compare()}>
            Compare with original
          </Button>
        ) : null}
        <Button tone="secondary" onClick={onInspect}>
          Inspect
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
      {problem ? <p role="alert">{problem}</p> : null}
    </article>
  )
}

function InspectPanel({ layer, variant, onClose }: { layer: string; variant: number; onClose: () => void }) {
  const sessionId = useStudio((state) => state.sessionId)
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const prompts = useStudio((state) => (state.turn?.status === "ready" ? state.turn.prompts : undefined))
  const trace = useStudio((state) => state.turn?.trace ?? [])
  const renders = useStudio((state) => state.renders)
  const result = renders.find((item) => item.layer === layer && item.variant === variant)
  const prompt = prompts?.find((item) => item.layer === layer)
  const [notes, setNotes] = useState<RollNote[] | null>(null)
  const bars = barCount(brief?.slots.structure?.value, result)
  const kind = midiKind(layer)

  useEffect(() => {
    if (!result || !kind) return
    let cancel = false
    const path = `midi/verse_${kind}_${result.bpm}bpm_${bars}bars.mid`
    void fetch(fileUrl(sessionId, path))
      .then(async (response) => {
        if (!response.ok) return []
        return readRoll(new Uint8Array(await response.arrayBuffer()))
      })
      .then((roll) => {
        if (!cancel) setNotes(roll)
      })
      .catch(() => {
        if (!cancel) setNotes([])
      })
    return () => {
      cancel = true
    }
  }, [bars, kind, result, sessionId])

  const details = detailLines(brief, layer)
  const reasoning = trace.map((step) => traceSentence(step)).filter((line) => line.length > 0)

  return (
    <aside className="card inspect-panel" aria-label="Inspect">
      <div className="flex items-center justify-between gap-3">
        <h3 className="section-title">
          {layerTitle(layer)} {"ABC"[variant - 1] ?? variant}
        </h3>
        <Button tone="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <h4 className="section-title">MIDI</h4>
      <PianoRoll notes={kind ? notes : []} />
      <h4 className="section-title">Prompt</h4>
      <p>{prompt?.prompt || "The prompt appears after the review is written."}</p>
      <h4 className="section-title">Chosen details</h4>
      {details.length > 0 ? (
        <ul>
          {details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-secondary">Details appear as the brief fills in.</p>
      )}
      <h4 className="section-title">Reasoning</h4>
      {reasoning.length > 0 ? (
        <ul>
          {reasoning.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-secondary">The trace appears as the idea is read.</p>
      )}
    </aside>
  )
}

function PianoRoll({ notes }: { notes: RollNote[] | null }) {
  if (!notes) return <p className="text-secondary">Reading the MIDI.</p>
  if (notes.length === 0) return <p className="text-secondary">This alternative has no MIDI file.</p>
  const low = Math.min(...notes.map((note) => note.pitch))
  const high = Math.max(...notes.map((note) => note.pitch))
  const span = Math.max(1, high - low)
  const end = Math.max(...notes.map((note) => note.end), 1)
  return (
    <div className="piano-roll" role="img" aria-label={`Piano roll, ${notes.length} notes`}>
      {notes.map((note, index) => (
        <span
          key={`${note.pitch}-${note.start}-${index}`}
          className="piano-note"
          style={{
            left: `${(note.start / end) * 100}%`,
            width: `${Math.max(1.2, ((note.end - note.start) / end) * 100)}%`,
            bottom: `${((note.pitch - low) / (span + 1)) * 100}%`,
            height: `${100 / (span + 1)}%`,
          }}
        />
      ))}
    </div>
  )
}

function midiKind(layer: string): "chords" | "bass" | null {
  const name = layer.replace(/_[ab]$/, "")
  if (name === "chords" || name === "bass") return name
  return null
}

function barCount(structure: string | undefined, result: RenderResult | undefined): number {
  const named = structure?.match(/\d+/)
  if (named) return Number(named[0])
  if (!result || result.bpm <= 0) return 8
  return Math.max(1, Math.round(result.seconds / ((60 / result.bpm) * 4)))
}

function detailLines(brief: SongBrief | null, layer: string): string[] {
  if (!brief) return []
  const lines = Object.entries(brief.slots).flatMap(([name, slot]) => (slot?.value ? [`${name.replaceAll("_", " ")}: ${slot.value}`] : []))
  const facets = (brief.facets ?? []).filter((facet) => facet.layer === layer || facet.layer === layer.replace(/_[ab]$/, ""))
  return [...lines, ...facets.map((facet) => `${facet.id.replaceAll("_", " ")}: ${facet.value}`)]
}
