import { AlertTriangle, ChevronDown, Circle, MessageCircle, ScanSearch, Sparkles, WandSparkles } from "lucide-react"
import { motion, useReducedMotion } from "framer-motion"
import { useState } from "react"

import { LANES, lanePaint } from "../../studio/lanes.ts"
import { traceSentence, traceTarget } from "../../studio/traceMark.ts"
import { useStudio } from "../../state/studio.ts"
import type { TraceStep } from "../../types/trace_step.ts"

const ICONS = {
  ask: MessageCircle,
  detect: ScanSearch,
  extract: ScanSearch,
  fallback: AlertTriangle,
  polish: WandSparkles,
} as const

type Props = {
  mark: string | null
  onMark: (id: string | null) => void
  onDescribe: () => void
}

export function ReasoningCard({ mark, onMark, onDescribe }: Props) {
  const trace = useStudio((state) => state.turn?.trace)
  const steps = trace ?? []
  const [open, setOpen] = useState(true)
  const reduce = useReducedMotion()

  return (
    <motion.section
      className="glass panel-reasoning flex flex-col gap-3 p-4"
      aria-label="Agent reasoning"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.22 }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title">Agent reasoning</h2>
        <button type="button" className="inline-flex items-center gap-1 text-sm text-muted" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Show"}
          <ChevronDown size={14} aria-hidden className={open ? "rotate-180" : ""} />
        </button>
      </div>
      <div hidden={!open}>
        {steps.length === 0 ? (
          <div>
            <p className="text-secondary">Steps show up here as the idea is read.</p>
            <button type="button" className="mt-3 text-ink underline-offset-4 hover:underline" onClick={onDescribe}>
              Describe a feeling
            </button>
          </div>
        ) : (
          <ol className="flex max-h-52 flex-col gap-2 overflow-auto">
            {steps.map((step, index) => (
              <StepRow key={`${step.step}-${index}`} step={step} newest={index === steps.length - 1} mark={mark} onMark={onMark} reduce={reduce === true} />
            ))}
          </ol>
        )}
      </div>
    </motion.section>
  )
}

function StepRow({
  step,
  newest,
  mark,
  onMark,
  reduce,
}: {
  step: TraceStep
  newest: boolean
  mark: string | null
  onMark: (id: string | null) => void
  reduce: boolean
}) {
  const target = traceTarget(step)
  const lane = target !== null && (LANES as readonly string[]).includes(target) ? target : null
  const active = target !== null && target === mark
  return (
    <motion.li initial={reduce || !newest ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.22 }}>
      <button
        type="button"
        className={`flex w-full items-start gap-2 rounded-xl py-1 text-left text-sm text-ink ${active ? "outline outline-2 outline-offset-2 outline-accent" : ""}`}
        onClick={() => onMark(active ? null : target)}
      >
        {lane ? <Circle size={10} className="mt-1 shrink-0" style={{ color: lanePaint(lane).fill }} fill={lanePaint(lane).fill} aria-hidden /> : <StepIcon name={step.step} />}
        <span>
          {traceSentence(step)}
        </span>
      </button>
    </motion.li>
  )
}

function StepIcon({ name }: { name: string }) {
  const step = name.toLowerCase()
  const className = "mt-0.5 shrink-0 text-muted"
  if (step.includes("ask")) return <ICONS.ask size={14} className={className} aria-hidden />
  if (step.includes("detect")) return <ICONS.detect size={14} className={className} aria-hidden />
  if (step.includes("extract")) return <ICONS.extract size={14} className={className} aria-hidden />
  if (step.includes("fallback")) return <ICONS.fallback size={14} className={className} aria-hidden />
  if (step.includes("polish")) return <ICONS.polish size={14} className={className} aria-hidden />
  return <Sparkles size={14} className={className} aria-hidden />
}
