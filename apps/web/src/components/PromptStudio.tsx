import { useEffect, useRef, useState } from "react"

import { ApiError } from "../api/client.ts"
import { postTurn } from "../conversation/postTurn.ts"
import { barsFromStructure, bpmFromPrompt, clipLength } from "../studio/output.ts"
import { renderCurrent } from "../studio/renderSession.ts"
import { useStudio } from "../state/studio.ts"
import type { OutputChoice } from "../types/output_choice.ts"
import { Button } from "./Button.tsx"
import { OutputPicker } from "./OutputPicker.tsx"
import { PromptCard } from "./PromptCard.tsx"

export function PromptStudio() {
  const turn = useStudio((state) => state.turn)
  const edits = useStudio((state) => state.promptEdits)
  const editPrompt = useStudio((state) => state.editPrompt)
  const resetPrompt = useStudio((state) => state.resetPrompt)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef<typeof turn>(null)
  const busy = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const ready = turn?.status === "ready"
  const prompts = ready ? (turn.prompts ?? []) : []

  useEffect(() => {
    if (!ready || moved.current === turn) return
    moved.current = turn
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    heading.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" })
    heading.current?.focus()
  }, [ready, turn])

  function choose(choice: OutputChoice) {
    if (busy.current || Object.keys(useStudio.getState().runs).length > 0) return
    busy.current = true
    setError(null)
    void postTurn({ output: [choice] })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
        setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
      })
      .finally(() => {
        busy.current = false
      })
  }

  async function send() {
    if (prompts.length === 0) return
    setError(null)
    await renderCurrent()
  }

  return (
    <section className="flex flex-col gap-3">
      <h2
        id="prompt-studio"
        ref={heading}
        tabIndex={-1}
        className="font-serif text-xl outline-none focus:outline-2 focus:outline-offset-2 focus:outline-vu-amber"
      >
        Prompt studio
      </h2>
      {prompts.length === 0 ? (
        <p className="text-sm text-dust">Prompts land here when the brief is ready.</p>
      ) : (
        <>
          <OutputPicker value={turn?.brief.output ?? []} onChange={choose} />
          <p className="text-sm text-signal-violet">{theoryLine(turn)}</p>
          <div className="flex flex-col gap-3">
            {prompts.map((item) => {
              const edit = edits[item.layer]
              return (
                <PromptCard
                  key={item.layer}
                  original={item}
                  prompt={edit?.prompt ?? item.prompt}
                  negative={edit?.negative ?? item.negative}
                  onPrompt={(value) => editPrompt(item.layer, "prompt", value)}
                  onNegative={(value) => editPrompt(item.layer, "negative", value)}
                  onReset={() => resetPrompt(item.layer)}
                />
              )
            })}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-clip-red">
              {error}
            </p>
          ) : null}
          <Button className="w-full text-base" onClick={() => void send()}>
            Send to Stable Audio
          </Button>
        </>
      )}
    </section>
  )
}

function theoryLine(turn: NonNullable<ReturnType<typeof useStudio.getState>["turn"]> | null): string {
  const progression = turn?.progression
  const key = turn?.brief.slots.key?.value
  const bars = barsFromStructure(turn?.brief.slots.structure?.value)
  const bpm = bpmFromPrompt(turn?.prompts?.[0]?.prompt ?? "")
  const parts = [
    progression?.roman.join(" "),
    progression?.chords.join(" "),
    key,
    bpm ? clipLength(bars, bpm) : null,
  ].filter((part): part is string => Boolean(part))
  return parts.join(" · ")
}
