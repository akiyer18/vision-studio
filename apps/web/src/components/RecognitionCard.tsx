import type { AudioFeatures } from "../types/audio_features.ts"
import { describeFeatures } from "../input/describe.ts"
import { Button } from "./Button.tsx"

type Props = {
  features: AudioFeatures
  fixing: boolean
  keyText: string
  tempoText: string
  onKeyText: (value: string) => void
  onTempoText: (value: string) => void
  onFix: () => void
  onConfirm: () => void
  busy: boolean
  ask: boolean
  confirmLabel?: string
}

export function RecognitionCard({
  features,
  fixing,
  keyText,
  tempoText,
  onKeyText,
  onTempoText,
  onFix,
  onConfirm,
  busy,
  ask,
  confirmLabel = "Confirm this reading",
}: Props) {
  const unsure = ask && features.confidence < 0.6
  return (
    <div className="rounded-panel border border-walnut-line bg-studio-night/80 p-3">
      <p className="text-sm text-signal-violet">{describeFeatures(features)}</p>
      {unsure ? (
        <div className="mt-3 flex flex-col gap-3">
          {fixing ? (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-dust" htmlFor="fix-key">
                Key
              </label>
              <input
                id="fix-key"
                value={keyText}
                onChange={(event) => onKeyText(event.target.value)}
                className="rounded-button border border-walnut-line bg-transparent px-3 py-2 text-sm text-tape-cream outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
              />
              <label className="text-xs text-dust" htmlFor="fix-tempo">
                Tempo
              </label>
              <input
                id="fix-tempo"
                inputMode="decimal"
                value={tempoText}
                onChange={(event) => onTempoText(event.target.value)}
                className="rounded-button border border-walnut-line bg-transparent px-3 py-2 text-sm text-tape-cream outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </Button>
            {fixing ? null : (
              <Button tone="secondary" onClick={onFix} disabled={busy}>
                Fix the key or tempo
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
