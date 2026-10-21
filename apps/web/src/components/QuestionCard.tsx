import { useEffect, useState } from "react"

import type { AnswerAction } from "../types/answer_action.ts"
import type { Question } from "../types/question.ts"
import { Button } from "./Button.tsx"
import { Chip } from "./Chip.tsx"

type Props = {
  question: Question | null
  onAnswer: (action: AnswerAction, value?: string) => void
}

function sameQuestion(left: Question | null, right: Question | null): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  return left.index === right.index && left.slot === right.slot && left.text === right.text
}

function prefersStill(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function QuestionCard({ question, onAnswer }: Props) {
  const [visible, setVisible] = useState<Question | null>(question)
  const [leaving, setLeaving] = useState(false)
  const [draft, setDraft] = useState("")
  const [draftKey, setDraftKey] = useState("")
  const key = visible ? `${visible.slot}:${visible.index}:${visible.text}` : ""
  if (draftKey !== key) {
    setDraftKey(key)
    setDraft("")
  }
  if (!leaving && !sameQuestion(question, visible)) {
    if (visible === null || prefersStill()) setVisible(question)
    else setLeaving(true)
  }

  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => {
      setVisible(question)
      setLeaving(false)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [leaving, question])

  useEffect(() => {
    if (!visible || leaving) return
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      const typing = target instanceof HTMLElement && target.closest("input, textarea") !== null
      if (typing) return
      if (event.key === "S" && event.shiftKey) {
        event.preventDefault()
        onAnswer("skip_all")
        return
      }
      if (event.key === "s" || event.key === "S") {
        event.preventDefault()
        onAnswer("skip")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [visible, leaving, onAnswer])

  if (!visible) return null

  function submitText() {
    const value = draft.trim()
    if (!value) return
    onAnswer("answer", value)
  }

  return (
    <article className={leaving ? "question-out" : "question-in"} aria-live="polite">
      <p className="text-sm text-dust">
        Question {visible.index} of up to {visible.max}
      </p>
      <p className="mt-2 text-lg text-signal-violet">{visible.text}</p>
      {visible.options.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {visible.options.map((option) => (
            <Chip key={option} selected={draft === option} onClick={() => onAnswer("answer", option)}>
              {option}
            </Chip>
          ))}
        </div>
      ) : null}
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
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full rounded-button border border-walnut-line bg-studio-night/40 px-3 py-2 text-sm text-tape-cream outline-none placeholder:text-dust focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
          placeholder="Or write your own"
        />
      </form>
      <p className="mt-2 text-xs text-dust">Enter sends. S skips. Shift S skips all.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button tone="secondary" onClick={() => onAnswer("you_decide")}>
          You decide
        </Button>
        <Button tone="ghost" onClick={() => onAnswer("skip")}>
          Skip this
        </Button>
        <Button tone="secondary" onClick={() => onAnswer("skip_all")}>
          Skip all and build
        </Button>
      </div>
    </article>
  )
}
