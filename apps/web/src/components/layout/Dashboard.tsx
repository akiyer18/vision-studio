import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { inputBridge } from "../../input/bridge.ts"
import { transport } from "../../playback/transport.ts"
import { currentIdea, noteIdea, saveRecent } from "../../recentIdeas.ts"
import { features } from "../../features.ts"
import { go, usePage } from "../../route.ts"
import { useStudio } from "../../state/studio.ts"
import type { SongBrief } from "../../types/song_brief.ts"
import { useTour } from "../../tour.ts"
import { Composer } from "../composer/Composer.tsx"
import { ReasoningCard } from "../reasoning/ReasoningCard.tsx"
import { Sidebar } from "../sidebar/Sidebar.tsx"
import { ReviewStage } from "../thread/ReviewStage.tsx"
import { Thread, type Bubble } from "../thread/Thread.tsx"
import { Tour } from "../tour/Tour.tsx"
import { GenreRoom, type GenreDetail } from "../genre/GenreRoom.tsx"
import { Skeleton } from "../Skeleton.tsx"
import { BriefDrawer } from "./BriefDrawer.tsx"
import { Home } from "./Home.tsx"
import { PageHeader } from "./PageHeader.tsx"
import { TrainRoom } from "../train/TrainRoom.tsx"
import { PagePane } from "./PagePane.tsx"
import { GoalCard } from "./GoalCard.tsx"
import { SessionStatus, Transport } from "./Transport.tsx"

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
  const page = usePage()
  const tour = useTour(page === "create")
  const mode = useStudio((state) => state.mode)
  const [mark, setMark] = useState<string | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)
  const [homeSlot, setHomeSlot] = useState<HTMLDivElement | null>(null)
  const [createSlot, setCreateSlot] = useState<HTMLDivElement | null>(null)
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
  const stage = showLayers ? "results" : turn?.status === "review" || turn?.status === "ready" ? "review" : "talk"
  const summary = briefLine(turn?.brief)

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
    go("/create")
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

  const hot = status === "working"

  const composerSlot = page === "home" ? homeSlot : createSlot
  const composer = (
    <Composer started={started} onBegin={() => setTalking(true)} onBubble={addBubble} onExchange={addExchange} />
  )

  return (
    <div className="studio-root">
      <div className="grain" aria-hidden="true" />
      <PagePane active={page === "home"} scroll>
        <Home composerHost={setHomeSlot} />
      </PagePane>
      <PagePane active={page !== "home"}>
      <div className="studio-shell">
        <Sidebar
          page={page === "train" ? "train" : page === "analyse" ? "analyse" : "create"}
          onReplay={() => {
            if (page !== "create") go("/create")
            tour.replay()
          }}
        />
        <div className="studio-pages">
          <PagePane active={page === "train"} scroll>
            <main className="studio-main is-scroll">
              <TrainRoom />
            </main>
          </PagePane>
          {features.genre ? (
            <PagePane active={page === "genre"} scroll>
              <main className="studio-main is-scroll">
                <PageHeader eyebrow="Genres" title="Explore a style" subtitle="Read the references, then open Create with those traits." />
                <GenreRoom onUse={useGenre} />
              </main>
            </PagePane>
          ) : null}
          <PagePane active={page === "analyse"} scroll>
            <main className="studio-main is-scroll">
              <PageHeader eyebrow="Analyse" title="Hear what your track is doing" subtitle="Upload a track. The notes stay tied to what was measured." />
            </main>
          </PagePane>
          <PagePane active={page === "create"}>
            <main className={`studio-main ${stage === "review" ? "is-scroll" : ""}`}>
              <div className="studio-frame is-focus" hidden={stage !== "talk"}>
                <Transport filled={filledDetails(turn?.brief)} briefOpen={briefOpen} onBrief={() => setBriefOpen((value) => !value)} />
                <div className="workspace">
                  <GoalCard idea={bubbles.find((bubble) => !bubble.prompt)?.text} />
                  <section className={`card directions-card ${hot ? "is-hot" : ""}`} aria-label="Directions">
                    <h2 className="section-title">Directions</h2>
                    <Thread bubbles={bubbles} onExchange={addExchange} showLayers={false} showDemo={demoQuery} />
                    <div className="studio-composer" ref={setCreateSlot} />
                  </section>
                </div>
              </div>
              <BriefDrawer open={briefOpen} mark={mark} hot={hot} onClose={() => setBriefOpen(false)} onMark={setMark} onDescribe={describe} />
              {stage === "review" ? (
                <div className="review-layout">
                  <PageHeader eyebrow="Review" title="Read the brief" subtitle="Locked facts stay as you said them. Prompts are ready to edit.">
                    <SessionStatus />
                  </PageHeader>
                  <p className="card brief-slim">{summary}</p>
                  <ReviewStage />
                  {turn ? <ReasoningCard mark={mark} onMark={setMark} onDescribe={describe} /> : null}
                </div>
              ) : null}
              {stage === "results" ? (
                <div className="results-stage">
                  <PageHeader eyebrow="Create" title="Alternatives" subtitle="Listen and compare, inspect the changes, then choose what to apply.">
                    <SessionStatus />
                  </PageHeader>
                  <section className={`card results-card p-5 ${hot ? "is-hot" : ""}`} aria-label="Results">
                    <Suspense fallback={<Skeleton className="h-14 w-full" />}>
                      <LayersView />
                    </Suspense>
                  </section>
                  <Suspense fallback={<p className="studio-player px-4 py-3 text-secondary">Opening the player.</p>}>
                    <PlayerBar onStartOver={startOver} />
                  </Suspense>
                </div>
              ) : null}
            </main>
          </PagePane>
        </div>
      </div>
      </PagePane>
      <Tour open={tour.open && page === "create"} onClose={tour.finish} />
      {composerSlot ? createPortal(composer, composerSlot) : null}
    </div>
  )
}

function filledDetails(brief: SongBrief | null | undefined): number {
  if (!brief) return 0
  return Object.values(brief.slots).filter((slot) => slot?.value?.trim()).length
}

function briefLine(brief: SongBrief | null | undefined) {
  const parts = [brief?.slots.mood?.value, brief?.slots.world?.value, brief?.slots.energy?.value].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : "Details appear here as we talk."
}
