import type { AudioFeatures } from "../types/audio_features.ts"
import type { InputType } from "../types/input_type.ts"
import type { RenderResult } from "../types/render_result.ts"
import type { LayerPrompt } from "../types/layer_prompt.ts"
import type { SongBrief } from "../types/song_brief.ts"
import type { TraceStep } from "../types/trace_step.ts"
import type { TurnRequest } from "../types/turn_request.ts"
import type { TurnResponse } from "../types/turn_response.ts"

export type RenderRequest = {
  session_id: string
  prompts?: { layer: string; prompt: string; negative: string }[]
  layer?: string
}

export type RenderEvent =
  | { kind: "progress"; layer: string; take: number; variant: number; total: number }
  | { kind: "layer"; take: number; results: RenderResult[] }
  | { kind: "error"; layer: string; message: string }
  | { kind: "done" }

export type RegenerateRequest = {
  session_id: string
  layer: string
}

export type ExportRequest = {
  session_id: string
  picks?: Record<string, number>
}

export type ExportResponse = {
  files: string[]
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

function baseUrl(): string {
  const configured = import.meta.env.VITE_API_URL
  const value = configured && configured.length > 0 ? configured : "http://127.0.0.1:8000"
  return value.replace(/\/$/, "")
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, init)
  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status)
  }
  return response.json() as Promise<T>
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === "string") return body.detail
  } catch {
    return response.statusText
  }
  return response.statusText
}

export function upload(input: { session_id: string; input_type: InputType; file: File }): Promise<AudioFeatures> {
  const body = new FormData()
  body.set("session_id", input.session_id)
  body.set("input_type", input.input_type)
  body.set("file", input.file)
  return request<AudioFeatures>("/upload", { method: "POST", body })
}

export type GenreSummary = { id: string; title: string }

export type GenreDetail = {
  id: string
  title: string
  tempo_range: string
  bpm: number
  keys: string[]
  instruments: string[]
  drum_pattern: string
  production: string
  references: { artist: string; tracks: string[] }[]
  history: string
  prefill: NonNullable<TurnRequest["reference"]>
}

export type Explanation = { how: string; steps: string[]; source: string }

export function listGenres(): Promise<GenreSummary[]> {
  return request<GenreSummary[]>("/genres")
}

export function genreDetail(id: string): Promise<GenreDetail> {
  return request<GenreDetail>(`/genres/${encodeURIComponent(id)}`)
}

export function explainResult(body: {
  brief: SongBrief
  prompts: LayerPrompt[]
  trace: TraceStep[]
  depth?: "beginner" | "intermediate" | "advanced"
}): Promise<Explanation> {
  return request<Explanation>("/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function sessionDebug(sessionId: string): Promise<{
  upload: { file?: string; path?: string; features?: AudioFeatures } | null
  jobs: { layer: string; prompt: string; negative: string; init_audio?: string | null; noise?: number | null }[]
  payload: Record<string, unknown>
  notes: string[]
}> {
  return request(`/debug/${encodeURIComponent(sessionId)}`)
}

export function turn(body: TurnRequest): Promise<TurnResponse> {
  return request<TurnResponse>("/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function render(body: RenderRequest): Promise<RenderResult[]> {
  return request<RenderResult[]>("/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function renderEvents(body: RenderRequest, onEvent: (event: RenderEvent) => void): Promise<void> {
  return streamEvents("/render", body, onEvent)
}

export function regenerate(body: RegenerateRequest): Promise<RenderResult[]> {
  return request<RenderResult[]>("/regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function regenerateEvents(body: RegenerateRequest, onEvent: (event: RenderEvent) => void): Promise<void> {
  return streamEvents("/regenerate", body, onEvent)
}

export function exportSession(body: ExportRequest): Promise<ExportResponse> {
  return request<ExportResponse>("/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function sessionPath(filePath: string): string {
  for (const marker of ["renders/", "midi/", "export/", "audio/"]) {
    const index = filePath.lastIndexOf(marker)
    if (index !== -1) return filePath.slice(index)
  }
  const name = filePath.split("/").pop()
  return name && name.length > 0 ? name : filePath
}

export function fileName(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop()
  return name && name.length > 0 ? name : filePath
}

export function folderPath(files: string[]): string {
  const first = files[0]
  if (!first) return ""
  const index = Math.max(first.lastIndexOf("/"), first.lastIndexOf("\\"))
  return index === -1 ? first : first.slice(0, index)
}

export function fileUrl(sessionId: string, filePath: string, take?: number): string {
  const segments = sessionPath(filePath)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  const url = `${baseUrl()}/files/${encodeURIComponent(sessionId)}/${segments}`
  return take === undefined ? url : `${url}?take=${take}`
}

async function streamEvents(path: string, body: unknown, onEvent: (event: RenderEvent) => void): Promise<void> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status)
  }
  if (!response.body) {
    throw new ApiError("That did not go through. Try again.", response.status)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length > 0) onEvent(readEvent(trimmed))
    }
  }
  const rest = buffer.trim()
  if (rest.length > 0) onEvent(readEvent(rest))
}

function readEvent(line: string): RenderEvent {
  const value: unknown = JSON.parse(line)
  if (!isRenderEvent(value)) {
    throw new ApiError("That did not go through. Try again.", 502)
  }
  return value
}

function isRenderEvent(value: unknown): value is RenderEvent {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false
  const kind = value.kind
  if (kind === "done") return true
  if (kind === "error") return "layer" in value && "message" in value
  if (kind === "progress") return "layer" in value && "take" in value && "variant" in value && "total" in value
  if (kind === "layer") return "take" in value && "results" in value && Array.isArray(value.results)
  return false
}

export function getFile(sessionId: string, filePath: string): Promise<Blob> {
  return fetch(fileUrl(sessionId, filePath)).then((response) => {
    if (!response.ok) {
      throw new ApiError(response.statusText, response.status)
    }
    return response.blob()
  })
}

export type TrainExercise = {
  id: string
  template_id: string
  category: "rhythm" | "harmony"
  type: string
  type_label: string
  level: "beginner" | "intermediate" | "advanced"
  tempo: number
  bars: number
  key: string
  objective: string
  instructions: string
  audio: string
  note: string
  midi?: string
  built?: string
  pattern?: TrainPattern
}

export type TrainPattern = {
  drums: string[][]
  bass: { bar: number; start: number; pitch: number }[]
  chords: { bar: number; symbol: string; notes: number[] }[]
}

export type TrainEvent = {
  bar: number
  beat: number
  step: number
  what: string
  detail?: string
  confidence?: number
}

export type TrainCell = {
  step: number
  beat: number
  reference: string[] | number | null
  yours: string[] | number | null
  diff: boolean
}

export type TrainChord = {
  bar: number
  reference: string
  yours: number[]
  inversion: number
  diff: boolean
}

export type TrainResult = {
  status: string
  source?: string
  approximate?: boolean
  matches?: TrainEvent[]
  differences?: TrainEvent[]
  missing?: TrainEvent[]
  uncertain?: TrainEvent[]
  scores?: Record<string, number>
  progression_correct?: boolean | null
  voicing_similarity?: number | null
  grid?: {
    drums?: TrainCell[][]
    bass?: TrainCell[][]
    chords?: TrainChord[]
  }
}

export type TrainFeedback = {
  right: string
  differs: string
  improve: string
  next: string
  stars: number
  source: string
}

export type TrainSubmission =
  | { status: "needs_mapping"; notes: number[] }
  | { status: "compared"; result: TrainResult; feedback: TrainFeedback }

export function trainFileUrl(id: string, name: string): string {
  return `${baseUrl()}/train/files/${encodeURIComponent(id)}/${encodeURIComponent(name)}`
}

export function startExercise(body: {
  category: string
  type: string
  level: string
  tempo?: number
  bars?: number
  key?: string
}): Promise<TrainExercise> {
  return request<TrainExercise>("/train/exercise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function revealExercise(id: string): Promise<TrainExercise> {
  return request<TrainExercise>(`/train/exercise/${encodeURIComponent(id)}/reveal`, { method: "POST" })
}

export function submitExercise(id: string, file: File, mapping?: Record<string, string>): Promise<TrainSubmission> {
  const body = new FormData()
  body.set("file", file)
  if (mapping) body.set("mapping", JSON.stringify(mapping))
  return request<TrainSubmission>(`/train/exercise/${encodeURIComponent(id)}/submit`, { method: "POST", body })
}
