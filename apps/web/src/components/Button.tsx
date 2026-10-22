import type { ButtonHTMLAttributes, ReactNode } from "react"

const tones = {
  primary: "bg-accent text-[var(--on-accent)]",
  secondary: "border border-[var(--line)] bg-raised text-ink",
  ghost: "bg-transparent text-secondary",
} as const

type Props = {
  tone?: keyof typeof tones
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export function Button({ tone = "primary", className = "", type = "button", children, ...props }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-8 max-w-full shrink-0 items-center justify-center rounded-[10px] px-3 py-1 text-sm font-medium transition duration-150 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
