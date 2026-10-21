import type { LayerPrompt } from "./types/layer_prompt.ts"
import type { Question } from "./types/question.ts"
import type { SongBrief } from "./types/song_brief.ts"
import type { TraceStep } from "./types/trace_step.ts"

const KEY = "vision-studio-recent"
const LIMIT = 20

export type RecentMessage = { id: number; text: string; role?: "you" | "agent"; prompt?: string }

export type RecentRender = {
  layer: string
  variant: number
  path: string
  seconds: number
  bpm: number
}

export type RecentIdea = {
  id: string
  title: string
  date: string
  sessionId: string
  brief: SongBrief
  prompts: LayerPrompt[]
  layers: string[]
  renders: RecentRender[]
  thread: RecentMessage[]
  trace: TraceStep[]
  question?: Question
  status: "question" | "ready"
  mode?: "full" | "one_sound"
}

export type RecentDraft = {
  id: string
  sessionId: string
  idea: string
  audioOnly: boolean
  brief: SongBrief
  prompts: LayerPrompt[]
  layers: string[]
  renders: RecentRender[]
  thread: RecentMessage[]
  trace: TraceStep[]
  question?: Question
  status: "question" | "ready"
  mode?: "full" | "one_sound"
}

export type IdeaStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

let noted = { idea: "", audioOnly: false }

export function noteIdea(idea: string, audioOnly: boolean) {
  const text = idea.trim()
  noted = { idea: text, audioOnly: audioOnly || text.length === 0 }
}

export function currentIdea() {
  return noted
}

export function titleFor(idea: string, audioOnly: boolean): string {
  const text = idea.trim()
  if (audioOnly || text.length === 0) return "Audio idea"
  return text.slice(0, 40)
}

export function relativeDate(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const delta = Math.max(0, now - then)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return "Just now"
  if (delta < hour) return count(Math.floor(delta / minute), "minute")
  if (delta < day) return count(Math.floor(delta / hour), "hour")
  const days = Math.floor(delta / day)
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(iso))
}

export function missingLayers(renders: { layer: string; path: string }[], unavailable: ReadonlySet<string>): string[] {
  const layers: string[] = []
  for (const item of renders) {
    if (unavailable.has(item.path) && !layers.includes(item.layer)) layers.push(item.layer)
  }
  return layers
}

export function readRecentFrom(storage: IdeaStore): RecentIdea[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isIdea).slice(0, LIMIT)
  } catch {
    return []
  }
}

export function saveRecentTo(storage: IdeaStore, draft: RecentDraft, now = new Date()): RecentIdea {
  const current = readRecentFrom(storage)
  const existing = current.find((item) => item.id === draft.id)
  const entry: RecentIdea = {
    id: draft.id,
    title: existing?.title ?? titleFor(draft.idea, draft.audioOnly),
    date: now.toISOString(),
    sessionId: draft.sessionId,
    brief: draft.brief,
    prompts: draft.prompts,
    layers: draft.layers,
    renders: draft.renders,
    thread: draft.thread.length > 0 ? draft.thread : (existing?.thread ?? []),
    trace: draft.trace,
    question: draft.question,
    status: draft.status,
    mode: draft.mode ?? existing?.mode ?? "full",
  }
  const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, LIMIT)
  storage.setItem(KEY, JSON.stringify(next))
  return entry
}

export function restoreRecentFrom(storage: IdeaStore, id: string): RecentIdea | null {
  return readRecentFrom(storage).find((item) => item.id === id) ?? null
}

export function renameRecentIn(storage: IdeaStore, id: string, title: string): RecentIdea | null {
  const trimmed = title.trim()
  const current = readRecentFrom(storage)
  const found = current.find((item) => item.id === id)
  if (!found) return null
  if (!trimmed) return found
  const entry = { ...found, title: trimmed }
  storage.setItem(KEY, JSON.stringify(current.map((item) => (item.id === id ? entry : item))))
  return entry
}

export function deleteRecentFrom(storage: IdeaStore, id: string): RecentIdea[] {
  const next = readRecentFrom(storage).filter((item) => item.id !== id)
  storage.setItem(KEY, JSON.stringify(next))
  return next
}

export function readRecent(): RecentIdea[] {
  const store = browserStore()
  if (!store) return []
  return readRecentFrom(store)
}

export function saveRecent(draft: RecentDraft, now = new Date()): RecentIdea | null {
  const store = browserStore()
  if (!store) return null
  try {
    const saved = saveRecentTo(store, draft, now)
    publish()
    return saved
  } catch {
    return null
  }
}

export function renameRecent(id: string, title: string): RecentIdea | null {
  const store = browserStore()
  if (!store) return null
  try {
    const saved = renameRecentIn(store, id, title)
    publish()
    return saved
  } catch {
    return null
  }
}

export function deleteRecent(id: string): RecentIdea[] {
  const store = browserStore()
  if (!store) return []
  try {
    const next = deleteRecentFrom(store, id)
    publish()
    return next
  } catch {
    return readRecent()
  }
}

function count(value: number, unit: string): string {
  return value === 1 ? `1 ${unit} ago` : `${value} ${unit}s ago`
}

function isIdea(value: unknown): value is RecentIdea {
  if (!value || typeof value !== "object") return false
  const item = value as RecentIdea
  return typeof item.id === "string" && typeof item.title === "string" && typeof item.date === "string" && typeof item.sessionId === "string" && Array.isArray(item.layers) && Array.isArray(item.renders) && Array.isArray(item.thread) && !!item.brief && typeof item.brief === "object"
}

function browserStore(): IdeaStore | null {
  const store = (globalThis as { localStorage?: IdeaStore }).localStorage
  if (!store || typeof store.getItem !== "function" || typeof store.setItem !== "function") return null
  return store
}

function publish() {
  const target = globalThis as { dispatchEvent?: (event: Event) => boolean }
  if (typeof target.dispatchEvent !== "function") return
  target.dispatchEvent(new Event("vision-studio-recent"))
}
