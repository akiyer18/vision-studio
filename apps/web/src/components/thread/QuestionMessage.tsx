import { useEffect, useState } from "react"

import type { AnswerAction } from "../../types/answer_action.ts"
import type { Question } from "../../types/question.ts"
import { Chip } from "../Chip.tsx"

type Props = {
  question: Question
  reflection?: string
  draft?: string
  locked?: boolean
  onAnswer: (action: AnswerAction, value?: string) => void
}

export function QuestionMessage({ question, reflection, draft, locked = false, onAnswer }: Props) {
  const [draftText, setDraftText] = useState("")
  const [other, setOther] = useState(false)
  const [key, setKey] = useState(questionKey(question))
  const nextKey = questionKey(question)
  if (key !== nextKey) {
    setKey(nextKey)
    setDraftText("")
    setOther(false)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (locked) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof Node && document.getElementById("shortcut-help")?.contains(target)) return
      const typing = target instanceof HTMLElement && target.closest("input, textarea") !== null
      if (typing) return
      if (event.key === "S" && event.shiftKey) {
        event.preventDefault()
        onAnswer("skip_all")
        return
      }
      if (event.key === "s" || event.key === "S") {
        if (target instanceof Element && target.closest("[data-lane]")) return
        event.preventDefault()
        onAnswer("skip")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [locked, onAnswer])

  function submitText() {
    if (locked) return
    const value = draftText.trim()
    if (!value) return
    onAnswer("answer", value)
  }

  return (
    <article aria-live="polite">
      {reflection ? <p className="text-ink">{reflection}</p> : null}
      {draft ? <p className={`text-secondary ${reflection ? "mt-2" : ""}`}>{draft}</p> : null}
      <p className={`text-ink ${reflection || draft ? "mt-6" : ""}`}>{question.text}</p>
      {question.why ? <p className="mt-1 text-secondary">Why I am asking: {question.why}</p> : null}
      {question.options.length > 0 ? (
        <div className="option-grid mt-4">
          {question.options.map((option) => (
            <Chip key={option} disabled={locked} onClick={() => onAnswer("answer", option)}>
              {option}
            </Chip>
          ))}
          <Chip disabled={locked} aria-pressed={other} selected={other} onClick={() => setOther((value) => !value)}>
            Something else
          </Chip>
        </div>
      ) : null}
      {other || question.options.length === 0 ? (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault()
            submitText()
          }}
        >
          <label className="sr-only" htmlFor="question-answer">
            Your answer
          </label>
          <input
            id="question-answer"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            placeholder="Or write your own"
            disabled={locked}
            className="field w-full"
          />
        </form>
      ) : null}
      <div className="quiet-actions">
        <button type="button" disabled={locked} onClick={() => onAnswer("you_decide")}>
          You decide
        </button>
        <button type="button" disabled={locked} onClick={() => onAnswer("skip")}>
          Skip this
        </button>
        <button type="button" disabled={locked} onClick={() => onAnswer("skip_all")}>
          Skip all and build
        </button>
      </div>
    </article>
  )
}

function questionKey(question: Question): string {
  return `${question.slot}:${question.index}:${question.text}`
}
