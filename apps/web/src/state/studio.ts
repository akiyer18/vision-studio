import { create } from "zustand"

import type { RenderResult } from "../types/render_result.ts"
import type { SlotName } from "../types/slot_name.ts"
import type { TurnRequest } from "../types/turn_request.ts"
import type { TurnResponse } from "../types/turn_response.ts"

export type UiStatus = "idle" | "working" | "ready" | "error"
export type SlotOverrides = NonNullable<TurnRequest["overrides"]>

type StudioState = {
  sessionId: string
  turn: TurnResponse | null
  renders: RenderResult[]
  picks: Record<string, number>
  status: UiStatus
  overrides: SlotOverrides
  setTurn: (turn: TurnResponse | null) => void
  commitTurn: (turn: TurnResponse, clearOverrides?: boolean) => void
  queueOverride: (slot: SlotName, value: string) => void
  setRenders: (renders: RenderResult[]) => void
  pickVariation: (layer: string, variant: number) => void
  setStatus: (status: UiStatus) => void
}

export const useStudio = create<StudioState>((set) => ({
  sessionId: crypto.randomUUID(),
  turn: null,
  renders: [],
  picks: {},
  status: "idle",
  overrides: {},
  setTurn: (turn) => set({ turn }),
  commitTurn: (turn, clearOverrides = false) =>
    set((state) => ({
      turn,
      status: turn.status === "ready" ? "ready" : "idle",
      overrides: clearOverrides ? {} : state.overrides,
    })),
  queueOverride: (slot, value) => set((state) => ({ overrides: { ...state.overrides, [slot]: value } })),
  setRenders: (renders) => set({ renders }),
  pickVariation: (layer, variant) => set((state) => ({ picks: { ...state.picks, [layer]: variant } })),
  setStatus: (status) => set({ status }),
}))
