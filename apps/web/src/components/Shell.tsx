import { BriefPanel } from "./BriefPanel.tsx"
import { Conversation } from "./Conversation.tsx"
import { GlassPanel } from "./GlassPanel.tsx"
import { InputPanel } from "./InputPanel.tsx"
import { PromptStudio } from "./PromptStudio.tsx"
import { ResultsPanel } from "./ResultsPanel.tsx"
import { SessionMark } from "./SessionMark.tsx"
import { useStudio } from "../state/studio.ts"

export function Shell() {
  const sessionId = useStudio((state) => state.sessionId)
  const status = useStudio((state) => state.status)

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 border-b border-walnut-line bg-studio-night/90 px-4 py-3 backdrop-blur-[24px]">
        <div className="flex items-start justify-between gap-3">
          <a
            href="/"
            className="font-serif text-2xl text-tape-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
          >
            Vision Studio
          </a>
          <div className="flex min-w-0 flex-col items-end gap-1">
            <SessionMark sessionId={sessionId} status={status} />
            <a
              href="/styleguide"
              className="text-sm text-dust underline-offset-4 hover:text-tape-cream hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
            >
              Styleguide
            </a>
          </div>
        </div>
      </header>
      <main className="grid flex-1 gap-4 p-4 desk:grid-cols-[22rem_minmax(0,1fr)_minmax(20rem,28rem)]">
        <GlassPanel className="min-w-0">
          <InputPanel />
        </GlassPanel>
        <GlassPanel className="min-w-0">
          <Conversation />
        </GlassPanel>
        <GlassPanel className="min-w-0">
          <PromptStudio />
        </GlassPanel>
        <ResultsPanel />
        <GlassPanel className="min-w-0 desk:col-span-3">
          <BriefPanel />
        </GlassPanel>
      </main>
    </div>
  )
}
