import { useEffect, useState } from "react"
import { Lightbulb } from "lucide-react"

import { traceSentence } from "../../studio/traceMark.ts"
import { useStudio } from "../../state/studio.ts"
import { Button } from "../Button.tsx"

const TIPS = [
  "Try: 94 BPM, four on the floor, industrial and punchy",
  "Try: a wide minor pad, slow and a little lonely",
  "Try: dusty drums, a short room, late at night",
]

export function Insight() {
  const arc = useStudio((state) => state.turn?.brief.arc)
  const turnStatus = useStudio((state) => state.turn?.status)
  const question = useStudio((state) => state.turn?.question)
  const summary = useStudio((state) => (state.turn?.status === "ready" ? state.turn.summary : undefined))
  const trace = useStudio((state) => state.turn?.trace)
  const renders = useStudio((state) => state.renders.length)
  const started = useStudio((state) => state.turn !== null)
  const [tip, setTip] = useState(0)

  useEffect(() => {
    if (started || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setInterval(() => setTip((value) => (value + 1) % TIPS.length), 6000)
    return () => window.clearInterval(timer)
  }, [started])

  if (!started) {
    return (
      <section className="card flex items-center gap-3 px-5 py-3" aria-label="Insight">
        <Lightbulb aria-hidden="true" size={16} color="#A78BFA" />
        <p className="min-w-0 flex-1 text-ink">{TIPS[tip]}</p>
      </section>
    )
  }

  const latest = trace?.length ? traceSentence(trace[trace.length - 1]) : undefined
  let text = latest || "I am asking only what is still missing."
  let label = "Answer this"
  let onClick = () => document.getElementById("question-answer")?.focus()

  if (renders > 0) {
    text = arc ? `Your idea has a clear arc from ${arc.start} to ${arc.end}, I will build it in two sections` : "The takes are in. Listen, then pick the one that matches what you heard."
    label = "Open the takes"
    onClick = () => document.getElementById("results")?.querySelector<HTMLButtonElement>("button")?.focus()
  } else if (turnStatus === "ready") {
    text = summary || (arc ? `Your idea has a clear arc from ${arc.start} to ${arc.end}, I will build it in two sections` : "The prompts are written from your answers.")
    label = "Build the layers"
    onClick = () => document.getElementById("render-build")?.focus()
  } else if (turnStatus === "review") {
    text = arc ? `Your idea has a clear arc from ${arc.start} to ${arc.end}, I will build it in two sections` : "The brief is ready to read."
    label = "Check the brief"
    onClick = () => document.querySelector("[data-tour='brief']")?.querySelector<HTMLElement>("button, input")?.focus()
  } else if (question?.why) {
    text = question.why
  }

  return (
    <section className="card flex items-center gap-3 px-5 py-3" aria-label="Insight">
      <Lightbulb aria-hidden="true" size={16} color="#A78BFA" />
      <p className="min-w-0 flex-1 text-ink">{text}</p>
      <Button tone="secondary" onClick={onClick}>
        {label}
      </Button>
    </section>
  )
}
