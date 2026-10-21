import { useEffect, useRef, useState } from "react"

import type { TraceStep } from "../types/trace_step.ts"

export function AgentTrace({ steps }: { steps: TraceStep[] }) {
  const [open, setOpen] = useState(true)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    bottom.current?.scrollIntoView({ block: "nearest" })
  }, [open, steps])

  return (
    <div className="rounded-panel border border-walnut-line">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-dust focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{open ? "Hide the trace" : "Show the trace"}</span>
      </button>
      {open ? (
        <div className="max-h-52 overflow-y-auto px-3 pb-3">
          {steps.length === 0 ? <p className="text-sm text-dust">Nothing has happened yet.</p> : null}
          {steps.map((step, index) => (
            <p key={`${step.step}-${index}`} className="font-mono text-sm leading-relaxed break-words text-signal-violet">
              {step.step}: {step.detail}
            </p>
          ))}
          <div ref={bottom} />
        </div>
      ) : null}
    </div>
  )
}
