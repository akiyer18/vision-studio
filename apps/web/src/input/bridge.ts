export type ReadingPatch = { fixing?: boolean; key?: string; tempo?: string }

export type InputBridge = {
  apply: (text: string, file: File | null) => void
  submit: () => Promise<"sent" | "confirm" | "blocked">
  confirm: () => Promise<void>
  revise: (patch: ReadingPatch) => void
}

let current: InputBridge | null = null

export function registerInput(bridge: InputBridge | null) {
  current = bridge
}

export function inputBridge(): InputBridge {
  if (!current) throw new Error("The input panel is not ready.")
  return current
}
