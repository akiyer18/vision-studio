import { useEffect, useRef, type RefObject } from "react"
import WaveSurfer from "wavesurfer.js"

export function Waveform({
  url,
  label,
  seek,
  wave = "rgba(246, 241, 232, 0.55)",
  progress = "#F6F1E8",
}: {
  url: string
  label: string
  seek: RefObject<((seconds: number) => void) | null>
  wave?: string
  progress?: string
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const waveform = WaveSurfer.create({
      container: element,
      height: 64,
      waveColor: wave,
      progressColor: progress,
      cursorColor: progress,
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
  }, [progress, seek, url, wave])

  return <div ref={container} role="img" aria-label={label} className="min-h-16 w-full min-w-0 overflow-hidden" />
}
