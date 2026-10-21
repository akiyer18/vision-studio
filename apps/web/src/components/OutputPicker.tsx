import { features } from "../features.ts"
import type { OutputChoice } from "../types/output_choice.ts"
import { LANE_PAINT } from "../studio/lanes.ts"
import { OUTPUTS } from "../studio/output.ts"
import { Chip } from "./Chip.tsx"

const chipHue: Partial<Record<OutputChoice, string>> = {
  drums: LANE_PAINT.drums.fill,
  chords: LANE_PAINT.chords.fill,
  bass: LANE_PAINT.bass.fill,
  melody: LANE_PAINT.melody.fill,
  texture: LANE_PAINT.texture.fill,
  full_mix: "#F6F1E8",
}

type Props = {
  value: OutputChoice[]
  onChange: (choice: OutputChoice) => void
}

export function OutputPicker({ value, onChange }: Props) {
  const current = value.length === 1 ? value[0] : null
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Output">
      {OUTPUTS.filter((option) => features.fullMix || option.choice !== "full_mix").map((option) => (
        <Chip
          key={option.choice}
          selected={option.choice === current}
          onClick={() => onChange(option.choice)}
          style={
            option.choice === "full_mix"
              ? { borderColor: "#F6F1E8", boxShadow: "0 0 0 1px var(--rule)" }
              : chipHue[option.choice]
                ? { borderColor: chipHue[option.choice] }
                : undefined
          }
        >
          {option.label}
        </Chip>
      ))}
    </div>
  )
}
