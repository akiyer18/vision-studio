import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { ApiError, sessionDebug } from "../../api/client.ts"
import { inFlight } from "../../conversation/flight.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { inputBridge } from "../../input/bridge.ts"
import type { ReadingPatch } from "../../input/bridge.ts"
import type { RecentMessage } from "../../recentIdeas.ts"
import { layerTitle } from "../../studio/output.ts"
import { traceSentence } from "../../studio/traceMark.ts"
import { useStudio } from "../../state/studio.ts"
import type { AnswerAction } from "../../types/answer_action.ts"
import type { SlotName } from "../../types/slot_name.ts"
import { Button } from "../Button.tsx"
import { DemoMenu } from "../DemoMenu.tsx"
import { QuestionMessage } from "./QuestionMessage.tsx"
import { ReviewCard } from "./ReviewCard.tsx"

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
  const intro = useStudio((state) => state.turn?.intro)
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

  return (
    <div className="studio-thread">
      {showDemo ? <DemoMenu /> : null}
      <h1 className="sr-only">Your song</h1>
      <div className="messages">
        {intro ? <Agent>{intro}</Agent> : null}
        {earlier.map((bubble) => (
          <Exchange key={bubble.id} bubble={bubble} />
        ))}
        {reading ? (
          <Agent>
            <ReadingMessage />
          </Agent>
        ) : null}
        {later.map((bubble) => (
          <Exchange key={bubble.id} bubble={bubble} />
        ))}
        {question ? (
          <Agent>
            <QuestionMessage question={question} locked={working} onAnswer={(action, value) => void send(action, value)} />
          </Agent>
        ) : null}
        {!question && turnStatus === "question" ? (
          <Agent>
            <p>Nothing to ask.</p>
            <p className="mt-1 text-secondary">Skip all and build from what is already known.</p>
            <Button tone="ghost" className="mt-2" disabled={working} onClick={() => void send("skip_all")}>
              Skip all and build
            </Button>
          </Agent>
        ) : null}
        {working ? (
          <Agent>
            <Thinking latest={trace?.length ? traceSentence(trace[trace.length - 1]) : "Thinking"} />
          </Agent>
        ) : null}
        {turnStatus === "review" ? (
          <Agent>
            <ReviewCard />
          </Agent>
        ) : null}
        {(prompts?.length ?? 0) > 0 ? (
          <Agent>
            <p className="text-ink">{summary || "Ready to build."}</p>
            <p className="mt-1 text-secondary">built from your answers</p>
            <PromptCards />
            <Button tone="secondary" className="mt-2" disabled={working} onClick={() => void goDeeper()}>
              Go deeper
            </Button>
          </Agent>
        ) : null}
        {error ? (
          <Agent>
            <p className="text-danger" role="alert">
              {error}
            </p>
            {last ? (
              <Button tone="secondary" className="mt-2" onClick={() => void send(last.action, last.value)}>
                Try again
              </Button>
            ) : null}
          </Agent>
        ) : null}
      </div>
      {showLayers ? (
        <Suspense fallback={<p className="text-secondary">Opening the takes.</p>}>
          <LayersView />
        </Suspense>
      ) : null}
      <DebugPanel />
    </div>
  )
}

function Agent({ children }: { children: ReactNode }) {
  return (
    <div className="bubble-row">
      <span className="vs-mark" aria-hidden="true">
        VS
      </span>
      <div className="bubble">{children}</div>
    </div>
  )
}

function User({ children }: { children: ReactNode }) {
  return (
    <div className="bubble-row is-user">
      <div className="bubble">{children}</div>
    </div>
  )
}

function Exchange({ bubble }: { bubble: Bubble }) {
  if (!bubble.prompt) return <User>{bubble.text}</User>
  return (
    <>
      <Agent>{bubble.prompt}</Agent>
      <User>{bubble.text}</User>
    </>
  )
}

function PromptCards() {
  const prompts = useStudio((state) => (state.turn?.status === "ready" ? state.turn.prompts : undefined)) ?? []
  const edits = useStudio((state) => state.promptEdits)
  const editPrompt = useStudio((state) => state.editPrompt)
  return (
    <div className="mt-3 flex flex-col gap-3">
      {prompts.map((item) => {
        const edit = edits[item.layer]
        return (
          <div key={item.layer} className="flex flex-col gap-1">
            <label className="text-secondary" htmlFor={`thread-${item.layer}-prompt`}>
              {layerTitle(item.layer)}
            </label>
            <textarea
              id={`thread-${item.layer}-prompt`}
              rows={3}
              value={edit?.prompt ?? item.prompt}
              onChange={(event) => editPrompt(item.layer, "prompt", event.target.value)}
              className="rounded-[6px] border border-[var(--line)] bg-raised px-2 py-1 text-ink outline-none"
            />
            <label className="text-secondary" htmlFor={`thread-${item.layer}-negative`}>
              Leave out
            </label>
            <textarea
              id={`thread-${item.layer}-negative`}
              rows={2}
              value={edit?.negative ?? item.negative}
              onChange={(event) => editPrompt(item.layer, "negative", event.target.value)}
              className="rounded-[6px] border border-[var(--line)] bg-raised px-2 py-1 text-ink outline-none"
            />
          </div>
        )
      })}
    </div>
  )
}

function DebugPanel() {
  const sessionId = useStudio((state) => state.sessionId)
  const turnStatus = useStudio((state) => state.turn?.status ?? "")
  const renders = useStudio((state) => state.renders.length)
  const enabled = new URLSearchParams(window.location.search).get("debug") === "1"
  const [body, setBody] = useState<string>("")
  useEffect(() => {
    if (!enabled) return
    let stop = false
    sessionDebug(sessionId)
      .then((payload) => {
        if (!stop) setBody(JSON.stringify(payload, null, 2))
      })
      .catch(() => {
        if (!stop) setBody("")
      })
    return () => {
      stop = true
    }
  }, [enabled, sessionId, turnStatus, renders])
  if (!enabled) return null
  return (
    <pre className="mono mt-3 overflow-auto text-[13px] text-secondary" aria-label="Renderer debug">
      {body}
    </pre>
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
