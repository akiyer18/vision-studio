import type { ButtonHTMLAttributes, ReactNode } from "react"

const tones = {
  primary: "btn-primary bg-accent text-canvas",
  secondary: "border border-white/15 bg-transparent text-ink",
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
      className={`inline-flex min-h-11 max-w-full shrink-0 items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
