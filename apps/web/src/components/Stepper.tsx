import { FLOW, stepLine, type FlowStep } from "../flow.ts"

export function Stepper({ current }: { current: FlowStep }) {
  return (
    <nav aria-label="Steps" className="min-w-0 flex-1">
      <ol className="flex flex-wrap gap-x-6 gap-y-2">
        {FLOW.map((step) => {
          const active = step.id === current
          const line = stepLine(step.id)
          return (
            <li
              key={step.id}
              data-tour={step.id}
              aria-current={active ? "step" : undefined}
              className={active ? "text-lamp" : "text-dust"}
            >
              <p>
                <strong>{step.name}.</strong> {line}
              </p>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
