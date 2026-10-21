import type { LayerPrompt } from "../types/layer_prompt.ts"
import { layerTitle } from "../studio/output.ts"

type Props = {
  original: LayerPrompt
  prompt: string
  negative: string
  onPrompt: (value: string) => void
  onNegative: (value: string) => void
  onReset: () => void
  polish?: string | null
  embedded?: boolean
}

export function PromptCard({ original, prompt, negative, onPrompt, onNegative, onReset, polish = null, embedded = false }: Props) {
  const edited = prompt !== original.prompt || negative !== original.negative
  const promptId = `${original.layer}-prompt`
  const negativeId = `${original.layer}-negative`
  return (
    <article className="flex flex-col gap-2 border border-rule p-3">
      <div className="flex items-start justify-between gap-2">
        {embedded ? null : <h3 className="lane-name">{layerTitle(original.layer)}</h3>}
        {edited ? (
          <button
            type="button"
            className="text-sm text-dust underline-offset-4 hover:text-tape-cream hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
            onClick={onReset}
          >
            Reset to original
          </button>
        ) : null}
      </div>
      <label className="text-xs text-dust" htmlFor={promptId}>
        Prompt
      </label>
      <textarea
        id={promptId}
        rows={4}
        value={prompt}
        onChange={(event) => onPrompt(event.target.value)}
        className="w-full resize-y rounded-button border border-rule bg-transparent px-3 py-2 text-lamp outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
      />
      <label className="text-xs text-dust" htmlFor={negativeId}>
        Negative
      </label>
      <textarea
        id={negativeId}
        rows={2}
        value={negative}
        onChange={(event) => onNegative(event.target.value)}
        className="w-full resize-y rounded-button border border-rule bg-transparent px-3 py-2 text-lamp outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
      />
      {polish ? <p className="text-dust">{polish}</p> : null}
      <p className="tabular text-dust">Seeds {original.seeds.join(" · ")}</p>
      {original.kb_sources.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {original.kb_sources.map((source) => (
            <li
              key={source}
              className="inline-flex min-h-9 items-center rounded-chip border border-walnut-line bg-studio-night/80 px-3 py-1 text-sm text-dust"
            >
              {source}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}
