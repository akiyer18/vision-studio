import { lazy, Suspense, useEffect, useRef, useState } from "react"

import { inputBridge } from "../../input/bridge.ts"
import { transport } from "../../playback/transport.ts"
import { currentIdea, noteIdea, saveRecent } from "../../recentIdeas.ts"
import { useStudio } from "../../state/studio.ts"
import { useTour } from "../../tour.ts"
import { Composer } from "../composer/Composer.tsx"
import { BriefCard } from "../brief/BriefCard.tsx"
import { ReasoningCard } from "../reasoning/ReasoningCard.tsx"
import { Sidebar } from "../sidebar/Sidebar.tsx"
import { Thread, type Bubble } from "../thread/Thread.tsx"
import { Tour } from "../tour/Tour.tsx"
import { Insight } from "./Insight.tsx"
import { Readouts } from "./Readouts.tsx"
import { Transport } from "./Transport.tsx"
import { GenreRoom, type GenreDetail } from "../genre/GenreRoom.tsx"

const PlayerBar = lazy(() => import("../layers/stage.tsx").then((module) => ({ default: module.PlayerBar })))
const LayersView = lazy(() => import("../layers/stage.tsx").then((module) => ({ default: module.LayersView })))

const demoQuery = new URLSearchParams(window.location.search).get("demo") === "1"

export function Dashboard() {
  const sessionId = useStudio((state) => state.sessionId)
  const turn = useStudio((state) => state.turn)
  const renders = useStudio((state) => state.renders)
  const layerOrder = useStudio((state) => state.layerOrder)
  const status = useStudio((state) => state.status)
  const thread = useStudio((state) => state.thread)
  const tour = useTour()
  const [room, setRoom] = useState<"create" | "genre">("create")
  const mode = useStudio((state) => state.mode)
  const [mark, setMark] = useState<string | null>(null)
  const [talking, setTalking] = useState(false)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [stamp, setStamp] = useState(sessionId)
  const synced = useRef(sessionId)
  if (stamp !== sessionId) {
    setStamp(sessionId)
    setBubbles(thread)
    setTalking(thread.length > 0 || turn !== null)
  }

  useEffect(() => {
    if (!turn) {
      synced.current = sessionId
      return
    }
    if (synced.current !== sessionId) {
      synced.current = sessionId
      return
    }
    const noted = currentIdea()
    saveRecent({
      id: sessionId,
      sessionId,
      idea: noted.idea,
      audioOnly: noted.audioOnly,
      brief: turn.brief,
      prompts: turn.prompts ?? [],
      layers: turn.brief.output,
      renders: renders.map((item) => ({ layer: item.layer, variant: item.variant, path: item.path, seconds: item.seconds, bpm: item.bpm })),
      thread: bubbles,
      trace: turn.trace,
      mode,
      question: turn.question,
      status: turn.status,
    })
  }, [turn, renders, bubbles, sessionId, mode])

  const started = talking || turn !== null
  const showLayers = renders.length > 0 || (status === "working" && layerOrder.length > 0)

  function describe() {
    document.getElementById("idea")?.focus()
  }

  function addBubble(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    setBubbles((current) => [...current, { id: current.reduce((max, item) => Math.max(max, item.id), 0) + 1, text: trimmed, role: "you" }])
  }

  function addExchange(question: string, answer: string) {
    const trimmed = answer.trim()
    if (!question.trim() || !trimmed) return
    setBubbles((current) => [...current, { id: current.reduce((max, item) => Math.max(max, item.id), 0) + 1, text: trimmed, role: "agent", prompt: question }])
  }

  function useGenre(genre: GenreDetail) {
    transport.stop()
    noteIdea(`Using ${genre.title}.`, false)
    useStudio.getState().resetSession()
    useStudio.getState().showReference(genre.prefill, `Using ${genre.title}.`)
    setRoom("create")
    setTalking(true)
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

  const sessionName = bubbles.find((item) => item.role === "you" && !item.prompt)?.text || "New session"

  const hot = status === "working"

  return (
    <div className="studio-root">
      <div className="grain" aria-hidden="true" />
      <div className="studio-shell">
        <Sidebar room={room} onRoom={setRoom} onReplay={tour.replay} />
        {room === "genre" ? (
          <main className="studio-main">
            <GenreRoom onUse={useGenre} />
          </main>
        ) : (
          <main className="studio-main">
            <Transport sessionName={sessionName} />
            <Readouts />
            <div className="studio-split">
              <section className={`card conversation-card p-5 ${hot ? "is-hot" : ""}`} aria-label="Conversation">
                <h2 className="section-title">Conversation</h2>
                <Thread bubbles={bubbles} onExchange={addExchange} showLayers={false} showDemo={demoQuery} />
                <div className="studio-composer">
                  <Composer started={started} onBegin={() => setTalking(true)} onBubble={addBubble} onExchange={addExchange} />
                </div>
              </section>
              <div className="brief-column">
                <BriefCard mark={mark} onDescribe={describe} hot={hot} />
                {turn ? <ReasoningCard mark={mark} onMark={setMark} onDescribe={describe} /> : null}
              </div>
            </div>
            {showLayers ? (
              <section className={`card p-5 ${hot ? "is-hot" : ""}`} aria-label="Results">
                <Suspense fallback={<p className="text-secondary">Opening the takes.</p>}>
                  <LayersView />
                </Suspense>
              </section>
            ) : null}
            <Insight />
            {showLayers ? (
              <Suspense fallback={<p className="studio-player px-4 py-3 text-secondary">Opening the player.</p>}>
                <PlayerBar onStartOver={startOver} />
              </Suspense>
            ) : null}
          </main>
        )}
      </div>
      <Tour open={tour.open} onClose={tour.finish} />
    </div>
  )
}
