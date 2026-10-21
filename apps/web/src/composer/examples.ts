import { transport } from "../playback/transport.ts"
import { go } from "../route.ts"
import { useStudio } from "../state/studio.ts"

export const EXAMPLES = [
  { label: "Rainy night drive", text: "a rainy night drive, missing someone" },
  { label: "Summer festival", text: "a summer festival" },
  { label: "Calm morning", text: "a calm morning" },
] as const

let quickFn: ((text: string) => void) | null = null
let demoFn: (() => void) | null = null
let pendingDemo = false

export function registerQuick(fn: ((text: string) => void) | null) {
  quickFn = fn
}

export function registerDemo(fn: (() => void) | null) {
  demoFn = fn
}

export function runQuick(text: string) {
  quickFn?.(text)
}

export function runDemoExample() {
  demoFn?.()
}

export function runDemoFromHome() {
  pendingDemo = true
  transport.stop()
  useStudio.getState().resetSession()
  go("/create")
}

export function takePendingDemo() {
  const waiting = pendingDemo
  pendingDemo = false
  return waiting
}
