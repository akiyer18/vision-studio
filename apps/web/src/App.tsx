import { Shell } from "./components/Shell.tsx"
import { Styleguide } from "./components/Styleguide.tsx"

export default function App() {
  const route = window.location.pathname.replace(/\/+$/, "") || "/"
  return route === "/styleguide" ? <Styleguide /> : <Shell />
}
