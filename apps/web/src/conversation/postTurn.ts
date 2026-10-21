import { turn } from "../api/client.ts"
import { useStudio } from "../state/studio.ts"
import type { TurnRequest } from "../types/turn_request.ts"

export async function postTurn(body: Omit<TurnRequest, "session_id" | "overrides">): Promise<void> {
  const state = useStudio.getState()
  const overrides = state.overrides
  const pending = Object.keys(overrides).length > 0
  state.setStatus("working")
  try {
    const reference = state.reference
    const seeded = Object.values(reference).some((value) => value)
    const response = await turn({
      session_id: state.sessionId,
      ...body,
      mode: state.mode,
      overrides: pending ? overrides : undefined,
      reference: seeded ? reference : undefined,
    })
    useStudio.getState().commitTurn(response, pending)
  } catch (error) {
    useStudio.getState().setStatus("error")
    throw error
  }
}
