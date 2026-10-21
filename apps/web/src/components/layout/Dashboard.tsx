import { Menu } from "lucide-react"
import { lazy, Suspense, useRef, useState } from "react"

import { inputBridge } from "../../input/bridge.ts"
import { transport } from "../../playback/transport.ts"
import { useStudio } from "../../state/studio.ts"
import { useTour } from "../../tour.ts"
import { Composer } from "../composer/Composer.tsx"
import { BriefCard } from "../brief/BriefCard.tsx"
import { LayersCard } from "../layers/LayersCard.tsx"
import { ReasoningCard } from "../reasoning/ReasoningCard.tsx"
import { Sidebar } from "../sidebar/Sidebar.tsx"
import { Thread, type Bubble } from "../thread/Thread.tsx"
import { Tour } from "../tour/Tour.tsx"
import { GettingStarted } from "./GettingStarted.tsx"

const PlayerBar = lazy(() => import("../layers/stage.tsx").then((module) => ({ default: module.PlayerBar })))

const demoQuery = new URLSearchParams(window.location.search).get("demo") === "1"

export function Dashboard() {
  const sessionId = useStudio((state) => state.sessionId)
  const turn = useStudio((state) => state.turn)
  const renders = useStudio((state) => state.renders)
  const layerOrder = useStudio((state) => state.layerOrder)
  const status = useStudio((state) => state.status)
  const tour = useTour()
  const [open, setOpen] = useState(false)
  const [mark, setMark] = useState<string | null>(null)
  const [talking, setTalking] = useState(false)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [stamp, setStamp] = useState(sessionId)
  const nextId = useRef(1)
  if (stamp !== sessionId) {
    setStamp(sessionId)
    setTalking(false)
    setBubbles([])
  }

  const started = talking || turn !== null
  const showLayers = renders.length > 0 || (status === "working" && layerOrder.length > 0)

  function describe() {
    document.getElementById("idea")?.focus()
  }

  function addBubble(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const id = nextId.current
    nextId.current += 1
    setBubbles((current) => [...current, { id, text: trimmed }])
  }

  function startOver() {
    transport.stop()
    useStudio.getState().resetSession()
    try {
      inputBridge().apply("", null)
    } catch {
      /* The composer is mounted with the dashboard. */
    }
  }

  return (
    <div className="studio-root">
      <button type="button" className="studio-menu size-11 items-center justify-center rounded-full border border-white/15 bg-canvas text-ink" aria-label="Open the menu" onClick={() => setOpen(true)}>
        <Menu size={18} aria-hidden />
      </button>
      {open ? (
        <button type="button" className="fixed inset-0 z-40 bg-black/50 min-[768px]:hidden" aria-label="Close the menu" onClick={() => setOpen(false)} />
      ) : null}
      <div className={`studio-shell ${showLayers ? "has-player" : ""} ${started ? "" : "is-home"}`}>
        <Sidebar open={open} onClose={() => setOpen(false)} onReplay={tour.replay} />
        <div className="studio-canvas">
          <Thread started={started} bubbles={bubbles} onBubble={addBubble} showLayers={showLayers} showDemo={demoQuery} />
          <div className="studio-composer">
            <Composer started={started} onBegin={() => setTalking(true)} onBubble={addBubble} />
          </div>
        </div>
        <div className="studio-rail px-2 py-4" role="radiogroup" aria-label="Song details">
          <input id="rail-brief" className="sr-only" type="radio" name="rail" defaultChecked />
          <input id="rail-reasoning" className="sr-only" type="radio" name="rail" />
          <input id="rail-layers" className="sr-only" type="radio" name="rail" />
          <div className="rail-tabs mb-3 gap-2">
            <label htmlFor="rail-brief" className="rounded-full border border-white/15 px-3 py-1 text-sm text-secondary">
              Brief
            </label>
            <label htmlFor="rail-reasoning" className="rounded-full border border-white/15 px-3 py-1 text-sm text-secondary">
              Reasoning
            </label>
            <label htmlFor="rail-layers" className="rounded-full border border-white/15 px-3 py-1 text-sm text-secondary">
              Layers
            </label>
          </div>
          <div className="rail-stack flex flex-col gap-4">
            {turn ? (
              <>
                <BriefCard mark={mark} onDescribe={describe} />
                <ReasoningCard mark={mark} onMark={setMark} onDescribe={describe} />
                <LayersCard />
              </>
            ) : (
              <>
                <GettingStarted />
                <LayersCard />
              </>
            )}
          </div>
        </div>
        {showLayers ? (
          <Suspense fallback={<p className="studio-player px-4 py-3 text-secondary">Opening the player.</p>}>
            <PlayerBar onStartOver={startOver} />
          </Suspense>
        ) : null}
      </div>
      <Tour open={tour.open} onClose={tour.finish} />
    </div>
  )
}
