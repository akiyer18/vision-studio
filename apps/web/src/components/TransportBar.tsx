import { useRef, useState } from "react"

import { ApiError } from "../api/client.ts"
import { postTurn } from "../conversation/postTurn.ts"
import { useStudio } from "../state/studio.ts"
import type { OutputChoice } from "../types/output_choice.ts"
import { Button } from "./Button.tsx"
import { TransportMarks } from "./BriefPanel.tsx"
import { OutputPicker } from "./OutputPicker.tsx"
import { SessionMark } from "./SessionMark.tsx"
import { ShortcutHelp } from "./ShortcutHelp.tsx"

export function TransportBar({ mark, onBuild }: { mark: string | null; onBuild: () => void }) {
  const sessionId = useStudio((state) => state.sessionId)
  const status = useStudio((state) => state.status)
  const turn = useStudio((state) => state.turn)
  const failures = useStudio((state) => state.failures)
  const exportError = useStudio((state) => state.exportError)
  const busy = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const prompts = turn?.status === "ready" ? (turn.prompts ?? []) : []
  const canBuild = prompts.length > 0 && prompts.every((item) => item.prompt.trim().length > 0) && status !== "working"
  const failure = Object.values(failures)[0]?.message
  const detail = failure ?? exportError ?? error

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

  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-desk px-4 py-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2">
          <a href="/" className="text-lamp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp">
            Vision Studio
          </a>
          <SessionMark sessionId={sessionId} status={status} detail={detail} />
        </div>
        <OutputPicker value={turn?.brief.output ?? []} onChange={choose} />
        <TransportMarks mark={mark} />
        <Button disabled={!canBuild} onClick={onBuild}>
          Build
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-fault">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <ShortcutHelp />
        <a
          href="/styleguide"
          className="text-dust underline-offset-4 hover:text-lamp hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
        >
          Styleguide
        </a>
      </div>
    </header>
  )
}
