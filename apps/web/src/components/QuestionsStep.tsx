import { useCallback, useRef, useState } from "react"

import { ApiError } from "../api/client.ts"
import { postTurn } from "../conversation/postTurn.ts"
import { useStudio } from "../state/studio.ts"
import type { AnswerAction } from "../types/answer_action.ts"
import type { SlotName } from "../types/slot_name.ts"
import { AgentTrace } from "./AgentTrace.tsx"
import { BriefPanel } from "./BriefPanel.tsx"
import { QuestionCard } from "./QuestionCard.tsx"
import { EmptyState, StepError, StepFrame } from "./StepCopy.tsx"

export function QuestionsStep() {
  const question = useStudio((state) => (state.turn?.status === "question" ? (state.turn.question ?? null) : null))
  const trace = useStudio((state) => state.turn?.trace)
  const [error, setError] = useState<string | null>(null)
  const [mark, setMark] = useState<string | null>(null)
  const [last, setLast] = useState<{ action: AnswerAction; value?: string } | null>(null)
  const busy = useRef(false)

  const send = useCallback(async (action: AnswerAction, value?: string) => {
    if (busy.current) return
    const current = useStudio.getState().turn
    const slot: SlotName = current?.status === "question" && current.question ? current.question.slot : "mood"
    busy.current = true
    setLast({ action, value })
    setError(null)
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
  }, [])

  return (
    <StepFrame title="Questions">
      <div className="grid items-start gap-6 desk:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          {question ? (
            <>
              <QuestionCard question={question} onAnswer={(action, value) => void send(action, value)} />
              <p className="text-dust">S skips this</p>
            </>
          ) : (
            <EmptyState
              title="Nothing to ask"
              reason="Skip all and build from what is already known."
              action="Skip all and build"
              onAction={() => void send("skip_all")}
            />
          )}
          {error && last ? (
            <StepError message={error} tone="secondary" onRetry={() => void send(last.action, last.value)} />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <BriefPanel mark={mark} />
          <AgentTrace steps={trace ?? []} pinned mark={mark} onMark={setMark} />
        </div>
      </div>
    </StepFrame>
  )
}
