import { useEffect, useRef, useState } from "react"

const shortcuts = [
  ["Enter", "Send the written answer"],
  ["S", "Skip this question"],
  ["Shift S", "Skip all and build"],
  ["?", "Open or close these shortcuts"],
]

export function ShortcutHelp() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
        event.preventDefault()
        setOpen(false)
        buttonRef.current?.focus()
        return
      }
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      const typing = target instanceof HTMLElement && target.closest("input, textarea") !== null
      if (typing) return
      event.preventDefault()
      setOpen((value) => {
        if (value) buttonRef.current?.focus()
        return !value
      })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="shortcut-help"
        className="text-sm text-dust underline-offset-4 hover:text-tape-cream hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
        onClick={() => setOpen((value) => !value)}
      >
        Shortcuts
      </button>
      {open ? (
        <div
          id="shortcut-help"
          ref={dialogRef}
          role="dialog"
          aria-label="Keyboard shortcuts"
          tabIndex={-1}
          data-shortcuts-open="true"
          className="absolute right-0 z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-panel border border-walnut-line bg-studio-night p-3 text-sm text-tape-cream outline-none"
        >
          <ul className="flex flex-col gap-2">
            {shortcuts.map(([key, action]) => (
              <li key={key}>
                <kbd className="mr-2 inline-block rounded-chip border border-walnut-line px-1.5 py-0.5 text-dust">{key}</kbd>
                {action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
