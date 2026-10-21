import { lazy, Suspense } from "react"

import { flowStep } from "../flow.ts"
import { useStudio } from "../state/studio.ts"
import { DemoMenu } from "./DemoMenu.tsx"
import { HelpMenu } from "./HelpMenu.tsx"
import { InputPanel } from "./InputPanel.tsx"
import { PromptStep } from "./PromptStep.tsx"
import { QuestionsStep } from "./QuestionsStep.tsx"
import { SessionMark } from "./SessionMark.tsx"
import { Stepper } from "./Stepper.tsx"
import { useTour } from "../tour.ts"
import { Tour } from "./Tour.tsx"

const SoundStep = lazy(() => import("./SoundStep.tsx").then((module) => ({ default: module.SoundStep })))
const ExportPanel = lazy(() => import("./ExportStep.tsx").then((module) => ({ default: module.ExportStep })))

const demoQuery = new URLSearchParams(window.location.search).get("demo") === "1"

export function Shell() {
  const step = useStudio(flowStep)
  const sessionId = useStudio((state) => state.sessionId)
  const status = useStudio((state) => state.status)
  const tour = useTour()

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-rule p-4">
        <Stepper current={step} />
        <div className="flex items-start gap-4">
          <SessionMark sessionId={sessionId} status={status} />
          <HelpMenu onReplay={tour.replay} />
        </div>
      </header>
      {demoQuery ? <DemoMenu /> : null}
      <main className="flex-1">
        <div hidden={step !== "idea"}>
          <InputPanel />
        </div>
        {step === "questions" ? <QuestionsStep /> : null}
        {step === "prompt" ? <PromptStep /> : null}
        {step === "sound" ? (
          <Suspense fallback={<p className="p-4 text-dust">Opening the takes.</p>}>
            <SoundStep />
          </Suspense>
        ) : null}
        {step === "export" ? (
          <Suspense fallback={<p className="p-4 text-dust">Opening export.</p>}>
            <ExportPanel />
          </Suspense>
        ) : null}
      </main>
      <Tour open={tour.open} onClose={tour.finish} />
    </div>
  )
}
