import { useEffect, useRef, type RefObject } from "react"
import WaveSurfer from "wavesurfer.js"

export function Waveform({
  url,
  label,
  seek,
  wave = "#FF9A5C",
  progress = "#FF6A2B",
  height = 64,
}: {
  url: string
  label: string
  seek: RefObject<((seconds: number) => void) | null>
  wave?: string
  progress?: string
  height?: number
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const waveform = WaveSurfer.create({
      container: element,
      height,
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
  }, [height, progress, seek, url, wave])

  return <div ref={container} role="img" aria-label={label} className="min-w-0 flex-1 overflow-hidden" style={{ minHeight: height }} />
}
