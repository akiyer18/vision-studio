import type { AudioFeatures } from "../types/audio_features.ts"
import type { InputType } from "../types/input_type.ts"
import type { RenderResult } from "../types/render_result.ts"
import type { TurnRequest } from "../types/turn_request.ts"
import type { TurnResponse } from "../types/turn_response.ts"

export type RenderRequest = {
  session_id: string
  prompts?: { layer: string; prompt: string; negative: string }[]
}

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

export function regenerate(body: RegenerateRequest): Promise<RenderResult[]> {
  return request<RenderResult[]>("/regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function exportSession(body: ExportRequest): Promise<ExportResponse> {
  return request<ExportResponse>("/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function fileUrl(sessionId: string, filePath: string): string {
  const segments = filePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${baseUrl()}/files/${encodeURIComponent(sessionId)}/${segments}`
}

export function getFile(sessionId: string, filePath: string): Promise<Blob> {
  return fetch(fileUrl(sessionId, filePath)).then((response) => {
    if (!response.ok) {
      throw new ApiError(response.statusText, response.status)
    }
    return response.blob()
  })
}
