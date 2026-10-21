import { AudioWaveform, Keyboard, Library, Menu, Music, SlidersHorizontal, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { features } from "../../features.ts"
import { transport } from "../../playback/transport.ts"
import type { RecentIdea } from "../../recentIdeas.ts"
import type { UiStatus } from "../../state/studio.ts"
import { useStudio } from "../../state/studio.ts"
import { RecentList } from "./RecentList.tsx"

const statusLabel: Record<UiStatus, string> = {
  idle: "Waiting",
  working: "Working",
  ready: "Ready",
  error: "Error",
}

const statusTone: Record<UiStatus, string> = {
  idle: "text-muted",
  working: "text-accent",
  ready: "text-success",
  error: "text-danger",
}

type Room = "create" | "genre"

type Props = {
  open: boolean
  room: Room
  onRoom: (room: Room) => void
  onClose: () => void
  onReplay: () => void
}

export function Sidebar({ open, room, onRoom, onClose, onReplay }: Props) {
  const status = useStudio((state) => state.status)
  const restoreSession = useStudio((state) => state.restoreSession)
  const [menu, setMenu] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const helpRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (shortcutsOpen) {
          event.preventDefault()
          setShortcutsOpen(false)
          helpRef.current?.focus()
          return
        }
        if (menu) {
          event.preventDefault()
          setMenu(false)
          helpRef.current?.focus()
        }
        return
      }
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      const typing = target instanceof HTMLElement && target.closest("input, textarea") !== null
      if (typing) return
      event.preventDefault()
      setMenu(false)
      setShortcutsOpen((value) => {
        if (value) helpRef.current?.focus()
        return !value
      })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [menu, shortcutsOpen])

  useEffect(() => {
    if (shortcutsOpen) dialogRef.current?.focus()
  }, [shortcutsOpen])

  function openRecent(entry: RecentIdea) {
    transport.stop()
    restoreSession(entry)
    onClose()
  }

  return (
    <aside className="studio-side glass flex h-full min-h-0 flex-col gap-6 p-4" data-open={open ? "true" : "false"} data-tour="sidebar">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AudioWaveform aria-hidden className="text-accent" size={18} />
          <p className="section-title">Vision Studio</p>
        </div>
        <button type="button" className="studio-menu-close text-secondary min-[768px]:hidden" aria-label="Close the menu" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <nav aria-label="Studio" className="flex flex-col gap-1">
        <RoomButton
          icon={Music}
          label="Create"
          live={features.create}
          current={room === "create"}
          onClick={() => {
            onRoom("create")
            onClose()
            document.getElementById("idea")?.focus()
          }}
        />
        <RoomButton
          icon={Library}
          label="Genre deep dive"
          live={features.genre}
          current={room === "genre"}
          onClick={() => {
            onRoom("genre")
            onClose()
          }}
        />
        <SoonItem icon={AudioWaveform} label="Analyse" soon={!features.analyser} />
        <SoonItem icon={SlidersHorizontal} label="Tweak" soon={!features.edits} />
      </nav>
      <RecentList onOpen={openRecent} />
      <div className="relative flex flex-col gap-3">
        <button
          ref={helpRef}
          type="button"
          aria-expanded={menu}
          aria-haspopup="menu"
          className="inline-flex items-center gap-2 text-left text-secondary"
          onClick={() => setMenu((value) => !value)}
        >
          <Menu size={16} aria-hidden />
          Help
        </button>
        {menu ? (
          <div role="menu" className="absolute bottom-16 left-0 z-30 flex w-44 flex-col rounded-2xl border border-white/15 bg-canvas p-2">
            <button
              type="button"
              role="menuitem"
              className="rounded-xl px-2 py-2 text-left text-ink"
              onClick={() => {
                setMenu(false)
                onReplay()
              }}
            >
              Replay tour
            </button>
            <button
              type="button"
              role="menuitem"
              className="rounded-xl px-2 py-2 text-left text-ink"
              onClick={() => {
                setMenu(false)
                setShortcutsOpen(true)
              }}
            >
              Shortcuts
            </button>
            {features.styleguideLink ? (
              <a role="menuitem" href="/styleguide" className="rounded-xl px-2 py-2 text-ink">
                Styleguide
              </a>
            ) : null}
          </div>
        ) : null}
        {shortcutsOpen ? (
          <div
            id="shortcut-help"
            ref={dialogRef}
            role="dialog"
            aria-label="Keyboard shortcuts"
            tabIndex={-1}
            className="absolute bottom-16 left-0 z-30 w-64 rounded-2xl border border-white/15 bg-canvas p-3 text-ink outline-none"
          >
            <ul className="flex flex-col gap-2 text-sm">
              <Shortcut keys="Enter" action="Send" />
              <Shortcut keys="S" action={features.soloMute ? "Skip this question, or solo the focused lane" : "Skip this question"} />
              <Shortcut keys="Shift S" action="Skip all and build" />
              {features.soloMute ? <Shortcut keys="M" action="Mute the focused lane" /> : null}
              <Shortcut keys="Space" action="Play and stop" />
              <Shortcut keys="?" action="Open or close these shortcuts" />
            </ul>
            <button type="button" className="mt-3 text-sm text-secondary" onClick={() => setShortcutsOpen(false)}>
              Close
            </button>
          </div>
        ) : null}
        <p className={`inline-flex w-fit items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-sm ${statusTone[status]}`}>
          <Keyboard size={14} aria-hidden />
          {statusLabel[status]}
        </p>
      </div>
    </aside>
  )
}

function RoomButton({
  icon: Icon,
  label,
  live,
  current,
  onClick,
}: {
  icon: typeof Music
  label: string
  live: boolean
  current: boolean
  onClick: () => void
}) {
  if (!live) return <SoonItem icon={Icon} label={label} soon />
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      className={`flex h-10 items-center gap-2 rounded-xl px-2 text-left ${current ? "bg-white/8 text-ink" : "text-secondary"}`}
      onClick={onClick}
    >
      <Icon size={18} aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  )
}

function SoonItem({ icon: Icon, label, soon }: { icon: typeof Music; label: string; soon: boolean }) {
  if (!soon) {
    return (
      <button type="button" className="flex h-10 items-center gap-2 rounded-xl px-2 text-left text-secondary">
        <Icon size={18} aria-hidden />
        {label}
      </button>
    )
  }
  return (
    <div className="flex h-10 items-center gap-2 rounded-xl px-2 text-muted" aria-disabled="true">
      <Icon size={18} aria-hidden />
      <span className="truncate">{label}</span>
      <span className="ml-auto rounded-full border border-white/10 px-1.5 py-px text-[11px] leading-none text-muted">Soon</span>
    </div>
  )
}

function Shortcut({ keys, action }: { keys: string; action: string }) {
  return (
    <li>
      <kbd className="mr-2 inline-block rounded-md border border-white/15 px-1.5 py-0.5 text-muted">{keys}</kbd>
      {action}
    </li>
  )
}
