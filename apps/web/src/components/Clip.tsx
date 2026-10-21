import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import { fileName, fileUrl } from "../api/client.ts"
import { transport } from "../playback/transport.ts"
import { layerTitle } from "../studio/output.ts"
import { useStudio } from "../state/studio.ts"
import type { RenderResult } from "../types/render_result.ts"
import { lanePaint } from "../studio/lanes.ts"
import { Button } from "./Button.tsx"
import { Waveform } from "./Waveform.tsx"

export function Clip({ result, take, reveal }: { result: RenderResult; take: number; reveal: boolean }) {
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
  const paint = lanePaint(result.layer)

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
    <div className={`flex min-w-0 flex-col gap-2 ${reveal ? "lane-reveal" : ""}`}>
      <article
        className="flex min-w-0 flex-col gap-2 p-3"
        style={{
          background: paint.fill,
          color: paint.ink,
          border: "1px solid var(--lamp)",
          boxShadow: result.layer === "full_mix" ? "0 0 0 1px var(--rule)" : undefined,
        }}
        data-layer={result.layer}
        data-variant={result.variant}
        data-seconds={moving ? playback.seconds.toFixed(3) : undefined}
      >
        <p className="lane-name" style={{ color: paint.ink }}>
          {title}
        </p>
        <Waveform
          url={url}
          label={`${title} variation ${result.variant} waveform`}
          seek={seekRef}
          wave={paint.wave}
          progress={paint.progress}
        />
        <p className="truncate" style={{ color: paint.ink }}>
          {name}
        </p>
      </article>
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
        <p role="alert" className="text-fault">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
