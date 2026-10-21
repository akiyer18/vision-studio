import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Suspense, lazy, useCallback, useRef, useState } from "react"

import { ApiError } from "../../api/client.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { inputBridge } from "../../input/bridge.ts"
import type { ReadingPatch } from "../../input/bridge.ts"
import type { RecentMessage } from "../../recentIdeas.ts"
import { renderCurrent } from "../../studio/renderSession.ts"
import { useStudio } from "../../state/studio.ts"
import type { AnswerAction } from "../../types/answer_action.ts"
import type { SlotName } from "../../types/slot_name.ts"
import { Button } from "../Button.tsx"
import { DemoMenu } from "../DemoMenu.tsx"
import { QuestionMessage } from "./QuestionMessage.tsx"

const LayersView = lazy(() => import("../layers/stage.tsx").then((module) => ({ default: module.LayersView })))

export type Bubble = RecentMessage

type Props = {
  started: boolean
  bubbles: Bubble[]
  onExchange: (question: string, answer: string) => void
  showLayers: boolean
  showDemo: boolean
}

export function Thread({ started, bubbles, onExchange, showLayers, showDemo }: Props) {
  const question = useStudio((state) => (state.turn?.status === "question" ? (state.turn.question ?? null) : null))
  const turnStatus = useStudio((state) => state.turn?.status ?? null)
  const summary = useStudio((state) => (state.turn?.status === "ready" ? state.turn.summary : undefined))
  const prompts = useStudio((state) => (state.turn?.status === "ready" ? state.turn.prompts : undefined))
  const status = useStudio((state) => state.status)
  const reading = useStudio((state) => state.reading)
  const reduce = useReducedMotion()
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<{ action: AnswerAction; value?: string } | null>(null)
  const busy = useRef(false)
  const firstExchange = bubbles.findIndex((bubble) => bubble.prompt)
  const earlier = firstExchange === -1 ? bubbles : bubbles.slice(0, firstExchange)
  const later = firstExchange === -1 ? [] : bubbles.slice(firstExchange)

  const send = useCallback(
    async (action: AnswerAction, value?: string) => {
      if (busy.current) return
      const current = useStudio.getState().turn
      const slot: SlotName = current?.status === "question" && current.question ? current.question.slot : "mood"
      busy.current = true
      setLast({ action, value })
      setError(null)
      const asked = current?.status === "question" ? current.question?.text : ""
      try {
        await postTurn({
          answer: value ? { slot, action, value } : { slot, action },
        })
        if (asked) onExchange(asked, answerLabel(action, value))
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
        setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
      } finally {
        busy.current = false
      }
    },
    [onExchange],
  )

  return (
    <div className={`studio-thread ${started ? "px-0 py-4" : ""}`}>
      {showDemo ? <DemoMenu /> : null}
      <AnimatePresence>
        {started ? (
          <motion.div
            key="thread"
            className="canvas-column flex flex-col gap-4"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.28 }}
          >
            <h1 className="sr-only">Your song</h1>
            {earlier.map((bubble) => (
              <Line key={bubble.id} bubble={bubble} reduce={reduce === true} />
            ))}
            {reading ? <ReadingMessage /> : null}
            {later.map((bubble) => (
              <Line key={bubble.id} bubble={bubble} reduce={reduce === true} />
            ))}
            {question ? (
              <QuestionMessage question={question} onAnswer={(action, value) => void send(action, value)} />
            ) : turnStatus === "question" ? (
              <div className="rounded-2xl border border-white/10 px-4 py-3">
                <p>Nothing to ask.</p>
                <p className="mt-1 text-secondary">Skip all and build from what is already known.</p>
                <Button tone="ghost" className="mt-3" onClick={() => void send("skip_all")}>
                  Skip all and build
                </Button>
              </div>
            ) : null}
            {(prompts?.length ?? 0) > 0 ? (
              <article className="max-w-xl rounded-2xl border border-white/10 px-4 py-3">
                <p className="text-ink">{summary || "Ready to build."}</p>
                <Button className="mt-3" disabled={status === "working"} onClick={() => void renderCurrent()}>
                  Build
                </Button>
              </article>
            ) : null}
            {error && last ? (
              <div role="alert" className="text-danger">
                <p>{error}</p>
                <Button tone="secondary" className="mt-2" onClick={() => void send(last.action, last.value)}>
                  Try again
                </Button>
              </div>
            ) : null}
            {showLayers ? (
              <Suspense fallback={<p className="text-secondary">Opening the takes.</p>}>
                <LayersView />
              </Suspense>
            ) : null}
          </motion.div>
        ) : (
          <motion.div
            key="home"
            className="canvas-column text-center"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: reduce ? 0 : 0.28 }}
          >
            <h1 className="greeting" data-tour="welcome">
              What are you feeling today?
            </h1>
            <p className="mt-4 text-secondary">Turn it into layers you can edit.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function answerLabel(action: AnswerAction, value?: string): string {
  if (action === "you_decide") return "You decide"
  if (action === "skip") return "Skip this"
  if (action === "skip_all") return "Skip all and build"
  return value?.trim() || "Answered"
}

function Line({ bubble, reduce }: { bubble: Bubble; reduce: boolean }) {
  if (bubble.prompt) {
    return (
      <p className="max-w-xl text-sm">
        <span className="text-secondary">{bubble.prompt}</span> <span className="text-ink">{bubble.text}</span>
      </p>
    )
  }
  if (bubble.role === "agent") {
    return <p className="max-w-xl rounded-2xl border border-white/10 px-4 py-3 text-ink">{bubble.text}</p>
  }
  return (
    <motion.p
      className="ml-auto max-w-md rounded-2xl bg-white/8 px-4 py-3 text-ink"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.22 }}
    >
      {bubble.text}
    </motion.p>
  )
}

function ReadingMessage() {
  const reading = useStudio((state) => state.reading)
  if (!reading) return null
  return (
    <article className="max-w-xl rounded-2xl border border-white/10 px-4 py-3">
      <p className="text-ink">{reading.text}</p>
      {reading.unsure ? (
        <div className="mt-3 flex flex-col gap-3">
          {reading.fixing ? (
            <div className="flex flex-col gap-2">
              <label className="text-sm text-muted" htmlFor="fix-key">
                Key
              </label>
              <input
                id="fix-key"
                value={reading.key}
                onChange={(event) => revise({ key: event.target.value })}
                className="mono rounded-xl border border-white/15 bg-transparent px-3 py-2 text-ink outline-none"
              />
              <label className="text-sm text-muted" htmlFor="fix-tempo">
                Tempo
              </label>
              <input
                id="fix-tempo"
                inputMode="decimal"
                value={reading.tempo}
                onChange={(event) => revise({ tempo: event.target.value })}
                className="mono rounded-xl border border-white/15 bg-transparent px-3 py-2 text-ink outline-none"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                void inputBridge().confirm()
              }}
            >
              {reading.confirmLabel}
            </Button>
            {reading.fixing ? null : (
              <Button tone="secondary" onClick={() => revise({ fixing: true })}>
                Fix the key or tempo
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </article>
  )
}

function revise(patch: ReadingPatch) {
  try {
    inputBridge().revise(patch)
  } catch {
    return
  }
}
