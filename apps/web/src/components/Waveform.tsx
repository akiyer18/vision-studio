import { useEffect, useRef, type RefObject } from "react"
import WaveSurfer from "wavesurfer.js"

export function Waveform({
  url,
  label,
  seek,
}: {
  url: string
  label: string
  seek: RefObject<((seconds: number) => void) | null>
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const waveform = WaveSurfer.create({
      container: element,
      height: 64,
      waveColor: "rgba(242, 165, 65, 0.45)",
      progressColor: "#F2A541",
      cursorColor: "#F2E9DC",
      cursorWidth: 1,
      interact: false,
      dragToSeek: false,
      hideScrollbar: true,
      autoScroll: false,
      autoCenter: false,
      normalize: true,
      url,
    })
    waveform.setMuted(true)
    waveform.on("ready", () => {
      seek.current = (seconds) => {
        const duration = waveform.getDuration()
        waveform.setTime(duration > 0 ? Math.min(seconds, duration) : 0)
      }
    })
    return () => {
      seek.current = null
      waveform.destroy()
    }
  }, [seek, url])

  return <div ref={container} role="img" aria-label={label} className="min-h-16 w-full min-w-0 overflow-hidden" />
}
