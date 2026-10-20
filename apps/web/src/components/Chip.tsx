import type { ButtonHTMLAttributes, ReactNode } from "react"

type Props = {
  selected?: boolean
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export function Chip({ selected = false, className = "", type = "button", children, ...props }: Props) {
  const face = selected ? "border-vu-amber text-tape-cream" : "border-walnut-line text-dust"
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={`inline-flex min-h-9 items-center rounded-chip border bg-studio-night/80 px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber disabled:cursor-not-allowed disabled:opacity-40 ${face} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
