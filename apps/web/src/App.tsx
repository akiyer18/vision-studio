import { Shell } from "./components/Shell.tsx"
import { Styleguide } from "./components/Styleguide.tsx"
import { usePage } from "./route.ts"

export default function App() {
  const page = usePage()
  return page === "styleguide" ? <Styleguide /> : <Shell />
}
