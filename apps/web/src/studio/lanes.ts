export const LANES = ["drums", "chords", "bass", "melody", "texture", "full_mix"] as const

export type LaneId = (typeof LANES)[number]

type LanePaint = {
  fill: string
  ink: string
  wave: string
  progress: string
}

const ink = "#F2EDE8"
const playhead = "#FF6A2B"
const ground = "#141210"

export const LANE_PAINT: Record<LaneId, LanePaint> = {
  drums: { fill: ground, ink, wave: "#C45A4A", progress: playhead },
  chords: { fill: ground, ink, wave: "#C9A15A", progress: playhead },
  bass: { fill: ground, ink, wave: "#3D8F78", progress: playhead },
  melody: { fill: ground, ink, wave: "#5D7EC4", progress: playhead },
  texture: { fill: ground, ink, wave: "#8A6BB8", progress: playhead },
  full_mix: { fill: ground, ink, wave: "#A39B92", progress: playhead },
}

export function lanePaint(layer: string): LanePaint {
  const base = layer.replace(/_[ab]$/, "")
  if (base in LANE_PAINT) return LANE_PAINT[base as LaneId]
  return { fill: ground, ink, wave: "#A39B92", progress: playhead }
}
