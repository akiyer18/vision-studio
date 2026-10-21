import { useState } from "react"

import { LANES, lanePaint } from "../../studio/lanes.ts"
import { traceSentence, traceTarget } from "../../studio/traceMark.ts"
import { useStudio } from "../../state/studio.ts"
import type { TraceStep } from "../../types/trace_step.ts"

type Props = {
  mark: string | null
  onMark: (id: string | null) => void
  onDescribe: () => void
}

export function ReasoningCard({ mark, onMark, onDescribe }: Props) {
  const trace = useStudio((state) => state.turn?.trace)
  const steps = trace ?? []
  const [open, setOpen] = useState(true)

  return (
    <section className="card panel-reasoning flex flex-col gap-2 p-5" aria-label="Agent reasoning">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title">Trace</h2>
        <button type="button" className="text-[13px] text-secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <div hidden={!open}>
        {steps.length === 0 ? (
          <div>
            <p className="text-[13px] text-secondary">Steps show up here as the idea is read.</p>
            <button type="button" className="mt-2 text-[13px] text-ink underline-offset-4 hover:underline" onClick={onDescribe}>
              Describe a feeling
            </button>
          </div>
        ) : (
          <ol className="flex max-h-52 flex-col gap-1 overflow-auto">
            {steps.map((step, index) => (
              <StepRow key={`${step.step}-${index}`} step={step} mark={mark} onMark={onMark} />
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

function StepRow({ step, mark, onMark }: { step: TraceStep; mark: string | null; onMark: (id: string | null) => void }) {
  const target = traceTarget(step)
  const lane = target !== null && (LANES as readonly string[]).includes(target) ? target : null
  const active = target !== null && target === mark
  return (
    <li>
      <button
        type="button"
        className={`mono w-full border-l-2 py-1 pl-2 text-left text-[13px] text-ink ${active ? "is-marked" : ""}`}
        style={{ borderColor: lane ? lanePaint(lane).wave : "var(--line)" }}
        onClick={() => onMark(active ? null : target)}
      >
        {traceSentence(step)}
      </button>
    </li>
  )
}
