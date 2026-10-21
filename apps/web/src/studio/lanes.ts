export const LANES = ["drums", "chords", "bass", "melody", "texture", "full_mix"] as const

export type LaneId = (typeof LANES)[number]

type LanePaint = {
  fill: string
  ink: string
  wave: string
  progress: string
}

const ink = "#EDEDED"
const playhead = "#FF5A1F"

export const LANE_PAINT: Record<LaneId, LanePaint> = {
  drums: { fill: "#161617", ink, wave: "#E0533D", progress: playhead },
  chords: { fill: "#161617", ink, wave: "#E3B341", progress: playhead },
  bass: { fill: "#161617", ink, wave: "#2FA37C", progress: playhead },
  melody: { fill: "#161617", ink, wave: "#4C7DFF", progress: playhead },
  texture: { fill: "#161617", ink, wave: "#9B6BFF", progress: playhead },
  full_mix: { fill: "#161617", ink, wave: "#EDEDED", progress: playhead },
}

export function lanePaint(layer: string): LanePaint {
  const base = layer.replace(/_[ab]$/, "")
  if (base in LANE_PAINT) return LANE_PAINT[base as LaneId]
  return { fill: "#161617", ink, wave: "#EDEDED", progress: playhead }
}
