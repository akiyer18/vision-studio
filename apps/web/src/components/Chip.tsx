import type { ButtonHTMLAttributes, ReactNode } from "react"

type Props = {
  selected?: boolean
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export function Chip({ selected = false, className = "", type = "button", children, ...props }: Props) {
  const face = selected ? "border-accent text-ink shadow-[inset_0_0_0_1px_var(--accent)]" : "border-[var(--line)] text-secondary"
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={`inline-flex min-h-8 items-center rounded-full border bg-raised px-3 py-1 text-sm transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${face} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
