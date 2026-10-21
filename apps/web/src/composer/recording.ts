let recording = false
const listeners = new Set<() => void>()

export function setComposerRecording(value: boolean) {
  if (recording === value) return
  recording = value
  for (const listener of listeners) listener()
}

export function composerRecording(): boolean {
  return recording
}

export function subscribeRecording(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
