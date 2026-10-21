import { useEffect, useState } from "react"

import { features } from "./features.ts"
import { FLOW, tourBody, type FlowStep } from "./flow.ts"

const seenKey = "vision-studio-tour"

export type TourStep = {
  id: string
  title: string
  body: string
}

function welcomeBody(): string {
  const base = "Vision Studio turns a feeling into layers you can edit. It takes about 60 seconds."
  return features.demo ? `${base} A 30 second demo is there if you want one.` : base
}

export function tourSteps(): TourStep[] {
  return [
    { id: "welcome", title: "Vision Studio", body: welcomeBody() },
    ...FLOW.map((step) => ({ id: step.id, title: step.name, body: tourBody(step.id as FlowStep) })),
  ]
}

export function markTourSeen() {
  try {
    localStorage.setItem(seenKey, "1")
  } catch {
    /* The tour still closes when storage is blocked. */
  }
}

export function useTour() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(seenKey)) return
    } catch {
      return
    }
    const timer = window.setTimeout(() => setOpen(true), 800)
    return () => window.clearTimeout(timer)
  }, [])

  function finish() {
    markTourSeen()
    setOpen(false)
  }

  function replay() {
    try {
      localStorage.removeItem(seenKey)
    } catch {
      /* Replay still opens. */
    }
    setOpen(true)
  }

  return { open, finish, replay }
}
