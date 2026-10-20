import { Shell } from "./components/Shell.tsx"
import { StudioGlow } from "./components/StudioGlow.tsx"
import { Styleguide } from "./components/Styleguide.tsx"

export default function App() {
  const route = window.location.pathname.replace(/\/+$/, "") || "/"
  return (
    <>
      <StudioGlow />
      <div className="relative z-10">{route === "/styleguide" ? <Styleguide /> : <Shell />}</div>
    </>
  )
}
