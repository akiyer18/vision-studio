import { useEffect, useState } from "react"

import { features } from "./features.ts"

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
    {
      id: "sidebar",
      title: "Sidebar",
      body: "Create is where you start. Genre deep dive sits beside it, and recent ideas stay on this side.",
    },
    {
      id: "composer",
      title: "Composer",
      body: features.record
        ? "Describe a feeling, attach a sound, or record one, then send it."
        : "Describe a feeling, or attach a sound, then send it.",
    },
    {
      id: "brief",
      title: "Song brief",
      body: "Tempo and key sit large. Each filled slot shows where it came from.",
    },
    {
      id: "build",
      title: "Build",
      body: features.fullMix
        ? "Choose the layers, including a full mix, then build."
        : "Choose the layers, then build. Each one comes back as three variations.",
    },
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
