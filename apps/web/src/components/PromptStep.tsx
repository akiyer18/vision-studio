import { useRef, useState } from "react"

import { ApiError } from "../api/client.ts"
import { postTurn } from "../conversation/postTurn.ts"
import { features } from "../features.ts"
import { renderCurrent } from "../studio/renderSession.ts"
import { barsFromStructure, bpmFromPrompt, clipLength } from "../studio/output.ts"
import { polishNote } from "../studio/traceMark.ts"
import { useStudio } from "../state/studio.ts"
import type { OutputChoice } from "../types/output_choice.ts"
import { Button } from "./Button.tsx"
import { OutputPicker } from "./OutputPicker.tsx"
import { PromptCard } from "./PromptCard.tsx"
import { EmptyState, StepError, StepFrame } from "./StepCopy.tsx"

export function PromptStep() {
  const prompts = useStudio((state) => (state.turn?.status === "ready" ? state.turn.prompts : undefined))
  const output = useStudio((state) => state.turn?.brief.output)
  const edits = useStudio((state) => state.promptEdits)
  const trace = useStudio((state) => state.turn?.trace)
  const status = useStudio((state) => state.status)
  const failures = useStudio((state) => state.failures)
  const turn = useStudio((state) => state.turn)
  const editPrompt = useStudio((state) => state.editPrompt)
  const resetPrompt = useStudio((state) => state.resetPrompt)
  const [error, setError] = useState<string | null>(null)
  const choice = useRef<OutputChoice | null>(null)
  const cards = prompts ?? []
  const stored = output ?? []
  const picked = stored.length === 1 ? stored[0] : "all_layers"
  const shown: OutputChoice = !features.fullMix && picked === "full_mix" ? "all_layers" : picked
  const failure = Object.values(failures)[0]?.message
  const buildFailed = status === "error" && cards.length > 0 && !error
  const problem = error ?? (buildFailed ? (failure ?? "The build did not finish.") : null)

  function choose(next: OutputChoice) {
    choice.current = next
    setError(null)
    void postTurn({ output: [next] }).catch((err: unknown) => {
      const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
      setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
    })
  }

  async function build() {
    if (cards.length === 0) return
    setError(null)
    await renderCurrent()
  }

  if (cards.length === 0) {
    return (
      <StepFrame title="Prompt">
        <EmptyState
          title="The prompts are not ready"
          reason="Skip all and build, and they will land here."
          action="Build"
          disabled
          onAction={() => undefined}
        />
      </StepFrame>
    )
  }

  return (
    <StepFrame title="Prompt">
      <OutputPicker value={[shown]} onChange={choose} />
      {theoryLine(turn) ? <p className="text-lamp">{theoryLine(turn)}</p> : null}
      <div className="flex flex-col gap-3">
        {cards.map((item) => {
          const edit = edits[item.layer]
          return (
            <PromptCard
              key={item.layer}
              original={item}
              prompt={edit?.prompt ?? item.prompt}
              negative={edit?.negative ?? item.negative}
              polish={polishNote(trace ?? [], item.layer)}
              onPrompt={(value) => editPrompt(item.layer, "prompt", value)}
              onNegative={(value) => editPrompt(item.layer, "negative", value)}
              onReset={() => resetPrompt(item.layer)}
            />
          )
        })}
      </div>
      {problem ? (
        <StepError
          message={problem}
          onRetry={() => {
            if (choice.current && error) choose(choice.current)
            else void build()
          }}
        />
      ) : (
        <Button onClick={() => void build()}>Build</Button>
      )}
    </StepFrame>
  )
}

function theoryLine(turn: ReturnType<typeof useStudio.getState>["turn"]): string {
  const progression = turn?.progression
  const key = turn?.brief.slots.key?.value
  const bars = barsFromStructure(turn?.brief.slots.structure?.value)
  const bpm = bpmFromPrompt(turn?.prompts?.[0]?.prompt ?? "")
  const parts = [progression?.roman.join(" "), progression?.chords.join(" "), key, bpm ? clipLength(bars, bpm) : null].filter(
    (part): part is string => Boolean(part),
  )
  return parts.join(" · ")
}
