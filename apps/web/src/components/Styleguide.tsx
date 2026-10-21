import type { SlotSource } from "../types/slot_source.ts"
import { Button } from "./Button.tsx"
import { Chip } from "./Chip.tsx"
import { SourceBadge } from "./SourceBadge.tsx"

const sources: SlotSource[] = ["you", "detected", "guessed", "reference"]
const swatches = [
  ["Background", "#0B0A1A"],
  ["Ink", "#F4F2FF"],
  ["Secondary", "#B8B3D9"],
  ["Muted", "#8A84B3"],
  ["Accent", "#8B6CFF"],
  ["Success", "#4FD1C5"],
  ["Warning", "#F5B971"],
  ["Error", "#FF8A8A"],
  ["Drums", "#FF6B57"],
  ["Chords", "#F5C451"],
  ["Bass", "#3FD0A8"],
  ["Melody", "#6C8CFF"],
  ["Texture", "#B07CFF"],
]

export function Styleguide() {
  return (
    <div className="studio-root min-h-svh">
      <div className="relative z-1 mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <h1 className="greeting">Styleguide</h1>
            <p className="mt-2 text-secondary">Tokens, buttons, chips, and source badges.</p>
          </div>
          <a href="/" className="text-secondary underline-offset-4 hover:underline">
            Studio
          </a>
        </header>
        <section className="glass p-4">
          <h2>Glass</h2>
          <p className="mt-2 text-secondary">One glass surface, used for the sidebar, the composer, and the three rail cards.</p>
        </section>
        <section className="flex flex-col gap-3">
          <h2>Buttons</h2>
          <div className="flex flex-wrap gap-3">
            <Button>Build</Button>
            <Button tone="secondary">Skip this</Button>
            <Button tone="ghost">You decide</Button>
          </div>
        </section>
        <section className="flex flex-col gap-3">
          <h2>Chips</h2>
          <div className="flex flex-wrap gap-2">
            <Chip selected>All layers</Chip>
            <Chip>Drums</Chip>
            <Chip>Full mix</Chip>
          </div>
        </section>
        <section className="flex flex-col gap-3">
          <h2>Sources</h2>
          <div className="flex flex-wrap gap-2">
            {sources.map((source) => (
              <SourceBadge key={source} source={source} />
            ))}
          </div>
        </section>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {swatches.map(([name, hex]) => (
            <div key={name} className="rounded-2xl border border-white/15 p-3">
              <div className="h-10 rounded-xl" style={{ background: hex }} />
              <p className="mt-2">{name}</p>
              <p className="text-sm text-muted">{hex}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
