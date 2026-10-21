const KEY = "vision-studio-recent"

export function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 6)
  } catch {
    return []
  }
}

export function rememberIdea(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  const next = [trimmed, ...readRecent().filter((item) => item !== trimmed)].slice(0, 6)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* Recent ideas stay in memory for this page when storage is blocked. */
  }
  window.dispatchEvent(new Event("vision-studio-recent"))
}
