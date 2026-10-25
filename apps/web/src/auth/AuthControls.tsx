import { AuthBar } from "./AuthBar.tsx"
import { clerkEnabled } from "./token.ts"

/** Sign-in controls. Hidden until a Clerk publishable key is configured. */
export function AuthControls() {
  if (!clerkEnabled()) return null
  return <AuthBar />
}
