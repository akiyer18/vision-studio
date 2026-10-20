export function StudioGlow() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="drift absolute -top-16 -left-16 h-80 w-80 rounded-full bg-vu-amber/15 blur-3xl" />
      <div className="drift absolute top-1/3 -right-20 h-96 w-96 rounded-full bg-signal-violet/15 blur-3xl [animation-duration:44s]" />
      <div className="drift absolute -bottom-20 left-1/3 h-72 w-72 rounded-full bg-vu-amber/10 blur-3xl [animation-duration:52s]" />
    </div>
  )
}
