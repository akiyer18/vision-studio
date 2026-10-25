import { authHeaders, clerkEnabled } from "./token.ts"
import { readRecent, type RecentIdea } from "../recentIdeas.ts"
import { readProgress, type TrainRecord } from "../trainProgress.ts"

const IMPORTED_KEY = "vision-studio-cloud-imported"

function apiBase(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  const configured = env?.VITE_API_URL
  const value = configured && configured.length > 0 ? configured : "http://127.0.0.1:8000"
  return value.replace(/\/$/, "")
}

async function authed(path: string, init?: RequestInit): Promise<Response | null> {
  const headers = new Headers(init?.headers)
  headers.set("Content-Type", "application/json")
  const auth = await authHeaders()
  if (!auth.Authorization) return null
  for (const [key, value] of Object.entries(auth)) headers.set(key, value)
  return fetch(`${apiBase()}${path}`, { ...init, headers })
}

export function importMarkers(): { ideasKey: string; trainKey: string } {
  return { ideasKey: "vision-studio-recent", trainKey: "vision-studio-train-progress" }
}

export async function importLocalDataOnce(): Promise<{ ideas: number; train: number } | null> {
  if (!clerkEnabled()) return null
  try {
    if (localStorage.getItem(IMPORTED_KEY) === "1") return null
  } catch {
    return null
  }
  const ideas = readRecent().map((idea) => ({
    id: idea.id,
    session_id: idea.sessionId,
    title: idea.title,
    brief: idea.brief,
    prompts: idea.prompts,
    selected_layers: idea.layers,
    renders: idea.renders,
    date: idea.date,
    status: idea.status,
    mode: idea.mode,
    thread: idea.thread,
    trace: idea.trace,
  }))
  const train = readProgress().map((record) => ({
    template_id: record.templateId,
    category: record.category,
    level: record.level,
    stars: record.stars,
    date: record.date,
    next: record.next,
  }))
  if (ideas.length === 0 && train.length === 0) {
    try {
      localStorage.setItem(IMPORTED_KEY, "1")
    } catch {
      /* ignore */
    }
    return { ideas: 0, train: 0 }
  }
  const response = await authed("/me/import", {
    method: "POST",
    body: JSON.stringify({ ideas, train }),
  })
  if (!response || !response.ok) return null
  const body = (await response.json()) as { ideas: number; train: number }
  try {
    localStorage.setItem(IMPORTED_KEY, "1")
    localStorage.removeItem("vision-studio-recent")
    localStorage.removeItem("vision-studio-train-progress")
  } catch {
    /* ignore */
  }
  return body
}

export async function pushIdea(idea: RecentIdea): Promise<boolean> {
  const response = await authed(`/me/ideas/${idea.id}`, {
    method: "PUT",
    body: JSON.stringify({
      id: idea.id,
      session_id: idea.sessionId,
      title: idea.title,
      brief: idea.brief,
      prompts: idea.prompts,
      selected_layers: idea.layers,
      renders: idea.renders,
      date: idea.date,
      status: idea.status,
      mode: idea.mode,
      thread: idea.thread,
      trace: idea.trace,
    }),
  })
  return Boolean(response?.ok)
}

export async function pushTrainRecord(record: TrainRecord): Promise<boolean> {
  const response = await authed("/me/import", {
    method: "POST",
    body: JSON.stringify({
      ideas: [],
      train: [
        {
          template_id: record.templateId,
          category: record.category,
          level: record.level,
          stars: record.stars,
          date: record.date,
          next: record.next,
        },
      ],
    }),
  })
  return Boolean(response?.ok)
}
