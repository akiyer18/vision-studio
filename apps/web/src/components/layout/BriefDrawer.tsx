import { useEffect } from "react"

import { BriefCard } from "../brief/BriefCard.tsx"
import { ReasoningCard } from "../reasoning/ReasoningCard.tsx"

type Props = {
  open: boolean
  mark: string | null
  hot: boolean
  onClose: () => void
  onMark: (mark: string | null) => void
  onDescribe: () => void
}

export function BriefDrawer({ open, mark, hot, onClose, onMark, onDescribe }: Props) {
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return (
    <aside className={`brief-drawer ${open ? "is-open" : ""}`} aria-label="Brief" aria-hidden={open ? undefined : true} inert={open ? undefined : true}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Brief</h2>
        <button type="button" className="quiet-link" onClick={onClose}>
          Close
        </button>
      </div>
      <BriefCard mark={mark} hot={hot} />
      <ReasoningCard mark={mark} onMark={onMark} onDescribe={onDescribe} />
    </aside>
  )
}
