import type { ReactNode } from "react"

import { Button } from "./Button.tsx"

export function EmptyState({
  title,
  reason,
  action,
  onAction,
  disabled = false,
}: {
  title: string
  reason: string
  action: string
  onAction: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-3">
      <h2>{title}</h2>
      <p className="text-dust">{reason}</p>
      <Button disabled={disabled} onClick={onAction}>
        {action}
      </Button>
    </div>
  )
}

export function StepError({
  message,
  onRetry,
  tone = "primary",
}: {
  message: string
  onRetry: () => void
  tone?: "primary" | "secondary"
}) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-3">
      <p role="alert" className="text-fault">
        {message}
      </p>
      <Button tone={tone} onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

export function StepFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-6 p-4">
      <h1 className="sr-only">{title}</h1>
      {children}
    </section>
  )
}
