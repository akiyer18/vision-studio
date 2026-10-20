import type { ReactNode } from "react"

export function Toast({ tone = "quiet", children }: { tone?: "quiet" | "error"; children: ReactNode }) {
  const face = tone === "error" ? "border-clip-red text-clip-red" : "border-walnut-line text-tape-cream"
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-button border bg-studio-night px-4 py-3 text-sm ${face}`}>
      {children}
    </div>
  )
}
