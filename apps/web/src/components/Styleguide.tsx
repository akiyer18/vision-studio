import type { SlotSource } from "../types/slot_source.ts"
import type { UiStatus } from "../state/studio.ts"
import { Button } from "./Button.tsx"
import { ChannelStrip } from "./ChannelStrip.tsx"
import { Chip } from "./Chip.tsx"
import { GlassPanel } from "./GlassPanel.tsx"
import { MonoLine } from "./MonoLine.tsx"
import { SessionMark } from "./SessionMark.tsx"
import { Skeleton } from "./Skeleton.tsx"
import { SourceBadge } from "./SourceBadge.tsx"
import { Toast } from "./Toast.tsx"
import { VuMeter } from "./VuMeter.tsx"

const sources: SlotSource[] = ["you", "detected", "guessed", "reference"]
const statuses: UiStatus[] = ["idle", "working", "ready", "error"]

export function Styleguide() {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-6 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl">Styleguide</h1>
          <p className="mt-2 text-dust">Every component, on the desk.</p>
        </div>
        <a
          href="/"
          className="text-sm text-dust underline-offset-4 hover:text-tape-cream hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
        >
          Studio
        </a>
      </header>

      <GlassPanel>
        <h2 className="text-2xl">Panel</h2>
        <p className="mt-2 max-w-prose text-dust">A quiet panel on Desk. Text sits on the panel.</p>
      </GlassPanel>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Buttons</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Build</Button>
          <Button tone="secondary">Another take</Button>
          <Button tone="ghost">Export to Logic</Button>
          <Button disabled>Build</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Source badges</h2>
        <div className="flex flex-wrap gap-2">
          {sources.map((source) => (
            <SourceBadge key={source} source={source} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Chips</h2>
        <div className="flex flex-wrap gap-2">
          <Chip>Drums</Chip>
          <Chip selected>Chords</Chip>
          <Chip disabled>Full song</Chip>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">VU meters</h2>
        <div className="flex items-end gap-6">
          <VuMeter value={0} label="Empty confidence" />
          <VuMeter value={0.4} label="Partial confidence" />
          <VuMeter value={1} label="Full confidence" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Channel strips</h2>
        <p className="text-sm text-dust">Hover a strip to read its reason. Click the value to edit it.</p>
        <div className="flex flex-wrap gap-4 pb-16">
          <ChannelStrip
            label="Mood"
            value="Longing"
            source="guessed"
            confidence={0.4}
            reason="Mood with no signal defaults to peaceful."
          />
          <ChannelStrip
            label="Key"
            value="D minor"
            source="detected"
            confidence={0.9}
            reason="Detected from the audio."
          />
          <ChannelStrip label="Palette" value="" source="you" confidence={0} reason="You have not named an instrument yet." />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Trace</h2>
        <GlassPanel>
          <MonoLine>theory: i VI III VII in D minor is Dm, Bb, F, C</MonoLine>
        </GlassPanel>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Toasts</h2>
        <div className="flex flex-col gap-3">
          <Toast>The take is ready.</Toast>
          <Toast tone="error">The render did not finish.</Toast>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Skeletons</h2>
        <div className="flex max-w-sm flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-16 w-24" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Session indicator</h2>
        <div className="flex flex-wrap gap-6">
          {statuses.map((status) => (
            <SessionMark key={status} sessionId="phase3demo" status={status} />
          ))}
        </div>
      </section>
    </div>
  )
}
