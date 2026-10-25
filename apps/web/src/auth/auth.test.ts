import assert from "node:assert/strict"
import test from "node:test"

import { authHeaders, clerkEnabled, setAuthTokenGetter } from "./token.ts"

test("auth headers stay empty without a token getter", async () => {
  setAuthTokenGetter(null)
  assert.deepEqual(await authHeaders(), {})
})

test("auth headers include a bearer token when signed in", async () => {
  setAuthTokenGetter(async () => "clerk-token")
  assert.deepEqual(await authHeaders(), { Authorization: "Bearer clerk-token" })
  setAuthTokenGetter(null)
})

test("clerk stays off when the publishable key is blank", () => {
  assert.equal(clerkEnabled(), false)
})
