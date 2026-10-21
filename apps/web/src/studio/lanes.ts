export const LANES = ["drums", "chords", "bass", "melody", "texture", "full_mix"] as const

export type LaneId = (typeof LANES)[number]

type LanePaint = {
  fill: string
  ink: string
  wave: string
  progress: string
}

const ink = "#EEEDF7"
const playhead = "#A78BFA"
const ground = "#12121C"

export const LANE_PAINT: Record<LaneId, LanePaint> = {
  drums: { fill: ground, ink, wave: "#F07167", progress: playhead },
  chords: { fill: ground, ink, wave: "#F2C14E", progress: playhead },
  bass: { fill: ground, ink, wave: "#4FD1A5", progress: playhead },
  melody: { fill: ground, ink, wave: "#7AA2FF", progress: playhead },
  texture: { fill: ground, ink, wave: "#C084FC", progress: playhead },
  full_mix: { fill: ground, ink, wave: "#A78BFA", progress: playhead },
}

export function lanePaint(layer: string): LanePaint {
  const base = layer.replace(/_[ab]$/, "")
  if (base in LANE_PAINT) return LANE_PAINT[base as LaneId]
  return { fill: ground, ink, wave: "#A78BFA", progress: playhead }
}
