import { useEffect, useState, type RefCallback } from "react"
import { useReducedMotion } from "framer-motion"

import { GraduationCap, PenLine, ScanSearch, type LucideIcon } from "lucide-react"

import { features } from "../../features.ts"
import { go } from "../../route.ts"
import { Button } from "../Button.tsx"
import { Logo } from "../Logo.tsx"
import { PreviewCard } from "./PreviewCard.tsx"

const lines = [
  "Learn the groove behind a house beat",
  "Hear why this progression feels sad",
  "Make dark industrial drums at 94 BPM",
  "Find out why my chorus feels small",
]

const steps = [
  { title: "Choose your level", copy: "Beginner, intermediate, or advanced." },
  { title: "Pick a skill", copy: "Rhythm, harmony, sound design, arrangement." },
  { title: "Listen, recreate in your DAW, upload", copy: "Play the exercise, rebuild it, then send your version." },
  { title: "Get feedback", copy: "What matched, what differed and what to practise next." },
]

const modes: {
  title: string
  copy: string
  icon: LucideIcon
  soon: boolean
  open: () => void
}[] = [
  {
    title: "Train",
    copy: "Learn by doing. Recreate short exercises in your own DAW and get feedback bar by bar.",
    icon: GraduationCap,
    soon: false,
    open: () => go("/train"),
  },
  {
    title: "Analyse",
    copy: "Understand your own track. Get specific suggestions you can hear and choose to apply.",
    icon: ScanSearch,
    soon: !features.analyser,
    open: () => undefined,
  },
  {
    title: "Create",
    copy: "Explore alternatives when you are stuck. Every result explains what it did and why.",
    icon: PenLine,
    soon: !features.create,
    open: () => go("/create"),
  },
]

const people = [
  {
    title: "Aspiring producer",
    copy: "You hear ideas but do not know how to build them yet. Start with simple grooves and chords, learn the names for what you hear.",
  },
  {
    title: "Bedroom producer",
    copy: "You finish loops but they feel flat. Practise syncopation, voicings and arrangement, and compare your version with the reference.",
  },
  {
    title: "Working producer",
    copy: "You know your tools and want speed and fresh ideas. Generate alternatives that fit your track and inspect exactly how they were made.",
  },
]

type Props = {
  composerHost: RefCallback<HTMLDivElement>
}

export function Home({ composerHost }: Props) {
  return (
    <div className="home-screen">
      <header className="home-bar">
        <button type="button" className="wordmark flex items-center gap-2" onClick={() => go("/")}>
          <Logo />
          <span className="wordmark-copy">Vision Studio</span>
        </button>
        <nav className="home-nav" aria-label="Studio">
          <button type="button" onClick={() => go("/create")}>
            Create
          </button>
          <button type="button" onClick={() => go("/genres")}>
            Genres
          </button>
          <button
            type="button"
            onClick={() => {
              const target = document.getElementById("how-it-works")
              const pane = target?.closest(".page-fill")
              if (!target || !(pane instanceof HTMLElement)) return
              const scroller = pane
              const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 88
              const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
              if (reduce) {
                scroller.scrollTop = top
                return
              }
              const start = scroller.scrollTop
              const change = top - start
              const t0 = performance.now()
              function step(now: number) {
                const t = Math.min(1, (now - t0) / 420)
                scroller.scrollTop = start + change * (1 - (1 - t) ** 3)
                if (t < 1) requestAnimationFrame(step)
              }
              requestAnimationFrame(step)
            }}
          >
            How it works
          </button>
        </nav>
        <Button className="home-start" onClick={() => go("/train")}>
          Start training
        </Button>
      </header>
      <section className="home-hero" aria-label="Intro">
        <PreviewCard title="Drums" side="left" wave="#F07167" />
        <div className="home-hero-copy">
          <Typed />
          <p className="home-sub">Train your ear, understand your tracks, and create new ideas without losing your own sound.</p>
          <div className="home-actions">
            <Button onClick={() => go("/train")}>Start training</Button>
            <Button tone="secondary" onClick={() => go("/create")}>
              Create
            </Button>
          </div>
          <div ref={composerHost} className="home-composer" />
        </div>
        <PreviewCard title="Chords" side="right" wave="#F2C14E" />
      </section>
      <div className="home-below">
        <section className="home-room-board" aria-label="Modes">
          {modes.map((mode) => {
            const Icon = mode.icon
            return (
              <article key={mode.title} className={`card home-room ${mode.soon ? "is-soon" : "is-live"}`}>
                <Icon aria-hidden="true" size={18} />
                <h2 className="section-title">{mode.title}</h2>
                <p className="text-secondary">{mode.copy}</p>
                <div className="mt-auto flex items-center gap-2">
                  {mode.soon ? <span className="soon-tag">Coming soon</span> : null}
                  <Button tone={mode.soon ? "secondary" : "primary"} disabled={mode.soon} onClick={mode.open}>
                    Open
                  </Button>
                </div>
              </article>
            )
          })}
        </section>
        <section className="home-people" aria-label="Who it is for">
          {people.map((person) => (
            <article key={person.title} className="card home-room">
              <h2 className="section-title">{person.title}</h2>
              <p className="text-secondary">{person.copy}</p>
            </article>
          ))}
        </section>
        <section id="how-it-works" className="home-steps" aria-label="How it works">
          <ol>
            {steps.map((step, index) => (
              <li key={step.title}>
                <p className="eyebrow">{index + 1}</p>
                <h2 className="section-title">{step.title}</h2>
                <p className="text-secondary">{step.copy}</p>
              </li>
            ))}
          </ol>
        </section>
        <p className="home-credits">Built with Stable Audio 3, AWS Bedrock and Soundcharts.</p>
      </div>
    </div>
  )
}

function Typed() {
  const reduce = useReducedMotion()
  const [line, setLine] = useState(0)
  const [count, setCount] = useState(lines[0]?.length ?? 0)

  useEffect(() => {
    if (reduce) return
    const full = lines[line] ?? ""
    if (count < full.length) {
      const timer = window.setTimeout(() => setCount((value) => value + 1), 38)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => {
      setLine((value) => (value + 1) % lines.length)
      setCount(0)
    }, 3200)
    return () => window.clearTimeout(timer)
  }, [count, line, reduce])

  const shown = reduce ? lines[0] : (lines[line] ?? "").slice(0, count)
  return (
      <h1 className="home-headline">
        {shown}
        {reduce ? null : <span className="home-caret" aria-hidden="true" />}
      </h1>
  )
}
