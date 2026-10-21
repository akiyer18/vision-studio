import { Lightbulb } from "lucide-react"

import { useStudio } from "../../state/studio.ts"
import { Button } from "../Button.tsx"

export function Insight() {
  const arc = useStudio((state) => state.turn?.brief.arc)
  const turnStatus = useStudio((state) => state.turn?.status)
  const hasQuestion = useStudio((state) => Boolean(state.turn?.question))
  const renders = useStudio((state) => state.renders.length)
  const arcLine = arc ? `Your idea has a clear arc from ${arc.start} to ${arc.end}, I will build it in two sections` : null

  let text = "Describe it, record it, or drop a file. I ask only what is missing."
  let label = "Describe it"
  let onClick = () => document.getElementById("idea")?.focus()

  if (renders > 0) {
    text = arcLine ?? "The takes are in. Listen, then pick the one that matches what you heard."
    label = "Open the takes"
    onClick = () => document.getElementById("results")?.scrollIntoView({ block: "start" })
  } else if (turnStatus === "ready") {
    text = arcLine ?? "The prompts are written from your answers."
    label = "Build the layers"
    onClick = () => document.querySelector<HTMLButtonElement>("[data-tour='build']")?.focus()
  } else if (turnStatus === "review") {
    text = arcLine ?? "The brief is ready to read."
    label = "Check the brief"
    onClick = () => document.querySelector<HTMLElement>("[data-tour='brief']")?.scrollIntoView({ block: "nearest" })
  } else if (hasQuestion) {
    text = arcLine ?? "I am asking only what is still missing."
    label = "Answer this"
    onClick = () => document.getElementById("question-answer")?.focus()
  } else if (arcLine) {
    text = arcLine
    label = "Check the brief"
    onClick = () => document.querySelector<HTMLElement>("[data-tour='brief']")?.scrollIntoView({ block: "nearest" })
  }

  return (
    <section className="card flex items-center gap-4 p-5" aria-label="Insight">
      <Lightbulb aria-hidden="true" size={18} color="#FF6A2B" />
      <p className="min-w-0 flex-1 text-ink">{text}</p>
      <Button tone="primary" onClick={onClick}>
        {label}
      </Button>
    </section>
  )
}
