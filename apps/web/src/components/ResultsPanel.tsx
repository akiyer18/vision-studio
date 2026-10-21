import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import { fileName, fileUrl } from "../api/client.ts"
import { transport } from "../playback/transport.ts"
import { useStudio } from "../state/studio.ts"
import type { ExportListing } from "../state/studio.ts"
import type { RenderResult } from "../types/render_result.ts"
import { exportCurrent, regenerateLayer, renderCurrent } from "../studio/renderSession.ts"
import { layerTitle } from "../studio/output.ts"
import { Button } from "./Button.tsx"
import { GlassPanel } from "./GlassPanel.tsx"
import { MonoLine } from "./MonoLine.tsx"
import { Waveform } from "./Waveform.tsx"

export function ResultsPanel() {
  const layerOrder = useStudio((state) => state.layerOrder)
  const renders = useStudio((state) => state.renders)
  const listing = useStudio((state) => state.exportListing)
  const exportError = useStudio((state) => state.exportError)
  const runId = useStudio((state) => state.runId)
  const playback = useSyncExternalStore(transport.subscribe, transport.getState, transport.getState)
  const heading = useRef<HTMLHeadingElement>(null)
  const seen = useRef(0)
  const [togetherNote, setTogetherNote] = useState<{ tone: "dust" | "clip"; text: string } | null>(null)
  const together = playback.mode === "together"

  useEffect(() => {
    if (runId === 0 || seen.current === runId) return
    seen.current = runId
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    heading.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" })
    heading.current?.focus()
  }, [runId])

  async function playTogether() {
    setTogetherNote(null)
    if (transport.getState().mode === "together") {
      transport.stop()
      return
    }
    const state = useStudio.getState()
    const ids = state.layerOrder.flatMap((layer) => {
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
      setTogetherNote({ tone: "clip", text: "The layers could not be played together. Try again." })
    }
  }

  return (
    <GlassPanel className="min-w-0 desk:col-span-3">
      <section className="flex min-w-0 flex-col gap-4">
        <h2
          id="results"
          ref={heading}
          tabIndex={-1}
          className="scroll-mt-24 font-serif text-xl outline-none focus:outline-2 focus:outline-offset-2 focus:outline-vu-amber"
        >
          Results
        </h2>
        {layerOrder.length === 0 ? (
          <p className="text-sm text-dust">Send the prompts to Stable Audio, and the variations land here.</p>
        ) : null}
        {layerOrder.length > 0 && renders.length > 0 ? (
          <div className="flex flex-col items-start gap-2">
            <Button
              tone="secondary"
              aria-pressed={together}
              aria-label={together ? "Pause together" : "Play together"}
              onClick={() => void playTogether()}
            >
              {together ? "Pause" : "Play together"}
            </Button>
            {togetherNote ? (
              <p role="status" className={togetherNote.tone === "clip" ? "text-sm text-clip-red" : "text-sm text-dust"}>
                {togetherNote.text}
              </p>
            ) : null}
          </div>
        ) : null}
        {layerOrder.map((layer) => (
          <LayerBlock key={layer} layer={layer} />
        ))}
        {layerOrder.length > 0 && renders.length > 0 ? (
          <div className="flex flex-col items-start gap-3">
            <Button onClick={() => void exportCurrent()}>Export to Logic</Button>
            {exportError ? (
              <p role="alert" className="text-sm text-clip-red">
                {exportError}
              </p>
            ) : null}
            {listing ? <ExportList listing={listing} /> : null}
          </div>
        ) : null}
      </section>
    </GlassPanel>
  )
}

function LayerBlock({ layer }: { layer: string }) {
  const run = useStudio((state) => state.runs[layer])
  const failure = useStudio((state) => state.failures[layer])
  const renders = useStudio((state) => state.renders)
  const take = useStudio((state) => state.takes[layer] ?? 1)
  const variations = renders.filter((item) => item.layer === layer).sort((left, right) => left.variant - right.variant)
  const title = layerTitle(layer)

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-serif text-2xl">{title}</h3>
        {variations.length > 0 && !failure && !run ? (
          <Button tone="secondary" aria-label={`Another take for ${title}`} onClick={() => void regenerateLayer(layer)}>
            Another take
          </Button>
        ) : null}
      </div>
      {run ? (
        <div role="status" className="rounded-button border border-walnut-line bg-studio-night px-3 py-2">
          <MonoLine>{`${layer}: rendering take ${run.take}, variation ${run.variant} of ${run.total}`}</MonoLine>
        </div>
      ) : null}
      {failure ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-clip-red">
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
      {variations.map((result) => (
        <Variation key={`${result.layer}:${result.variant}:${take}`} result={result} take={take} />
      ))}
    </section>
  )
}

function Variation({ result, take }: { result: RenderResult; take: number }) {
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
  const solo = playback.mode === "one" && playback.activeId === id
  const grouped = playback.mode === "together" && playback.togetherIds.includes(id)
  const moving = solo || grouped
  const title = layerTitle(result.layer)

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
    <article
      className="flex min-w-0 flex-col gap-2 border-t border-walnut-line pt-3"
      data-layer={result.layer}
      data-variant={result.variant}
      data-seconds={moving ? playback.seconds.toFixed(3) : undefined}
    >
      <Waveform url={url} label={`${title} variation ${result.variant} waveform`} seek={seekRef} />
      <p className="truncate text-sm text-dust">{name}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          tone="secondary"
          aria-pressed={solo}
          aria-label={solo ? `Pause ${title} variation ${result.variant}` : `Play ${title} variation ${result.variant}`}
          onClick={() => void toggle()}
        >
          {solo ? "Pause" : "Play"}
        </Button>
        <Button
          tone={picked ? "primary" : "secondary"}
          aria-pressed={picked}
          aria-label={`Pick ${title} variation ${result.variant}`}
          onClick={() => togglePick(result.layer, result.variant)}
        >
          Pick
        </Button>
        <Button tone="ghost" aria-label={`Download ${title} variation ${result.variant}`} onClick={() => void download()}>
          Download
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="text-sm text-clip-red">
          {problem}
        </p>
      ) : null}
    </article>
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
      {listing.defaults ? (
        <p className="text-sm text-dust">Nothing was picked, so variation 1 of each layer was exported.</p>
      ) : null}
      <p className="break-all text-sm text-tape-cream">{listing.folder}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button tone="secondary" onClick={() => void copy()}>
          Copy path
        </Button>
        {copied ? <span className="text-sm text-dust">Copied.</span> : null}
        {copyError ? (
          <p role="alert" className="text-sm text-clip-red">
            {copyError}
          </p>
        ) : null}
      </div>
      <ul aria-label="Exported files" className="flex flex-col gap-1">
        {listing.files.map((file) => (
          <li key={file} className="break-all text-sm text-dust">
            {fileName(file)}
          </li>
        ))}
      </ul>
    </div>
  )
}
