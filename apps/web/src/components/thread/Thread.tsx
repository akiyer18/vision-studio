import { Suspense, lazy, useCallback, useRef, useState, type ReactNode } from "react"

import { ApiError } from "../../api/client.ts"
import { inFlight } from "../../conversation/flight.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { inputBridge } from "../../input/bridge.ts"
import type { ReadingPatch } from "../../input/bridge.ts"
import type { RecentMessage } from "../../recentIdeas.ts"
import { renderCurrent } from "../../studio/renderSession.ts"
import { traceSentence } from "../../studio/traceMark.ts"
import { useStudio } from "../../state/studio.ts"
import type { AnswerAction } from "../../types/answer_action.ts"
import type { SlotName } from "../../types/slot_name.ts"
import { Button } from "../Button.tsx"
import { DemoMenu } from "../DemoMenu.tsx"
import { QuestionMessage } from "./QuestionMessage.tsx"

const LayersView = lazy(() => import("../layers/stage.tsx").then((module) => ({ default: module.LayersView })))

export type Bubble = RecentMessage

type Props = {
  bubbles: Bubble[]
  onExchange: (question: string, answer: string) => void
  showLayers: boolean
  showDemo: boolean
}

export function Thread({ bubbles, onExchange, showLayers, showDemo }: Props) {
  const question = useStudio((state) => (state.turn?.status === "question" ? (state.turn.question ?? null) : null))
  const turnStatus = useStudio((state) => state.turn?.status ?? null)
  const summary = useStudio((state) => (state.turn?.status === "ready" ? state.turn.summary : undefined))
  const prompts = useStudio((state) => (state.turn?.status === "ready" ? state.turn.prompts : undefined))
  const status = useStudio((state) => state.status)
  const trace = useStudio((state) => state.turn?.trace)
  const reading = useStudio((state) => state.reading)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<{ action: AnswerAction; value?: string } | null>(null)
  const busy = useRef(false)
  const firstExchange = bubbles.findIndex((bubble) => bubble.prompt)
  const earlier = firstExchange === -1 ? bubbles : bubbles.slice(0, firstExchange)
  const later = firstExchange === -1 ? [] : bubbles.slice(firstExchange)

  const send = useCallback(
    async (action: AnswerAction, value?: string) => {
      if (busy.current || inFlight() || useStudio.getState().status === "working") return
      const current = useStudio.getState().turn
      const slot: SlotName = current?.status === "question" && current.question ? current.question.slot : "mood"
      busy.current = true
      setLast({ action, value })
      setError(null)
      const asked = current?.status === "question" ? current.question?.text : ""
      const facet = current?.status === "question" ? current.question?.facet : undefined
      try {
        const posted = await postTurn({
          answer: {
            slot,
            action,
            ...(value ? { value } : {}),
            ...(facet ? { facet } : {}),
          },
        })
        if (posted && asked) onExchange(asked, answerLabel(action, value))
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
        setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
      } finally {
        busy.current = false
      }
    },
    [onExchange],
  )

  const goDeeper = useCallback(async () => {
    if (busy.current || inFlight() || useStudio.getState().status === "working") return
    busy.current = true
    setError(null)
    try {
      await postTurn({ deepen: true })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
      setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
    } finally {
      busy.current = false
    }
  }, [])

  const working = status === "working"
  const steps: { key: string; current: boolean; node: ReactNode }[] = [
    ...earlier.map((bubble) => ({ key: String(bubble.id), current: false, node: <Line bubble={bubble} /> })),
    ...(reading ? [{ key: "reading", current: false, node: <ReadingMessage /> }] : []),
    ...later.map((bubble) => ({ key: String(bubble.id), current: false, node: <Line bubble={bubble} /> })),
  ]
  if (question) {
    steps.push({
      key: "question",
      current: !working,
      node: <QuestionMessage question={question} locked={working} onAnswer={(action, value) => void send(action, value)} />,
    })
  } else if (turnStatus === "question") {
    steps.push({
      key: "empty-question",
      current: !working,
      node: (
        <div>
          <p>Nothing to ask.</p>
          <p className="mt-1 text-secondary">Skip all and build from what is already known.</p>
          <Button tone="ghost" className="mt-2" disabled={working} onClick={() => void send("skip_all")}>
            Skip all and build
          </Button>
        </div>
      ),
    })
  }
  if (working) {
    steps.push({
      key: "thinking",
      current: true,
      node: <Thinking latest={trace?.length ? traceSentence(trace[trace.length - 1]) : "Thinking"} />,
    })
  }
  if ((prompts?.length ?? 0) > 0) {
    steps.push({
      key: "ready",
      current: false,
      node: (
        <div>
          <p className="text-ink">{summary || "Ready to build."}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button tone="secondary" disabled={working} onClick={() => void goDeeper()}>
              Go deeper
            </Button>
            <Button disabled={working} onClick={() => void renderCurrent()}>
              Build now
            </Button>
          </div>
        </div>
      ),
    })
  }

  return (
    <div className="studio-thread">
      {showDemo ? <DemoMenu /> : null}
      <h1 className="sr-only">Your song</h1>
      <ol className="session-steps">
        {steps.map((item, index) => (
          <Step key={item.key} index={index + 1} current={item.current}>
            {item.node}
          </Step>
        ))}
        {error ? (
          <li className="step" role="alert">
            <p className="text-danger">{error}</p>
            {last ? (
              <Button tone="secondary" className="mt-2" onClick={() => void send(last.action, last.value)}>
                Try again
              </Button>
            ) : null}
          </li>
        ) : null}
        {showLayers ? (
          <li className="step">
            <Suspense fallback={<p className="text-secondary">Opening the takes.</p>}>
              <LayersView />
            </Suspense>
          </li>
        ) : null}
      </ol>
    </div>
  )
}

function Step({ index, current = false, children }: { index: number; current?: boolean; children: ReactNode }) {
  return (
    <li className={`step ${current ? "is-current" : ""}`}>
      <span className="step-index">{String(index).padStart(2, "0")}</span>
      {children}
    </li>
  )
}

function Thinking({ latest }: { latest: string }) {
  return (
    <div className="flex items-center gap-2 text-secondary" role="status">
      <span className="led" aria-hidden="true" />
      <p className="mono text-[13px]">{latest}</p>
    </div>
  )
}

function answerLabel(action: AnswerAction, value?: string): string {
  if (action === "you_decide") return "You decide"
  if (action === "skip") return "Skip this"
  if (action === "skip_all") return "Skip all and build"
  return value?.trim() || "Answered"
}

function Line({ bubble }: { bubble: Bubble }) {
  if (bubble.prompt) {
    return (
      <div>
        <p className="text-secondary">{bubble.prompt}</p>
        <p className="answer-pad">{bubble.text}</p>
      </div>
    )
  }
  return <p className="text-ink">{bubble.text}</p>
}

function ReadingMessage() {
  const reading = useStudio((state) => state.reading)
  if (!reading) return null
  return (
    <article>
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
                className="mono w-full rounded-[6px] border border-[var(--line)] bg-raised px-2 py-1 text-[15px] text-ink outline-none"
              />
              <label className="text-sm text-muted" htmlFor="fix-tempo">
                Tempo
              </label>
              <input
                id="fix-tempo"
                inputMode="decimal"
                value={reading.tempo}
                onChange={(event) => revise({ tempo: event.target.value })}
                className="mono w-full rounded-[6px] border border-[var(--line)] bg-raised px-2 py-1 text-[15px] text-ink outline-none"
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
