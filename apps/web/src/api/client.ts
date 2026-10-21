import type { AudioFeatures } from "../types/audio_features.ts"
import type { InputType } from "../types/input_type.ts"
import type { RenderResult } from "../types/render_result.ts"
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
