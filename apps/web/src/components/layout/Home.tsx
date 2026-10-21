import { Library, PenLine, ScanSearch, SlidersHorizontal, type LucideIcon } from "lucide-react"

import { runDemoFromHome } from "../../composer/examples.ts"
import { features } from "../../features.ts"
import { go } from "../../route.ts"
import { Button } from "../Button.tsx"
import { PageHeader } from "./PageHeader.tsx"

const rooms: {
  title: string
  copy: string
  icon: LucideIcon
  soon: boolean
  open: () => void
}[] = [
  {
    title: "Create",
    copy: "Shape an idea into layers.",
    icon: PenLine,
    soon: !features.create,
    open: () => go("/create"),
  },
  {
    title: "Genres",
    copy: "Explore styles and reference tracks.",
    icon: Library,
    soon: !features.genre,
    open: () => go("/genres"),
  },
  {
    title: "Analyse",
    copy: "Hear what a track is doing, then keep the parts you want.",
    icon: ScanSearch,
    soon: !features.analyser,
    open: () => undefined,
  },
  {
    title: "Tweak",
    copy: "Reshape a sample without starting the idea over.",
    icon: SlidersHorizontal,
    soon: !features.edits,
    open: () => undefined,
  },
]

const steps = [
  { title: "Describe", copy: "Say it, play it, or drop a file." },
  { title: "Refine together", copy: "Answer a few questions. Your words stay locked." },
  { title: "Build and export", copy: "Pick a take, then send the layers to Logic." },
]

export function Home() {
  return (
    <div className="home-page">
      <PageHeader
        eyebrow="Home"
        title="Vision Studio. Describe what you hear in your head, and get editable layers for your track."
        subtitle="Made for producers and Logic users."
      >
        <Button onClick={() => go("/create")}>Start creating</Button>
        {features.demo ? (
          <Button tone="secondary" onClick={() => runDemoFromHome()}>
            Try the demo
          </Button>
        ) : null}
      </PageHeader>
      <section className="home-rooms" aria-label="Rooms">
        {rooms.map((room) => {
          const Icon = room.icon
          return (
            <article key={room.title} className="card home-room">
              <Icon aria-hidden="true" size={16} />
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
      <section className="home-steps" aria-label="How it works">
        <h2 className="section-title">How it works</h2>
        <ol>
          {steps.map((step, index) => (
            <li key={step.title} className="card">
              <p className="eyebrow">{index + 1}</p>
              <h3 className="section-title">{step.title}</h3>
              <p className="text-secondary">{step.copy}</p>
            </li>
          ))}
        </ol>
      </section>
      <footer className="home-footer">Audio by Stable Audio 3. Questions and briefs by AWS Bedrock.</footer>
    </div>
  )
}
