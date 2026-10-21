import { GlassPanel } from "./GlassPanel.tsx"
import { InputPanel } from "./InputPanel.tsx"
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
      <main className="grid flex-1 gap-4 p-4 desk:grid-cols-[22rem_minmax(0,1fr)_20rem]">
        <GlassPanel className="min-w-0">
          <InputPanel />
        </GlassPanel>
        <GlassPanel className="min-w-0">
          <h2 className="font-serif text-xl">Conversation</h2>
          <p className="mt-2 text-sm text-dust">Questions land here, one at a time.</p>
        </GlassPanel>
        <div className="flex min-w-0 flex-col gap-4">
          <GlassPanel>
            <h2 className="font-serif text-xl">Brief</h2>
            <p className="mt-2 text-sm text-dust">The brief fills in as the song takes shape.</p>
          </GlassPanel>
          <GlassPanel>
            <h2 className="font-serif text-xl">Output</h2>
            <p className="mt-2 text-sm text-dust">Layers show up here after a render.</p>
          </GlassPanel>
        </div>
      </main>
    </div>
  )
}
