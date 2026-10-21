import type { AudioFeatures } from "../types/audio_features.ts"
import type { InputType } from "../types/input_type.ts"

const LIMIT = 50 * 1024 * 1024
const AUDIO = new Set(["wav", "mp3", "m4a", "webm"])
const MIDI = new Set(["mid", "midi"])

export const FILE_LIMIT = LIMIT

export function describeFeatures(features: AudioFeatures): string {
  const parts = [heardPhrase(features)]
  if (typeof features.bpm === "number" && Number.isFinite(features.bpm) && features.bpm > 0) {
    parts.push(`about ${Math.round(features.bpm)} BPM`)
  }
  const key = keyPhrase(features)
  if (key) parts.push(`probably ${key}`)
  if (parts.length === 1) return `${parts[0]}.`
  return `${parts[0]}, ${parts.slice(1).join(", ")}.`
}

export function keyPhrase(features: AudioFeatures): string {
  if (!features.key) return ""
  const key = features.key.trim()
  const mode = features.mode?.toLowerCase()
  if ((mode === "major" || mode === "minor") && !key.toLowerCase().includes(mode)) {
    return `${key} ${mode}`
  }
  return key
}

export function applyCorrection(features: AudioFeatures, keyText: string, tempoText: string): AudioFeatures {
  const next: AudioFeatures = { ...features }
  const trimmed = keyText.trim()
  const match = trimmed.match(/^(.*?)\s+(major|minor)$/i)
  if (match) {
    next.key = match[1].trim()
    next.mode = match[2].toLowerCase()
  } else if (trimmed) {
    next.key = trimmed
    next.mode = undefined
  }
  const tempo = Number(tempoText)
  if (Number.isFinite(tempo) && tempo > 0) next.bpm = tempo
  return next
}

export function fileKind(file: File): "audio" | "midi" | "other" {
  const extension = fileExtension(file)
  if (MIDI.has(extension)) return "midi"
  if (AUDIO.has(extension)) return "audio"
  return "other"
}

export function fileExtension(file: File): string {
  const named = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : ""
  if (named) return named
  const type = file.type.toLowerCase()
  if (type.includes("webm")) return "webm"
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3"
  if (type.includes("mp4") || type.includes("m4a")) return "m4a"
  if (type.includes("wav")) return "wav"
  if (type.includes("midi")) return "midi"
  return ""
}

export function fileProblem(file: File): string | null {
  if (fileKind(file) !== "audio") return "Use a wav, mp3, m4a, or webm file."
  if (file.size > LIMIT) return "That file is over 50 MB. Use a shorter recording."
  return null
}

export function inputTypeFor(kind: "audio" | "midi", source: "drop" | "recording"): InputType {
  if (kind === "midi") return "midi"
  if (source === "recording") return "hum"
  return "full_track"
}

function heardPhrase(features: AudioFeatures): string {
  const instruments = (features.instruments ?? []).map((name) => name.trim()).filter(Boolean)
  if (instruments.length > 0) {
    const list = instruments.join(" and ")
    if (features.input_type === "instrument_loop" || features.input_type === "drum_loop") {
      return `I hear a ${list} loop`
    }
    return `I hear ${list}`
  }
  switch (features.input_type) {
    case "hum":
      return "I hear a hum"
    case "vocal":
      return "I hear a vocal"
    case "instrument_loop":
      return "I hear an instrument loop"
    case "drum_loop":
      return "I hear a drum loop"
    case "midi":
      return "I hear a MIDI file"
    case "full_track":
      return "I hear a full track"
    default:
      return "I hear a recording"
  }
}
