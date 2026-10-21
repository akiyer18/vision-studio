import { motion, useReducedMotion } from "framer-motion"
import { useEffect, useState } from "react"

import type { AnswerAction } from "../../types/answer_action.ts"
import type { Question } from "../../types/question.ts"
import { Button } from "../Button.tsx"
import { Chip } from "../Chip.tsx"

type Props = {
  question: Question
  locked?: boolean
  onAnswer: (action: AnswerAction, value?: string) => void
}

export function QuestionMessage({ question, locked = false, onAnswer }: Props) {
  const [draft, setDraft] = useState("")
  const [key, setKey] = useState(questionKey(question))
  const reduce = useReducedMotion()
  const nextKey = questionKey(question)
  if (key !== nextKey) {
    setKey(nextKey)
    setDraft("")
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
    const value = draft.trim()
    if (!value) return
    onAnswer("answer", value)
  }

  return (
    <motion.article
      aria-live="polite"
      className="max-w-xl rounded-2xl border border-white/10 px-4 py-3"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.25 }}
    >
      <p className="inline-flex rounded-full border border-white/15 px-2 py-0.5 text-xs text-secondary">
        {question.index} of up to {question.max}
      </p>
      <p className="mt-3 text-ink">{question.text}</p>
      {question.options.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {question.options.map((option) => (
            <Chip key={option} selected={draft === option} disabled={locked} onClick={() => onAnswer("answer", option)}>
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
          placeholder="Or write your own"
          disabled={locked}
          className="w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-muted disabled:opacity-40"
        />
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button tone="ghost" disabled={locked} onClick={() => onAnswer("you_decide")}>
          You decide
        </Button>
        <Button tone="ghost" disabled={locked} onClick={() => onAnswer("skip")}>
          Skip this
        </Button>
        <Button tone="ghost" disabled={locked} onClick={() => onAnswer("skip_all")}>
          Skip all and build
        </Button>
      </div>
    </motion.article>
  )
}

function questionKey(question: Question): string {
  return `${question.slot}:${question.index}:${question.text}`
}
