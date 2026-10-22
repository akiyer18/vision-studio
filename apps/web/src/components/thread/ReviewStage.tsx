import { useState } from "react"
import { Lock, X } from "lucide-react"

import { ApiError } from "../../api/client.ts"
import { SLOT_LABEL, SLOT_ORDER } from "../../brief/slots.ts"
import { inFlight } from "../../conversation/flight.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { features } from "../../features.ts"
import { LANES } from "../../studio/lanes.ts"
import { layerTitle } from "../../studio/output.ts"
import { renderCurrent } from "../../studio/renderSession.ts"
import { useStudio } from "../../state/studio.ts"
import type { OutputChoice } from "../../types/output_choice.ts"
import type { SlotName } from "../../types/slot_name.ts"
import type { SlotValue } from "../../types/slot_value.ts"
import { Button } from "../Button.tsx"

const LOCKED: SlotName[] = ["tempo", "key", "progression", "structure", "palette", "sound", "meter"]

export function ReviewStage() {
  const brief = useStudio((state) => state.turn?.brief)
  const summary = useStudio((state) => (state.turn?.status === "ready" ? state.turn.summary : undefined))
  const prompts = useStudio((state) => (state.turn?.status === "ready" ? state.turn.prompts : undefined)) ?? []
  const edits = useStudio((state) => state.promptEdits)
  const editPrompt = useStudio((state) => state.editPrompt)
  const working = useStudio((state) => state.status === "working")
  const ready = prompts.length > 0
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<"write" | "back" | "deeper" | "build" | null>(null)
  if (!brief) return null

  const concept =
    summary ||
    [brief.slots.mood?.value, brief.slots.world?.value, brief.audio_intent].filter(Boolean).join(" · ") ||
    "The brief is ready to read."
  const layers = layerNames(brief.output, prompts.map((item) => item.layer))

  async function save(slot: SlotName, value: string) {
    if (inFlight() || useStudio.getState().status === "working") return
    const next = value.trim()
    if (!next || brief?.slots[slot]?.value === next) return
    useStudio.getState().queueOverride(slot, next)
    setError(null)
    try {
      await postTurn({ review: true })
    } catch (err) {
      fail(err)
    }
  }

  async function saveNoise(value: string) {
    const noise = Number(value)
    if (!Number.isFinite(noise)) return
    setError(null)
    try {
      await postTurn({ noise })
    } catch (err) {
      fail(err)
    }
  }

  async function act(flag: "write_prompts" | "back_to_questions" | "deeper") {
    if (inFlight() || useStudio.getState().status === "working") return
    setLast(flag === "write_prompts" ? "write" : flag === "deeper" ? "deeper" : "back")
    setError(null)
    try {
      await postTurn(flag === "deeper" ? { deepen: true } : { [flag]: true })
    } catch (err) {
      fail(err)
    }
  }

  async function build() {
    setLast("build")
    setError(null)
    try {
      await renderCurrent()
    } catch (err) {
      fail(err)
    }
  }

  function fail(err: unknown) {
    const message = err instanceof ApiError ? err.message : "That did not go through. Try again."
    setError(message.trim().length < 160 ? message : "That did not go through. Try again.")
  }

  function retry() {
    if (last === "write") void act("write_prompts")
    else if (last === "back") void act("back_to_questions")
    else if (last === "deeper") void act("deeper")
    else if (last === "build") void build()
  }

  return (
    <section className="review-stage" aria-label="Review">
      <div className="review-body">
        <header className="flex flex-col gap-2">
          <h2 className="section-title">Concept</h2>
          <p className="text-ink">{concept}</p>
          {brief.arc ? (
            <p className="text-secondary">
              {brief.arc.label}. {brief.arc.start} to {brief.arc.end}.
              {brief.arc.description ? ` ${brief.arc.description}` : ""}
            </p>
          ) : null}
        </header>
        <div className="flex flex-wrap gap-2" aria-label="Facts">
          {SLOT_ORDER.map((name) => {
            const slot = brief.slots[name]
            if (!slot?.value) return null
            const locked = LOCKED.includes(name) && slot.source === "you"
            const mark = slot.source === "guessed" ? "default" : slot.source === "detected" ? "detected" : undefined
            return <FactChip key={name} name={name} slot={slot} locked={locked} mark={mark} onCommit={(value) => void save(name, value)} />
          })}
        </div>
        {brief.audio_intent ? (
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-secondary">
              Audio intent
              <input
                defaultValue={brief.audio_intent}
                disabled={working}
                onBlur={(event) => void save("intent", event.target.value)}
                className="field"
              />
            </label>
            <label className="flex flex-col gap-1 text-secondary">
              How different
              <input
                defaultValue={String(brief.noise ?? 0.5)}
                inputMode="decimal"
                disabled={working}
                onBlur={(event) => void saveNoise(event.target.value)}
                className="field"
              />
            </label>
          </div>
        ) : null}
        <div className="flex flex-col gap-4">
          {layers.map((layer) => {
            const prompt = prompts.find((item) => item.layer === layer)
            const edit = edits[layer]
            const text = edit?.prompt ?? prompt?.prompt ?? ""
            const negative = edit?.negative ?? prompt?.negative ?? ""
            const facets = (brief.facets ?? []).filter((facet) => facet.layer === layer || facet.layer === layer.replace(/_[ab]$/, "")).filter((facet) => !looksLikeExercise(facet.value))
            return (
              <article key={layer} className="card review-layer">
                <h3 className="section-title">{layerTitle(layer)}</h3>
                {facets.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {facets.map((facet) => (
                      <span key={facet.id} className="pill">
                        {facet.label}: {facet.value}
                      </span>
                    ))}
                  </div>
                ) : null}
                <label className="flex flex-col gap-2 text-secondary" htmlFor={`thread-${layer}-prompt`}>
                  Prompt
                  <textarea
                    id={`thread-${layer}-prompt`}
                    rows={4}
                    value={text}
                    disabled={!prompt || working}
                    placeholder={prompt ? undefined : "Write prompts to fill this."}
                    onChange={(event) => {
                      editPrompt(layer, "prompt", event.target.value)
                      grow(event.currentTarget)
                    }}
                    ref={(node) => {
                      if (node) grow(node)
                    }}
                    className="prompt-field"
                  />
                </label>
                <div className="flex flex-col gap-2">
                  <p className="text-secondary">Leave out</p>
                  <LeaveOut
                    layer={layer}
                    value={negative}
                    disabled={!prompt || working}
                    onChange={(next) => editPrompt(layer, "negative", next)}
                  />
                </div>
              </article>
            )
          })}
        </div>
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <p className="text-danger">{error}</p>
            <Button tone="secondary" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : null}
      </div>
      <footer className="review-footer">
        <Button tone="secondary" disabled={working} onClick={() => void act("back_to_questions")}>
          Back to conversation
        </Button>
        <Button tone="secondary" disabled={!ready || working} onClick={() => void act("deeper")}>
          Go deeper
        </Button>
        {ready ? (
          <Button id="render-build" disabled={working} onClick={() => void build()}>
            Build
          </Button>
        ) : (
          <Button disabled={working} onClick={() => void act("write_prompts")}>
            Write prompts
          </Button>
        )}
      </footer>
    </section>
  )
}

function LeaveOut({
  layer,
  value,
  disabled,
  onChange,
}: {
  layer: string
  value: string
  disabled: boolean
  onChange: (next: string) => void
}) {
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean)
  return (
    <div className="flex flex-wrap gap-2">
      {parts.length === 0 ? <p className="text-muted">Nothing to leave out.</p> : null}
      {parts.map((part) => (
        <button key={part} type="button" className="pill" disabled={disabled} onClick={() => onChange(parts.filter((item) => item !== part).join(", "))}>
          {part}
          <X aria-hidden="true" size={12} />
          <span className="sr-only">Remove {part}</span>
        </button>
      ))}
      <textarea id={`thread-${layer}-negative`} className="sr-only" readOnly value={value} aria-label="Leave out" />
    </div>
  )
}

function FactChip({
  name,
  slot,
  locked,
  mark,
  onCommit,
}: {
  name: SlotName
  slot: SlotValue
  locked: boolean
  mark?: string
  onCommit: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(slot.value)
  if (open) {
    return (
      <label className="fact-chip">
        <span className="sr-only">{SLOT_LABEL[name]}</span>
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setOpen(false)
            onCommit(draft)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
          }}
          className="field"
        />
      </label>
    )
  }
  return (
    <button
      type="button"
      className="fact-chip"
      onClick={() => {
        setDraft(slot.value)
        setOpen(true)
      }}
    >
      {locked ? <Lock aria-label="Locked" size={12} /> : null}
      <span>{SLOT_LABEL[name]}</span>
      <span className="text-ink">{slot.value}</span>
      {mark ? <span className={mark === "detected" ? "text-[var(--cyan)]" : "text-muted"}>{mark}</span> : null}
    </button>
  )
}

function looksLikeExercise(value: string): boolean {
  const text = value.trim().toLowerCase()
  return text.length >= 24 && (text.startsWith("create a ") || text.includes("recreate it in logic"))
}

function layerNames(output: OutputChoice[], prompted: string[]): string[] {
  if (prompted.length > 0) return prompted
  if (output.includes("all_layers") || output.length === 0) {
    const base = LANES.filter((lane) => lane !== "full_mix")
    return output.includes("full_mix") && features.fullMix ? [...base, "full_mix"] : [...base]
  }
  return output.filter((item) => item !== "all_layers")
}

function grow(node: HTMLTextAreaElement) {
  node.style.height = "auto"
  node.style.height = `${node.scrollHeight}px`
}
