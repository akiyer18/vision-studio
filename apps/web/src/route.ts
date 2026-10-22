import { useSyncExternalStore } from "react"

import { features } from "./features.ts"

export type Page = "home" | "create" | "genre" | "train" | "analyse" | "styleguide"

let page: Page = readPage()
const listeners = new Set<() => void>()

function readPage(): Page {
  const path = window.location.pathname.replace(/\/+$/, "") || "/"
  if (path === "/styleguide") return "styleguide"
  if (path === "/create") return "create"
  if (path === "/analyse") return "analyse"
  if (path === "/genres" && features.genre) return "genre"
  if (path === "/train") return "train"
  return "home"
}

function emit() {
  page = readPage()
  listeners.forEach((listener) => listener())
}

window.addEventListener("popstate", emit)

export function go(path: string) {
  const next = path.startsWith("/") ? path : `/${path}`
  if (window.location.pathname !== next) history.pushState(null, "", next)
  emit()
}

export function usePage(): Page {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => page,
    () => "home",
  )
}
