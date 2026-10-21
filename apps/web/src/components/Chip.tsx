import type { ButtonHTMLAttributes, ReactNode } from "react"

type Props = {
  selected?: boolean
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export function Chip({ selected = false, className = "", type = "button", children, ...props }: Props) {
  const face = selected ? "border-accent bg-accent/20 text-ink" : "border-white/15 text-secondary"
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${face} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
