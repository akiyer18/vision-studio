import { useEffect, useState } from "react"
import { AudioWaveform } from "lucide-react"

import { deleteRecent, readRecent, relativeDate, renameRecent, type RecentIdea } from "../../recentIdeas.ts"
import { useStudio } from "../../state/studio.ts"

type Props = {
  onOpen: (entry: RecentIdea) => void
}

export function RecentList({ onOpen }: Props) {
  const active = useStudio((state) => state.sessionId)
  const [ideas, setIdeas] = useState(readRecent)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  useEffect(() => {
    function sync() {
      setIdeas(readRecent())
    }
    window.addEventListener("vision-studio-recent", sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener("vision-studio-recent", sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  function startRename(entry: RecentIdea) {
    setRenaming(entry.id)
    setDraft(entry.title)
  }

  function commitRename(id: string) {
    renameRecent(id, draft)
    setRenaming(null)
  }

  return (
    <div className="recent-list min-h-0 flex-1 overflow-auto">
      <p className="side-label text-sm text-secondary">Recent ideas</p>
      {ideas.length === 0 ? (
        <p className="mt-2 text-sm text-secondary">Recent ideas land here.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {ideas.map((idea) => (
            <li key={idea.id} className="group relative">
              {renaming === idea.id ? (
                <input
                  aria-label={`Rename ${idea.title}`}
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={(event) => {
                    if (event.currentTarget.dataset.cancel === "true") return
                    commitRename(idea.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur()
                    if (event.key === "Escape") {
                      event.currentTarget.dataset.cancel = "true"
                      setRenaming(null)
                    }
                  }}
                  className="w-full rounded-[6px] border border-[var(--line)] bg-transparent px-2 py-1 text-[13px] text-ink outline-none"
                />
              ) : (
                <button
                  type="button"
                  title={idea.title}
                  aria-current={idea.sessionId === active ? "true" : undefined}
                  className="recent-row pr-8 text-sm hover:text-ink"
                  onClick={() => onOpen(idea)}
                >
                  <AudioWaveform aria-hidden="true" size={14} />
                  <span className="recent-copy min-w-0 flex-1 truncate">{idea.title}</span>
                  <span className="recent-copy shrink-0 text-secondary">{relativeDate(idea.date)}</span>
                </button>
              )}
              {renaming === idea.id ? null : (
                <div role="menu" aria-label={`Options for ${idea.title}`} className="absolute top-1 right-1 z-10 hidden items-center gap-1 rounded-[6px] border border-[var(--line)] bg-panel px-1 group-hover:flex group-focus-within:flex">
                  <button type="button" role="menuitem" className="px-1 py-0.5 text-sm text-secondary" onClick={() => startRename(idea)}>
                    Rename
                  </button>
                  <button type="button" role="menuitem" className="px-1 py-0.5 text-sm text-secondary" onClick={() => deleteRecent(idea.id)}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
