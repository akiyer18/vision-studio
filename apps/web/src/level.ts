import { useSyncExternalStore } from "react"

export type Level = "beginner" | "intermediate" | "advanced"

const KEY = "vision-studio-level"
const listeners = new Set<() => void>()
let choosing = false

export const levelCopy: Record<Level, { title: string; copy: string }> = {
  beginner: { title: "Beginner", copy: "New to production or theory" },
  intermediate: { title: "Intermediate", copy: "You can make a loop, you want depth" },
  advanced: { title: "Advanced", copy: "You want complex grooves and harmony" },
}

function emit() {
  listeners.forEach((listener) => listener())
}

export function readLevel(): Level | null {
  const value = localStorage.getItem(KEY)
  if (value === "beginner" || value === "intermediate" || value === "advanced") return value
  return null
}

export function finishChoice(level: Level) {
  localStorage.setItem(KEY, level)
  choosing = false
  emit()
}

export function chooseLevel() {
  choosing = true
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLevel(): Level | null {
  return useSyncExternalStore(subscribe, readLevel, () => null)
}

export function useChoosing(): boolean {
  return useSyncExternalStore(subscribe, () => choosing, () => false)
}
