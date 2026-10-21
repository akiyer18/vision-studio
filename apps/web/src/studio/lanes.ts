export const LANES = ["drums", "chords", "bass", "melody", "texture", "full_mix"] as const

export type LaneId = (typeof LANES)[number]

type LanePaint = {
  fill: string
  ink: string
  wave: string
  progress: string
}

const ink = "#0B0A1A"
const light = "#F4F2FF"

export const LANE_PAINT: Record<LaneId, LanePaint> = {
  drums: { fill: "#FF6B57", ink, wave: "rgba(11, 10, 26, 0.45)", progress: ink },
  chords: { fill: "#F5C451", ink, wave: "rgba(11, 10, 26, 0.45)", progress: ink },
  bass: { fill: "#3FD0A8", ink, wave: "rgba(11, 10, 26, 0.4)", progress: ink },
  melody: { fill: "#6C8CFF", ink, wave: "rgba(11, 10, 26, 0.4)", progress: ink },
  texture: { fill: "#B07CFF", ink, wave: "rgba(11, 10, 26, 0.4)", progress: ink },
  full_mix: { fill: "#16142C", ink: light, wave: "rgba(244, 242, 255, 0.55)", progress: "#8B6CFF" },
}

export function lanePaint(layer: string): LanePaint {
  const base = layer.replace(/_[ab]$/, "")
  if (base in LANE_PAINT) return LANE_PAINT[base as LaneId]
  return { fill: "#16142C", ink: light, wave: "rgba(244, 242, 255, 0.55)", progress: "#8B6CFF" }
}
