export function VuMeter({ value, label = "Confidence" }: { value: number; label?: string }) {
  const level = Math.min(1, Math.max(0, value))
  return (
    <div
      className="relative h-16 w-2 shrink-0 overflow-hidden rounded-full bg-walnut-line"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={level}
    >
      <div className="vu-fill absolute inset-x-0 bottom-0 rounded-full bg-vu-amber" style={{ height: `${level * 100}%` }} />
    </div>
  )
}
