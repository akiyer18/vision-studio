export const LANES = ["drums", "chords", "bass", "melody", "texture", "full_mix"] as const

export type LaneId = (typeof LANES)[number]

type LanePaint = {
  fill: string
  ink: string
  wave: string
  progress: string
}

const lamp = "#F6F1E8"
const desk = "#3F3832"

export const LANE_PAINT: Record<LaneId, LanePaint> = {
  drums: { fill: "#B84532", ink: lamp, wave: "rgba(246, 241, 232, 0.55)", progress: lamp },
  chords: { fill: "#D7A441", ink: desk, wave: "rgba(63, 56, 50, 0.55)", progress: desk },
  bass: { fill: "#1F6E5C", ink: lamp, wave: "rgba(246, 241, 232, 0.55)", progress: lamp },
  melody: { fill: "#3D62C4", ink: lamp, wave: "rgba(246, 241, 232, 0.55)", progress: lamp },
  texture: { fill: "#7A4EA8", ink: lamp, wave: "rgba(246, 241, 232, 0.55)", progress: lamp },
  full_mix: { fill: lamp, ink: desk, wave: "rgba(63, 56, 50, 0.55)", progress: desk },
}

export function lanePaint(layer: string): LanePaint {
  if (layer in LANE_PAINT) return LANE_PAINT[layer as LaneId]
  return { fill: "transparent", ink: lamp, wave: "rgba(246, 241, 232, 0.55)", progress: lamp }
}
