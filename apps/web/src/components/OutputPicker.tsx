import type { OutputChoice } from "../types/output_choice.ts"
import { OUTPUTS } from "../studio/output.ts"
import { Chip } from "./Chip.tsx"

type Props = {
  value: OutputChoice[]
  onChange: (choice: OutputChoice) => void
}

export function OutputPicker({ value, onChange }: Props) {
  const current = value.length === 1 ? value[0] : null
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Output">
      {OUTPUTS.map((option) => (
        <Chip key={option.choice} selected={option.choice === current} onClick={() => onChange(option.choice)}>
          {option.label}
        </Chip>
      ))}
    </div>
  )
}
