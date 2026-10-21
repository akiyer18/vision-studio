import { useEffect, useRef, type RefObject } from "react"
import WaveSurfer from "wavesurfer.js"

export function Waveform({
  url,
  label,
  seek,
  wave = "#A78BFA",
  progress = "#8B5CF6",
  height = 64,
}: {
  url: string
  label: string
  seek: RefObject<((seconds: number) => void) | null>
  wave?: string | string[]
  progress?: string
  height?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const colors = Array.isArray(wave) ? wave.join("|") : wave

  useEffect(() => {
    const element = container.current
    if (!element) return
    const waveform = WaveSurfer.create({
      container: element,
      height,
      waveColor: colors.includes("|") ? colors.split("|") : colors,
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
  }, [colors, height, progress, seek, url])

  return <div ref={container} role="img" aria-label={label} className="min-w-0 flex-1 overflow-hidden" style={{ minHeight: height }} />
}
