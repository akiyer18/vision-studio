import { useEffect, useRef, useState } from "react"

import { tourSteps, type TourStep } from "../../tour.ts"

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [wasOpen, setWasOpen] = useState(false)
  const [visible, setVisible] = useState<TourStep[]>([])
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const scrolled = useRef<number | null>(null)

  if (open && !wasOpen) {
    setWasOpen(true)
    setIndex(0)
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  useEffect(() => {
    if (!open) {
      scrolled.current = null
      return
    }

    function measure() {
      const steps = shownSteps()
      setVisible(steps)
      const current = steps[Math.min(index, Math.max(0, steps.length - 1))]
      const target = current ? targetOf(current.id) : null
      if (!target) {
        setBox(null)
        return
      }
      const rect = target.getBoundingClientRect()
      if (scrolled.current !== index && (rect.top < 8 || rect.bottom > window.innerHeight - 8)) {
        scrolled.current = index
        target.scrollIntoView({ block: "center", behavior: "auto" })
      }
      const placed = target.getBoundingClientRect()
      setBox({ top: placed.top, left: placed.left, width: placed.width, height: placed.height })
    }

    const frame = window.requestAnimationFrame(measure)
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [open, index])

  useEffect(() => {
    if (open) dialog.current?.focus()
  }, [open, index])

  if (!open) return null

  const step = visible[Math.min(index, Math.max(0, visible.length - 1))] ?? null
  const last = step !== null && index >= visible.length - 1
  const cardTop = box ? Math.min(box.top + box.height + 12, window.innerHeight - 220) : 24
  const cardLeft = box ? Math.min(Math.max(12, box.left), window.innerWidth - 336) : 12

  return (
    <div className="fixed inset-0 z-40">
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 rounded-3xl"
          style={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
            boxShadow: "0 0 0 1px #FF5A1F, 0 0 0 9999px rgba(15, 15, 16, 0.72)",
          }}
        />
      ) : null}
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        className="panel fixed z-50 w-[min(20rem,calc(100vw-1.5rem))] p-4 text-ink outline-none"
        style={{ top: Math.max(12, cardTop), left: cardLeft }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <p id="tour-title">
            <strong>{step?.title ?? "Tour"}</strong>
          </p>
          <button type="button" aria-label="Close the tour" className="text-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-2 text-secondary">{step?.body}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="min-h-11 px-3 text-secondary disabled:opacity-40" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>
            Back
          </button>
          <button
            type="button"
            className="min-h-8 rounded-[6px] bg-accent px-3 text-[13px] text-canvas"
            onClick={() => {
              if (last || visible.length === 0) onClose()
              else setIndex((value) => value + 1)
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

function shownSteps(): TourStep[] {
  return tourSteps().filter((item) => targetOf(item.id) !== null)
}

function targetOf(id: string): Element | null {
  const target = document.querySelector(`[data-tour="${id}"]`)
  if (!target) return null
  const rect = target.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  return target
}
