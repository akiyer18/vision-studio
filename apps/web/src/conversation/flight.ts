let active = false

export function inFlight(): boolean {
  return active
}

export function claimFlight(): boolean {
  if (active) return false
  active = true
  return true
}

export function releaseFlight(): void {
  active = false
}
