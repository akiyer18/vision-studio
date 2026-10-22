import { useEffect, useState, type RefCallback } from "react"
import { useReducedMotion } from "framer-motion"
import { Library, PenLine, ScanSearch, SlidersHorizontal, type LucideIcon } from "lucide-react"

import { features } from "../../features.ts"
import { go } from "../../route.ts"
import { Button } from "../Button.tsx"
import { Logo } from "../Logo.tsx"
import { PreviewCard } from "./PreviewCard.tsx"

const lines = [
  "Make dark industrial drums at 94 BPM",
  "Turn my voice memo into neo soul chords",
  "Build a lofi bed for my instrumental",
]

const steps = [
  { title: "Describe", copy: "Say it, play it, or drop a file." },
  { title: "Refine together", copy: "Answer one question. Your words stay locked." },
  { title: "Build and export", copy: "Pick a take, then send the layers to Logic." },
]

const rooms: {
  title: string
  copy: string
  icon: LucideIcon
  soon: boolean
  open: () => void
}[] = [
  { title: "Create", copy: "Shape an idea into layers.", icon: PenLine, soon: !features.create, open: () => go("/create") },
  { title: "Genres", copy: "Explore styles and reference tracks.", icon: Library, soon: !features.genre, open: () => go("/genres") },
  { title: "Analyse", copy: "Hear what a track is doing, then keep the parts you want.", icon: ScanSearch, soon: !features.analyser, open: () => undefined },
  { title: "Tweak", copy: "Reshape a sample without starting the idea over.", icon: SlidersHorizontal, soon: !features.edits, open: () => undefined },
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
        <Button className="home-start" onClick={() => go("/create")}>
          Start creating
        </Button>
      </header>
      <section className="home-hero" aria-label="Intro">
        <PreviewCard title="Drums" side="left" wave="#F07167" />
        <div className="home-hero-copy">
          <Typed />
          <p className="home-sub">Describe what you hear in your head. Get editable layers for Logic.</p>
          <div ref={composerHost} className="home-composer" />
        </div>
        <PreviewCard title="Chords" side="right" wave="#F2C14E" />
      </section>
      <div className="home-below">
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
        <section className="home-room-board" aria-label="Rooms">
          {rooms.map((room) => {
            const Icon = room.icon
            return (
              <article key={room.title} className={`card home-room ${room.soon ? "is-soon" : "is-live"}`}>
                <Icon aria-hidden="true" size={18} />
                <h2 className="section-title">{room.title}</h2>
                <p className="text-secondary">{room.copy}</p>
                <div className="mt-auto flex items-center gap-2">
                  {room.soon ? <span className="soon-tag">Coming soon</span> : null}
                  <Button tone={room.soon ? "secondary" : "primary"} disabled={room.soon} onClick={room.open}>
                    Open
                  </Button>
                </div>
              </article>
            )
          })}
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
