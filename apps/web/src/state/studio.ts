import { create } from "zustand"

import type { RenderResult } from "../types/render_result.ts"
import type { TurnResponse } from "../types/turn_response.ts"

export type UiStatus = "idle" | "working" | "ready" | "error"

type StudioState = {
  sessionId: string
  turn: TurnResponse | null
  renders: RenderResult[]
  picks: Record<string, number>
  status: UiStatus
  setTurn: (turn: TurnResponse | null) => void
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
  setTurn: (turn) => set({ turn }),
  setRenders: (renders) => set({ renders }),
  pickVariation: (layer, variant) => set((state) => ({ picks: { ...state.picks, [layer]: variant } })),
  setStatus: (status) => set({ status }),
}))
