import { useRef, useState } from "react"

import { ApiError } from "../../api/client.ts"
import { features } from "../../features.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { LANE_PAINT } from "../../studio/lanes.ts"
import { OUTPUTS, layerTitle } from "../../studio/output.ts"
import { renderCurrent } from "../../studio/renderSession.ts"
import { polishNote } from "../../studio/traceMark.ts"
import { useStudio } from "../../state/studio.ts"
import type { OutputChoice } from "../../types/output_choice.ts"
import { Button } from "../Button.tsx"

const chipHue: Partial<Record<OutputChoice, string>> = {
  drums: LANE_PAINT.drums.fill,
  chords: LANE_PAINT.chords.fill,
  bass: LANE_PAINT.bass.fill,
  melody: LANE_PAINT.melody.fill,
  texture: LANE_PAINT.texture.fill,
}

export function LayersCard() {
  const mode = useStudio((state) => state.mode)
  const prompts = useStudio((state) => (state.turn?.status === "ready" ? state.turn.prompts : undefined))
  const output = useStudio((state) => state.turn?.brief.output)
  const edits = useStudio((state) => state.promptEdits)
  const trace = useStudio((state) => state.turn?.trace)
  const status = useStudio((state) => state.status)
  const failures = useStudio((state) => state.failures)
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
  const canBuild = cards.length > 0 && status !== "working" && !problem

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

  const options = OUTPUTS.filter((option) => features.fullMix || option.choice !== "full_mix")
  const rows = [options.slice(0, 4), options.slice(4)]

  return (
    <section className="glass panel-layers flex flex-col gap-4 px-2 py-4" aria-label="Layers">
      <h2 className="section-title">Layers</h2>
      {mode === "one_sound" ? (
        <p className="text-sm text-secondary">One sound, three variations.</p>
      ) : (
      <div className="flex flex-col gap-2" role="group" aria-label="Output">
        {rows.map((row) => (
          <div key={row[0]?.choice ?? "rest"} className="flex flex-nowrap gap-2">
            {row.map((option) => (
              <LayerChip
                key={option.choice}
                label={option.choice === "all_layers" ? "All layers" : option.label}
                hue={chipHue[option.choice]}
                selected={option.choice === shown}
                onClick={() => choose(option.choice)}
              />
            ))}
          </div>
        ))}
      </div>
      )}
      {cards.length > 0 ? (
        <details className="text-sm text-secondary">
          <summary className="cursor-pointer text-ink">Edit the prompts</summary>
          <div className="mt-3 flex flex-col gap-3">
            {cards.map((item) => {
              const edit = edits[item.layer]
              const prompt = edit?.prompt ?? item.prompt
              const negative = edit?.negative ?? item.negative
              const note = polishNote(trace ?? [], item.layer)
              const edited = prompt !== item.prompt || negative !== item.negative
              return (
                <div key={item.layer} className="flex flex-col gap-1">
                  <label className="text-muted" htmlFor={`${item.layer}-prompt`}>
                    {layerTitle(item.layer)}
                  </label>
                  <textarea
                    id={`${item.layer}-prompt`}
                    rows={3}
                    value={prompt}
                    onChange={(event) => editPrompt(item.layer, "prompt", event.target.value)}
                    className="rounded-xl border border-white/15 bg-transparent px-3 py-2 text-ink outline-none"
                  />
                  <label className="text-muted" htmlFor={`${item.layer}-negative`}>
                    Leave out
                  </label>
                  <textarea
                    id={`${item.layer}-negative`}
                    rows={2}
                    value={negative}
                    onChange={(event) => editPrompt(item.layer, "negative", event.target.value)}
                    className="rounded-xl border border-white/15 bg-transparent px-3 py-2 text-ink outline-none"
                  />
                  {note ? <p>{note}</p> : null}
                  {edited ? (
                    <button type="button" className="self-start text-ink underline-offset-4 hover:underline" onClick={() => resetPrompt(item.layer)}>
                      Reset to original
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </details>
      ) : (
        <p className="text-sm text-secondary">{mode === "one_sound" ? "Build when the prompt is ready." : "Pick layers, then build."}</p>
      )}
      {problem ? (
        <div role="alert">
          <p className="text-danger">{problem}</p>
          <Button
            className="mt-3"
            onClick={() => {
              if (choice.current && error) choose(choice.current)
              else void build()
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <Button data-tour="build" className="w-full" disabled={!canBuild} title={cards.length === 0 ? "Send an idea first." : undefined} onClick={() => void build()}>
          Build
        </Button>
      )}
    </section>
  )
}

function LayerChip({
  label,
  hue,
  selected,
  onClick,
}: {
  label: string
  hue?: string
  selected: boolean
  onClick: () => void
}) {
  const ink = hue ?? "#8B6CFF"
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-full border px-2 text-[13px] leading-none whitespace-nowrap ${selected ? "text-ink" : "border-white/15 text-secondary"}`}
      style={selected ? { background: `${ink}33`, borderColor: `${ink}66` } : undefined}
    >
      {selected ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: ink }} /> : null}
      <span>{label}</span>
    </button>
  )
}
