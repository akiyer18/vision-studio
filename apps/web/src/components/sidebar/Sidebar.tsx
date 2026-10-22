import { useEffect, useRef, useState, type ReactNode } from "react"
import { CircleHelp, GraduationCap, House, PenLine, ScanSearch } from "lucide-react"

import { Logo } from "../Logo.tsx"

import { features } from "../../features.ts"
import { chooseLevel, levelCopy, useLevel } from "../../level.ts"
import { go } from "../../route.ts"
import { transport } from "../../playback/transport.ts"
import type { RecentIdea } from "../../recentIdeas.ts"
import { useStudio } from "../../state/studio.ts"
import { RecentList } from "./RecentList.tsx"

type Room = "home" | "create" | "train" | "analyse"

type Props = {
  page: Room
  onReplay: () => void
}

export function Sidebar({ page, onReplay }: Props) {
  const restoreSession = useStudio((state) => state.restoreSession)
  const level = useLevel()
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
    go("/create")
  }

  return (
    <aside className="studio-side" data-tour="sidebar">
      <button type="button" className="wordmark flex items-center gap-2" data-tour="welcome" aria-label="Vision Studio home" onClick={() => go("/")}>
        <Logo />
        <span className="wordmark-copy">Vision Studio</span>
      </button>
      <nav aria-label="Studio" className="side-nav flex flex-col gap-1">
        <RoomButton
          icon={<House aria-hidden="true" size={16} />}
          label="Home"
          live
          current={page === "home"}
          onClick={() => go("/")}
        />
        <RoomButton
          icon={<GraduationCap aria-hidden="true" size={16} />}
          label="Train"
          live
          current={page === "train"}
          onClick={() => go("/train")}
        />
        <RoomButton
          icon={<PenLine aria-hidden="true" size={16} />}
          label="Create"
          live={features.create}
          current={page === "create"}
          onClick={() => {
            go("/create")
            document.getElementById("idea")?.focus()
          }}
        />
        {features.analyser ? (
          <RoomButton
            icon={<ScanSearch aria-hidden="true" size={16} />}
            label="Analyse"
            live
            current={page === "analyse"}
            onClick={() => go("/analyse")}
          />
        ) : null}
      </nav>
      <RecentList onOpen={openRecent} />
      <div className="relative mt-auto flex flex-col gap-3">
        {page === "create" ? <p className="tip-card">Press Build now at any time, your details stay exactly as you said them</p> : null}
        <p className="side-level">{level ? `Level: ${levelCopy[level].title}` : "Choose a level"}</p>
        <button
          ref={helpRef}
          type="button"
          title="Help"
          aria-expanded={menu}
          aria-haspopup="menu"
          className="flex items-center gap-2 text-left text-secondary"
          onClick={() => setMenu((value) => !value)}
        >
          <CircleHelp aria-hidden="true" size={16} />
          <span className="side-label">Help</span>
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
            <button
              type="button"
              role="menuitem"
              className="rounded-xl px-2 py-2 text-left text-ink"
              onClick={() => {
                setMenu(false)
                chooseLevel()
                go("/train")
              }}
            >
              Change level
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
            <button type="button" className="mt-3 text-xs text-secondary" onClick={() => setShortcutsOpen(false)}>
              Close
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function RoomButton({
  icon,
  label,
  live,
  current,
  onClick,
}: {
  icon: ReactNode
  label: string
  live: boolean
  current: boolean
  onClick: () => void
}) {
  if (!live) return <SoonItem icon={icon} label={label} soon />
  return (
    <button type="button" title={label} aria-current={current ? "page" : undefined} onClick={onClick}>
      {icon}
      <span className="side-label truncate">{label}</span>
    </button>
  )
}

function SoonItem({ icon, label, soon }: { icon: ReactNode; label: string; soon: boolean }) {
  if (!soon) {
    return (
      <button type="button" title={label}>
        {icon}
        <span className="side-label truncate">{label}</span>
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-secondary" title={`${label}, soon`} aria-disabled="true">
      {icon}
      <span className="side-label truncate">{label}</span>
      <span className="side-copy ml-auto rounded-full border border-[var(--line)] px-2 py-0.5 text-xs">Soon</span>
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
