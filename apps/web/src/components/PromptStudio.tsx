import { useEffect, useRef } from "react"

import { useStudio } from "../state/studio.ts"

export function PromptStudio() {
  const turn = useStudio((state) => state.turn)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef<typeof turn>(null)

  useEffect(() => {
    if (turn?.status !== "ready" || moved.current === turn) return
    moved.current = turn
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    heading.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" })
    heading.current?.focus()
  }, [turn])

  const prompts = turn?.status === "ready" ? (turn.prompts ?? []) : []

  return (
    <section>
      <h2
        id="prompt-studio"
        ref={heading}
        tabIndex={-1}
        className="font-serif text-xl outline-none focus:outline-2 focus:outline-offset-2 focus:outline-vu-amber"
      >
        Prompt studio
      </h2>
      {prompts.length === 0 ? (
        <p className="mt-2 text-sm text-dust">Prompts land here when the brief is ready.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {prompts.map((prompt) => (
            <li key={prompt.layer}>
              <p className="font-serif text-lg capitalize">{prompt.layer}</p>
              <p className="text-sm text-dust">{prompt.prompt}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
