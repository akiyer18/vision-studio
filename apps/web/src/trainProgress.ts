import { useSyncExternalStore } from "react"

export type TrainRecord = {
  templateId: string
  category: "rhythm" | "harmony"
  level: string
  stars: number
  date: string
  next: string
}

const KEY = "vision-studio-train-progress"
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function readProgress(): TrainRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecord)
  } catch {
    return []
  }
}

export function recordCompletion(record: TrainRecord) {
  const rest = readProgress().filter((item) => item.templateId !== record.templateId)
  localStorage.setItem(KEY, JSON.stringify([record, ...rest]))
  emit()
}

let counts = { rhythm: 0, harmony: 0 }

export function progressCounts(): { rhythm: number; harmony: number } {
  const records = readProgress()
  const rhythm = records.filter((item) => item.category === "rhythm").length
  const harmony = records.filter((item) => item.category === "harmony").length
  if (counts.rhythm !== rhythm || counts.harmony !== harmony) counts = { rhythm, harmony }
  return counts
}

export function nextFocus(): string | null {
  return readProgress()[0]?.next ?? null
}

export function useTrainCounts() {
  return useSyncExternalStore(subscribe, progressCounts, progressCounts)
}

export function useTrainNext() {
  return useSyncExternalStore(subscribe, nextFocus, nextFocus)
}

function isRecord(value: unknown): value is TrainRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as TrainRecord
  return (
    typeof record.templateId === "string" &&
    (record.category === "rhythm" || record.category === "harmony") &&
    typeof record.level === "string" &&
    typeof record.stars === "number" &&
    typeof record.date === "string" &&
    typeof record.next === "string"
  )
}
