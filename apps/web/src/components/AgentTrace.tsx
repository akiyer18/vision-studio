import { useEffect, useRef } from "react"

import type { TraceStep } from "../types/trace_step.ts"
import { LANES, lanePaint } from "../studio/lanes.ts"
import { traceTarget } from "../studio/traceMark.ts"

type Props = {
  steps: TraceStep[]
  open?: boolean
  onToggle?: () => void
  mark: string | null
  onMark: (id: string | null) => void
  pinned?: boolean
}

export function AgentTrace({ steps, open = false, onToggle, mark, onMark, pinned = false }: Props) {
  const bottom = useRef<HTMLDivElement>(null)
  const latest = steps.at(-1)
  const shown = pinned || open

  useEffect(() => {
    if (!shown) return
    bottom.current?.scrollIntoView({ block: "nearest" })
  }, [shown, steps])

  return (
    <div className={pinned ? "flex flex-col gap-2" : "border-t border-rule bg-desk"}>
      {pinned ? (
        <h2>Trace</h2>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-dust focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
          onClick={onToggle}
        >
          <span>{open ? "Hide the trace" : "Show the trace"}</span>
          {!open && latest ? (
            <span className="truncate text-lamp">
              {latest.step}: {latest.detail}
            </span>
          ) : null}
        </button>
      )}
      {shown ? (
        <div className="max-h-52 overflow-y-auto px-4 pb-3">
          {steps.length === 0 ? <p className="text-dust">Nothing has happened yet.</p> : null}
          {steps.map((step, index) => {
            const target = traceTarget(step)
            const lane = target !== null && (LANES as readonly string[]).includes(target) ? target : null
            const active = target !== null && target === mark
            return (
              <button
                key={`${step.step}-${index}`}
                type="button"
                className={`flex w-full items-start gap-2 py-1 text-left leading-relaxed break-words text-lamp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp ${active ? "outline outline-2 outline-offset-2 outline-lamp" : ""}`}
                onClick={() => onMark(active ? null : target)}
              >
                {lane ? (
                  <span className="mt-1 size-2 shrink-0" style={{ background: lanePaint(lane).fill }} aria-hidden />
                ) : (
                  <span className="mt-1 size-2 shrink-0" aria-hidden />
                )}
                <span>
                  {step.step}: {step.detail}
                </span>
              </button>
            )
          })}
          <div ref={bottom} />
        </div>
      ) : null}
    </div>
  )
}
