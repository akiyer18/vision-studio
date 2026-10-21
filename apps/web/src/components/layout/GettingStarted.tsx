import { Headphones, ListChecks, Sparkles } from "lucide-react"
import { motion, useReducedMotion } from "framer-motion"

const STEPS = [
  { icon: Sparkles, title: "Describe it", text: "Write a feeling, or bring a sound." },
  { icon: ListChecks, title: "Answer or skip", text: "A few questions, or skip them all." },
  { icon: Headphones, title: "Hear your layers", text: "Build, listen, and pick a take." },
] as const

export function GettingStarted() {
  const reduce = useReducedMotion()
  return (
    <motion.section
      className="glass panel-brief flex flex-col gap-2 p-4"
      aria-label="Getting started"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.22 }}
    >
      <h2 className="section-title">Getting started</h2>
      <ol className="flex flex-col gap-2">
        {STEPS.map((step) => (
          <Step key={step.title} icon={step.icon} title={step.title} text={step.text} />
        ))}
      </ol>
    </motion.section>
  )
}

function Step({ icon: Icon, title, text }: { icon: typeof Sparkles; title: string; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <Icon size={16} aria-hidden className="mt-1 shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="font-semibold leading-5">{title}</p>
        <p className="text-sm leading-5 text-secondary">{text}</p>
      </div>
    </li>
  )
}
