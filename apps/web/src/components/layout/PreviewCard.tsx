import { lazy, Suspense, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"

const Waveform = lazy(() => import("../Waveform.tsx").then((module) => ({ default: module.Waveform })))

const DEMO = "/fixtures/detected-loop.wav"

type Props = {
  title: string
  side: "left" | "right"
  wave: string
}

export function PreviewCard({ title, side, wave }: Props) {
  const audio = useRef<HTMLAudioElement>(null)
  const seek = useRef<((seconds: number) => void) | null>(null)
  const [playing, setPlaying] = useState(false)

  function toggle() {
    const node = audio.current
    if (!node) return
    if (!node.paused) {
      node.pause()
      setPlaying(false)
      return
    }
    void node.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    )
  }

  return (
    <article className={`preview-card is-${side}`}>
      <p className="section-title">{title}</p>
      <Suspense fallback={<div className="preview-wave" aria-hidden="true" />}>
        <Waveform url={DEMO} label={`${title} demo waveform`} seek={seek} wave={wave} progress={wave} height={48} />
      </Suspense>
      <audio
        ref={audio}
        src={DEMO}
        preload="none"
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
      />
      <button type="button" className="preview-play" aria-label={playing ? `Stop the ${title} demo` : `Play the ${title} demo`} onClick={toggle}>
        {playing ? <Pause aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={14} />}
      </button>
    </article>
  )
}
