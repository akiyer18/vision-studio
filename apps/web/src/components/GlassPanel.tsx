import type { ReactNode } from "react"

export function GlassPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border border-rule bg-desk p-4 ${className}`}>
      {children}
    </div>
  )
}
