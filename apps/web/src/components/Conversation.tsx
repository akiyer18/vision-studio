import { useCallback, useRef, useState } from "react"

import { ApiError } from "../api/client.ts"
import { postTurn } from "../conversation/postTurn.ts"
import { useStudio } from "../state/studio.ts"
import type { AnswerAction } from "../types/answer_action.ts"
import type { SlotName } from "../types/slot_name.ts"
import { Button } from "./Button.tsx"
import { QuestionCard } from "./QuestionCard.tsx"

export function Conversation() {
  const turn = useStudio((state) => state.turn)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const question = turn?.status === "question" ? (turn.question ?? null) : null
  const focusedLane = useStudio((state) => state.focusedLane)
  const sKey = focusedLane ? "S solos the focused lane" : "S skips this"

  const send = useCallback(async (action: AnswerAction, value?: string) => {
    if (busy.current) return
    const current = useStudio.getState().turn
    const slot: SlotName = current?.status === "question" && current.question ? current.question.slot : "mood"
    busy.current = true
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

  function generate() {
    if (useStudio.getState().turn?.status === "ready") {
      const studio = document.getElementById("prompt-studio")
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      studio?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" })
      studio?.focus()
      return
    }
    void send("skip_all")
  }

  return (
    <div className="flex flex-col gap-4">
      <h2>Conversation</h2>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <QuestionCard question={question} onAnswer={(action, value) => void send(action, value)} />
        </div>
        {question ? <p className="text-dust">{sKey}</p> : null}
      </div>
      {error ? (
        <p role="alert" className="text-fault">
          {error}
        </p>
      ) : null}
      <Button onClick={generate}>Generate</Button>
    </div>
  )
}
