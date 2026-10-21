import { useEffect, useRef, useState } from "react"

import { features } from "../features.ts"

const shortcuts = [
  ["Enter", "Send the written answer"],
  ["S", features.soloMute ? "Skip this question, or solo the focused lane" : "Skip this question"],
  ["Shift S", "Skip all and build"],
  ...(features.soloMute ? [["M", "Mute the focused lane"]] : []),
  ["Space", "Play or stop"],
  ["?", "Open or close these shortcuts"],
]

export function HelpMenu({ onReplay }: { onReplay: () => void }) {
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

  return (
    <div className="relative">
      <button
        ref={helpRef}
        type="button"
        aria-expanded={menu}
        aria-haspopup="menu"
        className="text-dust underline-offset-4 hover:text-lamp hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
        onClick={() => setMenu((value) => !value)}
      >
        Help
      </button>
      {menu ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 flex w-48 flex-col border border-rule bg-desk p-2"
        >
          <button
            type="button"
            role="menuitem"
            className="px-2 py-2 text-left text-lamp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
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
            className="px-2 py-2 text-left text-lamp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
            onClick={() => {
              setMenu(false)
              setShortcutsOpen(true)
            }}
          >
            Shortcuts
          </button>
          {features.styleguideLink ? (
            <a
              role="menuitem"
              href="/styleguide"
              className="px-2 py-2 text-lamp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
            >
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
          className="absolute right-0 z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] border border-rule bg-desk p-3 text-lamp outline-none"
        >
          <ul className="flex flex-col gap-2">
            {shortcuts.map(([key, action]) => (
              <li key={key}>
                <kbd className="mr-2 inline-block border border-rule px-1.5 py-0.5 text-dust">{key}</kbd>
                {action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
