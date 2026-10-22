import type { SlotSource } from "../types/slot_source.ts"
import { Button } from "./Button.tsx"
import { Chip } from "./Chip.tsx"
import { SourceBadge } from "./SourceBadge.tsx"

const sources: SlotSource[] = ["you", "detected", "guessed", "reference"]
const swatches = [
  ["Background", "#0A0A12"],
  ["Panel", "#12121C"],
  ["Raised", "#1A1A27"],
  ["Ink", "#EEEDF7"],
  ["Secondary", "#B4B1CC"],
  ["Muted", "#B4B1CC"],
  ["Violet", "#8B5CF6"],
  ["Light violet", "#A78BFA"],
  ["Cyan", "#5EEAD4"],
  ["Drums", "#F07167"],
  ["Chords", "#F2C14E"],
  ["Bass", "#4FD1A5"],
  ["Melody", "#7AA2FF"],
  ["Texture", "#C084FC"],
]

export function Styleguide() {
  return (
    <div className="studio-root min-h-svh">
      <div className="relative z-1 mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Styleguide</h1>
            <p className="mt-2 text-secondary">Tokens, buttons, pads, and source tags.</p>
          </div>
          <a href="/" className="text-secondary underline-offset-4 hover:underline">
            Studio
          </a>
        </header>
        <section className="panel p-4">
          <h2>Panel</h2>
          <p className="mt-2 text-secondary">Flat panels for the rails, the brief, and the tour.</p>
        </section>
        <section className="flex flex-col gap-3">
          <h2>Buttons</h2>
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
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
            <div key={name} className="rounded-[10px] border border-[var(--line)] p-3">
              <div className="h-10 rounded-[6px]" style={{ background: hex }} />
              <p className="mt-2">{name}</p>
              <p className="text-sm text-muted">{hex}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
