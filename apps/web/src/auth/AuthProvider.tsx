import { ClerkProvider } from "@clerk/react"
import type { ReactNode } from "react"

import { clerkEnabled, clerkPublishableKey } from "./token.ts"

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!clerkEnabled()) {
    return children
  }
  return <ClerkProvider publishableKey={clerkPublishableKey()}>{children}</ClerkProvider>
}
