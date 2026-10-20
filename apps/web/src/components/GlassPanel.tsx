import type { ReactNode } from "react"

export function GlassPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-panel border border-walnut-line bg-walnut-glass p-4 backdrop-blur-[24px] ${className}`}>
      {children}
    </div>
  )
}
