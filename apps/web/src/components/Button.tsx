import type { ButtonHTMLAttributes, ReactNode } from "react"

const tones = {
  primary: "bg-vu-amber text-studio-night",
  secondary: "border border-walnut-line bg-walnut-glass text-tape-cream",
  ghost: "bg-transparent text-tape-cream",
} as const

type Props = {
  tone?: keyof typeof tones
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export function Button({ tone = "primary", className = "", type = "button", children, ...props }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 max-w-full shrink-0 items-center justify-center rounded-button px-4 py-2 text-sm font-medium transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
