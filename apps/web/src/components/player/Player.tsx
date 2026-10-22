import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import { fileName } from "../../api/client.ts"
import { transport } from "../../playback/transport.ts"
import { audibleLayers } from "../../studio/mix.ts"
import { exportCurrent } from "../../studio/renderSession.ts"
import { useStudio } from "../../state/studio.ts"
import { Button } from "../Button.tsx"

export function PlayerBar({ onStartOver }: { onStartOver: () => void }) {
  const listing = useStudio((state) => state.exportListing)
  const exportError = useStudio((state) => state.exportError)
  const playback = useSyncExternalStore(transport.subscribe, transport.getState, transport.getState)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const playRef = useRef<() => void>(() => undefined)
  const playing = playback.mode === "together"

  async function startTogether(): Promise<boolean> {
    const state = useStudio.getState()
    const ids = audibleLayers(state.layerOrder.length > 0 ? state.layerOrder : uniqueLayers(state.renders)).flatMap((layer) => {
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
    useStudio.getState().hear()
    return true
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
      if (target.closest("input, textarea, select, button, a")) return
      if (document.getElementById("shortcut-help")?.contains(target)) return
      event.preventDefault()
      playRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  async function send() {
    setPending(true)
    await exportCurrent()
    setPending(false)
  }

  async function copy() {
    if (!listing) return
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(listing.folder)
      setCopied(true)
    } catch {
      setCopyError("The path could not be copied.")
    }
  }

  return (
    <div className="studio-player px-4 py-3">
      <div className="flex w-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {problem || exportError ? (
            <Button
              onClick={() => {
                if (exportError) void send()
                else void startTogether()
              }}
            >
              Try again
            </Button>
          ) : (
            <Button aria-label={playing ? "Stop the layers" : "Play together"} onClick={() => void (playing ? transport.stop() : startTogether())}>
              {playing ? "Stop" : "Play together"}
            </Button>
          )}
          {exportError ? null : (
            <Button tone="secondary" disabled={pending} onClick={() => void send()}>
              Export to Logic
            </Button>
          )}
          <Button tone="ghost" onClick={onStartOver}>
            Start a new idea
          </Button>
        </div>
        {problem ? <p role="alert" className="text-danger">{problem}</p> : null}
        {exportError ? <p role="alert" className="text-danger">{exportError}</p> : null}
        {listing ? (
          <div className="flex flex-col gap-2">
            {listing.defaults ? <p className="text-sm text-secondary">Nothing was picked, so variation 1 of each layer was exported.</p> : null}
            <p className="break-all text-sm text-ink">{listing.folder}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="text-xs text-secondary" onClick={() => void copy()}>
                Copy path
              </button>
              {copied ? <span className="text-sm text-secondary">Copied.</span> : null}
              {copyError ? <p role="alert" className="text-sm text-danger">{copyError}</p> : null}
            </div>
            <ul aria-label="Exported files" className="flex flex-col gap-1 text-sm text-secondary">
              {listing.files.map((file) => (
                <li key={file} className="mono break-all">
                  {fileName(file)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-secondary">Variation 1 is used for any layer you did not pick.</p>
        )}
      </div>
    </div>
  )
}

function uniqueLayers(renders: { layer: string }[]): string[] {
  const seen: string[] = []
  for (const item of renders) {
    if (!seen.includes(item.layer)) seen.push(item.layer)
  }
  return seen
}
