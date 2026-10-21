import { useRef, useState } from "react"

import { runScenario } from "../demo/runScenario.ts"
import { SCENARIOS } from "../demo/scenarios.ts"
import type { ScenarioId } from "../demo/scenarios.ts"
import { Button } from "./Button.tsx"

export function DemoMenu() {
  const [running, setRunning] = useState<ScenarioId | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const lock = useRef(false)

  async function run(id: ScenarioId) {
    if (lock.current) return
    lock.current = true
    const label = SCENARIOS.find((item) => item.id === id)?.label ?? "Scenario"
    setRunning(id)
    setNote(null)
    setProblem(null)
    try {
      await runScenario(id)
      setNote(`${label} is ready.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "The scenario did not finish."
      setProblem(message)
    } finally {
      lock.current = false
      setRunning(null)
    }
  }

  return (
    <div id="demo-menu" className="border-b border-walnut-line px-4 py-3">
      <p className="text-sm text-dust">Demo</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Demo scenarios">
        {SCENARIOS.map((item) => (
          <Button key={item.id} tone="secondary" aria-busy={running === item.id || undefined} onClick={() => void run(item.id)}>
            {item.label}
          </Button>
        ))}
      </div>
      <ul className="mt-3 flex max-w-3xl flex-col gap-1 text-sm text-dust">
        {SCENARIOS.map((item) => (
          <li key={item.id}>
            <span className="text-tape-cream">{item.label}.</span> {item.detail}
          </li>
        ))}
      </ul>
      {running ? (
        <p role="status" className="mt-2 text-sm text-signal-violet">
          Running {SCENARIOS.find((item) => item.id === running)?.label}.
        </p>
      ) : null}
      {note ? (
        <p role="status" className="mt-2 text-sm text-tape-cream">
          {note}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-2 text-sm text-clip-red">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
