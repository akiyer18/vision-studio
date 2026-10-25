/** Optional bearer token for API calls. Clerk sets this when configured. */

type TokenGetter = () => Promise<string | null>

let getter: TokenGetter | null = null

export function setAuthTokenGetter(next: TokenGetter | null): void {
  getter = next
}

export async function authHeaders(): Promise<Record<string, string>> {
  if (!getter) return {}
  const token = await getter()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

export function clerkPublishableKey(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  const key = env?.VITE_CLERK_PUBLISHABLE_KEY
  return typeof key === "string" ? key.trim() : ""
}

export function clerkEnabled(): boolean {
  return clerkPublishableKey().length > 0
}
