import { useState } from "react"

import { renderCurrent } from "../studio/renderSession.ts"
import { useStudio } from "../state/studio.ts"
import { AgentTrace } from "./AgentTrace.tsx"
import { Arrangement } from "./Arrangement.tsx"
import { Conversation } from "./Conversation.tsx"
import { DemoMenu } from "./DemoMenu.tsx"
import { InputPanel } from "./InputPanel.tsx"
import { TransportBar } from "./TransportBar.tsx"

const demo = new URLSearchParams(window.location.search).get("demo") === "1"

export function Shell() {
  const turn = useStudio((state) => state.turn)
  const questioning = turn?.status === "question"
  const [collapsed, setCollapsed] = useState(true)
  const [wasQuestion, setWasQuestion] = useState(false)
  const [mark, setMark] = useState<string | null>(null)
  if (questioning && !wasQuestion) {
    setWasQuestion(true)
    setCollapsed(false)
  } else if (!questioning && wasQuestion) {
    setWasQuestion(false)
  }
  const traceOpen = questioning || !collapsed

  function toggleTrace() {
    if (questioning) return
    setCollapsed((value) => !value)
  }

  function build() {
    const prompts = useStudio.getState().turn?.status === "ready" ? (useStudio.getState().turn?.prompts ?? []) : []
    if (prompts.length === 0) return
    setCollapsed(true)
    void renderCurrent()
  }

  return (
    <div className="flex min-h-svh flex-col">
      <TransportBar mark={mark} onBuild={build} />
      {demo ? <DemoMenu /> : null}
      <div className="grid flex-1 grid-cols-1 desk:grid-cols-[400px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-6 border-b border-rule p-4 desk:border-r desk:border-b-0">
          <InputPanel />
          <Conversation />
        </aside>
        <Arrangement mark={mark} />
      </div>
      <AgentTrace steps={turn?.trace ?? []} open={traceOpen} onToggle={toggleTrace} mark={mark} onMark={setMark} />
    </div>
  )
}
