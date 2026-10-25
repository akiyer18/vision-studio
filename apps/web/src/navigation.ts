export type StudioRoom = "home" | "train" | "create" | "analyse"

export type NavFlags = {
  analyser: boolean
  genre: boolean
  edits: boolean
  create: boolean
}

export type NavItem = {
  room: StudioRoom
  label: string
  path: string
  flag?: "analyser"
}

export const studioNav: NavItem[] = [
  { room: "home", label: "Home", path: "/" },
  { room: "train", label: "Train", path: "/train" },
  { room: "create", label: "Create", path: "/create" },
  { room: "analyse", label: "Analyse", path: "/analyse", flag: "analyser" },
]

export function visibleRooms(flags: NavFlags): NavItem[] {
  return studioNav.filter((item) => item.flag !== "analyser" || flags.analyser)
}

export function showBuildTip(page: string): boolean {
  return page === "create"
}
