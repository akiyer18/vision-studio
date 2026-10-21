import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Suspense, lazy, useCallback, useRef, useState } from "react"

import { ApiError } from "../../api/client.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { useStudio } from "../../state/studio.ts"
import type { AnswerAction } from "../../types/answer_action.ts"
import type { SlotName } from "../../types/slot_name.ts"
import { Button } from "../Button.tsx"
import { DemoMenu } from "../DemoMenu.tsx"
import { QuestionMessage } from "./QuestionMessage.tsx"

const LayersView = lazy(() => import("../layers/stage.tsx").then((module) => ({ default: module.LayersView })))

export type Bubble = { id: number; text: string }

type Props = {
  started: boolean
  bubbles: Bubble[]
  onBubble: (text: string) => void
  showLayers: boolean
  showDemo: boolean
}

export function Thread({ started, bubbles, onBubble, showLayers, showDemo }: Props) {
  const question = useStudio((state) => (state.turn?.status === "question" ? (state.turn.question ?? null) : null))
  const turnStatus = useStudio((state) => state.turn?.status ?? null)
  const reduce = useReducedMotion()
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<{ action: AnswerAction; value?: string } | null>(null)
  const busy = useRef(false)

  const send = useCallback(
    async (action: AnswerAction, value?: string) => {
      if (busy.current) return
      const current = useStudio.getState().turn
      const slot: SlotName = current?.status === "question" && current.question ? current.question.slot : "mood"
      busy.current = true
      setLast({ action, value })
      setError(null)
      if (action === "answer" && value) onBubble(value)
      try {
        await postTurn({
          answer: value ? { slot, action, value } : { slot, action },
        })
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
        setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
      } finally {
        busy.current = false
      }
    },
    [onBubble],
  )

  return (
    <div className="studio-thread px-4 py-6 md:px-8">
      {showDemo ? <DemoMenu /> : null}
      <AnimatePresence>
        {started ? (
          <motion.div
            key="thread"
            className="mx-auto flex w-full max-w-3xl flex-col gap-4"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.28 }}
          >
            <h1 className="sr-only">Your song</h1>
            {bubbles.map((bubble) => (
              <motion.p
                key={bubble.id}
                className="ml-auto max-w-md rounded-2xl bg-white/8 px-4 py-3 text-ink"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.22 }}
              >
                {bubble.text}
              </motion.p>
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
            className="flex h-full min-h-64 flex-col items-center justify-center px-4 text-center"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: reduce ? 0 : 0.28 }}
          >
            <h1 className="greeting" data-tour="welcome">
              What are you feeling today?
            </h1>
            <p className="mt-3 max-w-md text-secondary">Turn it into layers you can edit.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
