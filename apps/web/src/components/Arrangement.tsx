import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react"

import { fileName } from "../api/client.ts"
import { SLOT_LABEL } from "../brief/slots.ts"
import { transport } from "../playback/transport.ts"
import { useStudio } from "../state/studio.ts"
import type { ExportListing } from "../state/studio.ts"
import type { LayerPrompt } from "../types/layer_prompt.ts"
import { barsFromStructure, bpmFromPrompt, clipLength, layerTitle } from "../studio/output.ts"
import { LANES, lanePaint } from "../studio/lanes.ts"
import { audibleLayers } from "../studio/mix.ts"
import { polishNote } from "../studio/traceMark.ts"
import { exportCurrent, regenerateLayer, renderCurrent } from "../studio/renderSession.ts"
import { BriefPanel } from "./BriefPanel.tsx"
import { Button } from "./Button.tsx"
import { ChannelStrip } from "./ChannelStrip.tsx"
import { Clip } from "./Clip.tsx"
import { PromptCard } from "./PromptCard.tsx"
import { Skeleton } from "./Skeleton.tsx"

export function Arrangement({ mark }: { mark: string | null }) {
  const turn = useStudio((state) => state.turn)
  const status = useStudio((state) => state.status)
  const runId = useStudio((state) => state.runId)
  const renders = useStudio((state) => state.renders)
  const layerOrder = useStudio((state) => state.layerOrder)
  const listing = useStudio((state) => state.exportListing)
  const exportError = useStudio((state) => state.exportError)
  const playback = useSyncExternalStore(transport.subscribe, transport.getState, transport.getState)
  const studio = useRef<HTMLElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const moved = useRef<typeof turn>(null)
  const seen = useRef(0)
  const [sweep, setSweep] = useState(false)
  const [phase, setPhase] = useState(status)
  const [armed, setArmed] = useState(false)
  if (status !== phase) {
    setPhase(status)
    if (status === "working") setArmed(true)
    else if (armed && status === "ready" && renders.length > 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setArmed(false)
      setSweep(true)
    } else setArmed(false)
  }
  const [togetherNote, setTogetherNote] = useState<{ tone: "dust" | "fault"; text: string } | null>(null)
  const ready = turn?.status === "ready"
  const prompts = ready ? (turn.prompts ?? []) : []
  const loading = status === "working" && prompts.length === 0 && renders.length === 0
  const together = playback.mode === "together"
  const playRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    if (!ready || moved.current === turn) return
    moved.current = turn
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    studio.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" })
    studio.current?.focus()
  }, [ready, turn])

  useEffect(() => {
    if (runId === 0 || seen.current === runId) return
    seen.current = runId
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    results.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" })
    results.current?.focus()
  }, [runId])

  async function playTogether() {
    setTogetherNote(null)
    if (transport.getState().mode === "together") {
      transport.stop()
      return
    }
    const state = useStudio.getState()
    const ids = audibleLayers(state.layerOrder).flatMap((layer) => {
      const variant = state.picks[layer] ?? 1
      const match = state.renders.some((item) => item.layer === layer && item.variant === variant)
      return match ? [`${layer}:${variant}`] : []
    })
    if (ids.length === 0) {
      setTogetherNote({ tone: "dust", text: "Wait for the variations to finish, then play them together." })
      return
    }
    try {
      await transport.playTogether(ids)
    } catch {
      setTogetherNote({ tone: "fault", text: "The layers could not be played together. Try again." })
    }
  }

  useEffect(() => {
    playRef.current = () => {
      if (transport.getState().mode !== "idle") {
        transport.stop()
        return
      }
      void playTogether()
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

  return (
    <section
      id="prompt-studio"
      ref={studio}
      tabIndex={-1}
      className="flex min-w-0 scroll-mt-40 flex-col gap-4 p-4 outline-none focus:outline-2 focus:outline-offset-2 focus:outline-lamp"
    >
      <BriefPanel mark={mark} />
      {theoryLine(turn) ? <p className="text-lamp">{theoryLine(turn)}</p> : null}
      <StructureMark mark={mark} />
      <div
        id="results"
        ref={results}
        tabIndex={-1}
        className="relative scroll-mt-40 outline-none focus:outline-2 focus:outline-offset-2 focus:outline-lamp"
        aria-busy={loading || undefined}
      >
        {sweep ? <div className="playhead" aria-hidden onAnimationEnd={() => setSweep(false)} /> : null}
        {turn === null ? <p className="mb-3 text-dust">Describe an idea and the lanes will fill.</p> : null}
        {loading ? <p className="sr-only">The prompts are loading.</p> : null}
        {layerOrder.length > 0 && renders.length > 0 ? (
          <div className="mb-3 flex flex-col items-start gap-2">
            <Button
              tone="secondary"
              aria-pressed={together}
              aria-label={together ? "Pause together" : "Play together"}
              onClick={() => void playTogether()}
            >
              {together ? "Pause" : "Play together"}
            </Button>
            {togetherNote ? (
              <p role="status" className={togetherNote.tone === "fault" ? "text-fault" : "text-dust"}>
                {togetherNote.text}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col">
          {LANES.map((layer) => (
            <Lane
              key={layer}
              layer={layer}
              prompt={prompts.find((item) => item.layer === layer) ?? null}
              marked={mark === layer}
              reveal={sweep}
              loading={loading}
            />
          ))}
        </div>
        {layerOrder.length > 0 && renders.length > 0 ? (
          <div className="mt-4 flex flex-col items-start gap-3">
            <Button onClick={() => void exportCurrent()}>Export to Logic</Button>
            {exportError ? (
              <p role="alert" className="text-fault">
                {exportError}
              </p>
            ) : null}
            {listing ? <ExportList listing={listing} /> : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function Lane({
  layer,
  prompt,
  marked,
  reveal,
  loading,
}: {
  layer: string
  prompt: LayerPrompt | null
  marked: boolean
  reveal: boolean
  loading: boolean
}) {
  const edits = useStudio((state) => state.promptEdits)
  const editPrompt = useStudio((state) => state.editPrompt)
  const resetPrompt = useStudio((state) => state.resetPrompt)
  const run = useStudio((state) => state.runs[layer])
  const failure = useStudio((state) => state.failures[layer])
  const renders = useStudio((state) => state.renders)
  const take = useStudio((state) => state.takes[layer] ?? 1)
  const solo = useStudio((state) => state.solo)
  const muted = useStudio((state) => state.muted)
  const trace = useStudio((state) => state.turn?.trace)
  const toggleSolo = useStudio((state) => state.toggleSolo)
  const toggleMute = useStudio((state) => state.toggleMute)
  const setFocusedLane = useStudio((state) => state.setFocusedLane)
  const [open, setOpen] = useState(false)
  const title = layerTitle(layer)
  const paint = lanePaint(layer)
  const variations = renders.filter((item) => item.layer === layer).sort((left, right) => left.variant - right.variant)
  const edit = edits[layer]
  const written = edit?.prompt ?? prompt?.prompt ?? ""
  const polish = polishNote(trace ?? [], layer)
  const filled = Boolean(prompt) || variations.length > 0

  function onKey(event: ReactKeyboardEvent<HTMLDivElement>) {
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
      className={`border-b border-rule px-3 py-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp ${layer === "full_mix" ? "border-y-2" : ""} ${marked ? "outline outline-2 outline-offset-2 outline-lamp" : ""}`}
      style={{ borderLeft: `3px solid ${filled ? paint.fill : "var(--rule)"}` }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="lane-name text-lamp">{title}</h3>
        <Button tone="secondary" aria-pressed={solo === layer} aria-label={`Solo ${title}`} onClick={() => toggleSolo(layer)}>
          Solo
        </Button>
        <Button
          tone="secondary"
          aria-pressed={muted.includes(layer)}
          aria-label={`Mute ${title}`}
          onClick={() => toggleMute(layer)}
        >
          Mute
        </Button>
        {variations.length > 0 && !failure && !run ? (
          <Button tone="secondary" aria-label={`Another take for ${title}`} onClick={() => void regenerateLayer(layer)}>
            Another take
          </Button>
        ) : null}
        <span className="text-dust">
          {laneStatus(run, failure?.message, muted.includes(layer), solo === layer, variations.length > 0)}
        </span>
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
            aria-label={`Retry ${title}`}
            onClick={() => void (failure.action === "regenerate" ? regenerateLayer(layer) : renderCurrent(layer))}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {loading && !prompt ? <Skeleton className="mt-3 h-16 w-full" /> : null}
      {prompt ? (
        <button
          type="button"
          className="mt-3 max-w-full text-left text-lamp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="line-clamp-2">{written}</span>
        </button>
      ) : variations.length === 0 && !loading ? (
        <div className="mt-3 min-h-12 border border-rule" />
      ) : null}
      {open && prompt ? (
        <div className="mt-3">
          <PromptCard
            embedded
            original={prompt}
            prompt={written}
            negative={edit?.negative ?? prompt.negative}
            polish={polish}
            onPrompt={(value) => editPrompt(layer, "prompt", value)}
            onNegative={(value) => editPrompt(layer, "negative", value)}
            onReset={() => resetPrompt(layer)}
          />
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
}

function StructureMark({ mark }: { mark: string | null }) {
  const brief = useStudio((state) => state.turn?.brief ?? null)
  const overrides = useStudio((state) => state.overrides)
  const queueOverride = useStudio((state) => state.queueOverride)
  const filled = brief?.slots.structure
  const pending = overrides.structure
  const value = pending ?? filled?.value ?? ""
  const bars = value ? barsFromStructure(value) : 0
  return (
    <div data-slot="structure" className="flex flex-col gap-2">
      {bars > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <span className="text-dust">Verse</span>
          {Array.from({ length: bars }, (_, index) => (
            <span key={index} className="tabular text-dust">
              {index + 1}
            </span>
          ))}
        </div>
      ) : null}
      <ChannelStrip
        label={SLOT_LABEL.structure}
        value={value}
        source={pending ? "you" : filled?.source}
        confidence={filled?.confidence ?? 0}
        reason={pending ? "This will go with the next turn." : (filled?.reason ?? "This has not been set.")}
        onChange={(next) => queueOverride("structure", next)}
        marked={mark === "structure"}
      />
    </div>
  )
}

function ExportList({ listing }: { listing: ExportListing }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  async function copy() {
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(listing.folder)
      setCopied(true)
    } catch {
      setCopyError("The path could not be copied.")
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {listing.defaults ? <p className="text-dust">Nothing was picked, so variation 1 of each layer was exported.</p> : null}
      <p className="break-all text-lamp">{listing.folder}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button tone="secondary" onClick={() => void copy()}>
          Copy path
        </Button>
        {copied ? <span className="text-dust">Copied.</span> : null}
        {copyError ? (
          <p role="alert" className="text-fault">
            {copyError}
          </p>
        ) : null}
      </div>
      <ul aria-label="Exported files" className="flex flex-col gap-1">
        {listing.files.map((file) => (
          <li key={file} className="break-all text-dust">
            {fileName(file)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function theoryLine(turn: ReturnType<typeof useStudio.getState>["turn"]): string {
  const progression = turn?.progression
  const key = turn?.brief.slots.key?.value
  const bars = barsFromStructure(turn?.brief.slots.structure?.value)
  const bpm = bpmFromPrompt(turn?.prompts?.[0]?.prompt ?? "")
  const parts = [progression?.roman.join(" "), progression?.chords.join(" "), key, bpm ? clipLength(bars, bpm) : null].filter(
    (part): part is string => Boolean(part),
  )
  return parts.join(" · ")
}

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
  if (solo) return "Solo"
  if (muted) return "Muted"
  return ""
}
