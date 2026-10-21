import { create } from "zustand"

import type { RenderResult } from "../types/render_result.ts"
import type { SlotName } from "../types/slot_name.ts"
import type { TurnRequest } from "../types/turn_request.ts"
import type { TurnResponse } from "../types/turn_response.ts"

export type UiStatus = "idle" | "working" | "ready" | "error"
export type SlotOverrides = NonNullable<TurnRequest["overrides"]>
export type PromptEdit = { prompt?: string; negative?: string }
export type RenderAction = "render" | "regenerate"
export type LayerRun = { take: number; variant: number; total: number }
export type LayerFailure = { message: string; action: RenderAction }
export type ExportListing = { folder: string; files: string[]; defaults: boolean }

type StudioState = {
  sessionId: string
  turn: TurnResponse | null
  renders: RenderResult[]
  picks: Record<string, number>
  status: UiStatus
  overrides: SlotOverrides
  promptEdits: Record<string, PromptEdit>
  streamToken: number
  runId: number
  layerOrder: string[]
  runs: Record<string, LayerRun>
  failures: Record<string, LayerFailure>
  takes: Record<string, number>
  exportListing: ExportListing | null
  exportError: string | null
  solo: string | null
  muted: string[]
  focusedLane: string | null
  heard: boolean
  setTurn: (turn: TurnResponse | null) => void
  commitTurn: (turn: TurnResponse, clearOverrides?: boolean) => void
  queueOverride: (slot: SlotName, value: string) => void
  editPrompt: (layer: string, field: keyof PromptEdit, value: string) => void
  resetPrompt: (layer: string) => void
  setRenders: (renders: RenderResult[]) => void
  beginRender: (layers: string[]) => void
  beginLayer: (layer: string, action: RenderAction) => void
  noteProgress: (layer: string, run: LayerRun) => void
  finishLayer: (layer: string, results: RenderResult[], take: number) => void
  failLayer: (layer: string, failure: LayerFailure) => void
  finishRun: () => void
  togglePick: (layer: string, variant: number) => void
  setExport: (listing: ExportListing) => void
  setExportError: (message: string | null) => void
  setStatus: (status: UiStatus) => void
  toggleSolo: (layer: string) => void
  toggleMute: (layer: string) => void
  setFocusedLane: (layer: string | null) => void
  hear: () => void
  resetSession: () => void
}

export const useStudio = create<StudioState>((set) => ({
  sessionId: crypto.randomUUID(),
  turn: null,
  renders: [],
  picks: {},
  status: "idle",
  overrides: {},
  promptEdits: {},
  streamToken: 0,
  runId: 0,
  layerOrder: [],
  runs: {},
  failures: {},
  takes: {},
  exportListing: null,
  exportError: null,
  solo: null,
  muted: [],
  focusedLane: null,
  heard: false,
  setTurn: (turn) => set({ turn }),
  commitTurn: (turn, clearOverrides = false) =>
    set((state) => ({
      turn,
      status: turn.status === "ready" ? "ready" : "idle",
      overrides: clearOverrides ? {} : state.overrides,
      promptEdits: {},
      streamToken: state.streamToken + 1,
      renders: [],
      picks: {},
      layerOrder: [],
      runs: {},
      failures: {},
      takes: {},
      exportListing: null,
      exportError: null,
      heard: false,
    })),
  queueOverride: (slot, value) => set((state) => ({ overrides: { ...state.overrides, [slot]: value } })),
  editPrompt: (layer, field, value) =>
    set((state) => ({
      promptEdits: { ...state.promptEdits, [layer]: { ...state.promptEdits[layer], [field]: value } },
    })),
  resetPrompt: (layer) =>
    set((state) => {
      const promptEdits = { ...state.promptEdits }
      delete promptEdits[layer]
      return { promptEdits }
    }),
  setRenders: (renders) => set({ renders }),
  beginRender: (layers) =>
    set((state) => ({
      status: "working",
      streamToken: state.streamToken + 1,
      runId: state.runId + 1,
      layerOrder: layers,
      renders: [],
      runs: Object.fromEntries(layers.map((layer) => [layer, { take: 1, variant: 1, total: 3 }])),
      failures: {},
      takes: Object.fromEntries(layers.map((layer) => [layer, 1])),
      exportListing: null,
      exportError: null,
      heard: false,
    })),
  beginLayer: (layer, action) =>
    set((state) => ({
      status: "working",
      streamToken: state.streamToken + 1,
      runId: state.runId + 1,
      runs: {
        ...state.runs,
        [layer]: { take: action === "regenerate" ? (state.takes[layer] ?? 1) + 1 : 1, variant: 1, total: 3 },
      },
      failures: without(state.failures, layer),
      exportError: null,
    })),
  noteProgress: (layer, run) => set((state) => ({ runs: { ...state.runs, [layer]: run } })),
  finishLayer: (layer, results, take) =>
    set((state) => ({
      renders: [...state.renders.filter((item) => item.layer !== layer), ...results],
      runs: without(state.runs, layer),
      failures: without(state.failures, layer),
      takes: { ...state.takes, [layer]: take },
    })),
  failLayer: (layer, failure) =>
    set((state) => ({
      runs: without(state.runs, layer),
      failures: { ...state.failures, [layer]: failure },
    })),
  finishRun: () =>
    set((state) => ({
      status: state.renders.length > 0 ? "ready" : "error",
      runs: {},
    })),
  togglePick: (layer, variant) =>
    set((state) => {
      const picks = { ...state.picks }
      if (picks[layer] === variant) delete picks[layer]
      else picks[layer] = variant
      return { picks }
    }),
  setExport: (listing) => set({ exportListing: listing, exportError: null }),
  setExportError: (message) => set({ exportError: message }),
  setStatus: (status) => set({ status }),
  toggleSolo: (layer) => set((state) => ({ solo: state.solo === layer ? null : layer })),
  toggleMute: (layer) =>
    set((state) => ({
      muted: state.muted.includes(layer) ? state.muted.filter((item) => item !== layer) : [...state.muted, layer],
    })),
  setFocusedLane: (layer) => set({ focusedLane: layer }),
  hear: () => set({ heard: true }),
  resetSession: () =>
    set((state) => ({
      sessionId: crypto.randomUUID(),
      turn: null,
      renders: [],
      picks: {},
      status: "idle",
      overrides: {},
      promptEdits: {},
      streamToken: state.streamToken + 1,
      runId: 0,
      layerOrder: [],
      runs: {},
      failures: {},
      takes: {},
      exportListing: null,
      exportError: null,
      solo: null,
      muted: [],
      focusedLane: null,
      heard: false,
    })),
}))

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
