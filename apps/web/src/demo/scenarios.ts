export type ScenarioId = "rainy" | "loop" | "summer"

export const SCENARIOS: { id: ScenarioId; label: string; detail: string }[] = [
  {
    id: "rainy",
    label: "Rainy night",
    detail: "Answer all layers separately, skip one question, then skip all.",
  },
  {
    id: "loop",
    label: "Detected loop",
    detail: "Confirm the detected key and tempo. The key question is not asked.",
  },
  {
    id: "summer",
    label: "Summer",
    detail: "The single word still builds a full set of prompts.",
  },
]
