import { SignedIn, SignedOut, SignInButton, UserButton, useAuth } from "@clerk/react"
import { useEffect } from "react"

import { setAuthTokenGetter } from "./token.ts"

/** Wires Clerk session tokens into the API client and shows sign-in controls. */
export function AuthBar() {
  const { getToken, isSignedIn } = useAuth()

  useEffect(() => {
    setAuthTokenGetter(async () => {
      if (!isSignedIn) return null
      return (await getToken()) ?? null
    })
    return () => setAuthTokenGetter(null)
  }, [getToken, isSignedIn])

  return (
    <div className="auth-bar flex items-center gap-2">
      <SignedOut>
        <SignInButton mode="modal">
          <button type="button" className="quiet-link">
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </div>
  )
}
