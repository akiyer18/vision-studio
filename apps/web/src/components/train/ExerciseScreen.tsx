import { useEffect, useRef, useState } from "react"
import {
  ApiError,
  revealExercise,
  submitExercise,
  trainFileUrl,
  type TrainExercise,
  type TrainFeedback,
  type TrainPattern,
  type TrainResult,
} from "../../api/client.ts"
import { levelCopy } from "../../level.ts"
import { recordCompletion } from "../../trainProgress.ts"
import { Button } from "../Button.tsx"
import { PageHeader } from "../layout/PageHeader.tsx"
import { MappingDialog } from "./MappingDialog.tsx"

type Props = {
  exercise: TrainExercise
  onBack: () => void
  onExercise: (exercise: TrainExercise) => void
  onResult: (result: TrainResult, feedback: TrainFeedback) => void
}

export function ExerciseScreen({ exercise, onBack, onExercise, onResult }: Props) {
  const [countIn, setCountIn] = useState(false)
  const [loop, setLoop] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [revealed, setRevealed] = useState(Boolean(exercise.midi))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [unknown, setUnknown] = useState<number[] | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const arming = useRef(false)
  const level = levelCopy[exercise.level]

  async function togglePlay() {
    const audio = audioRef.current
    if (!audio || arming.current) return
    if (!audio.paused) {
      audio.pause()
      audio.currentTime = 0
      setPlaying(false)
      return
    }
    arming.current = true
    try {
      if (countIn) await countClicks(exercise.tempo, 4)
      audio.loop = loop
      await audio.play()
      setPlaying(true)
    } catch {
      setError("The reference did not play. Try again.")
    } finally {
      arming.current = false
    }
  }

  async function reveal() {
    setBusy(true)
    setError("")
    try {
      onExercise(await revealExercise(exercise.id))
      setRevealed(true)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The MIDI could not be prepared. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function send(chosen: File, mapping?: Record<string, string>) {
    setBusy(true)
    setError("")
    try {
      const submission = await submitExercise(exercise.id, chosen, mapping)
      if (submission.status === "needs_mapping") {
        setUnknown(submission.notes)
        return
      }
      setUnknown(null)
      recordCompletion({
        templateId: exercise.template_id,
        category: exercise.category,
        level: exercise.level,
        stars: submission.feedback.stars,
        date: new Date().toISOString(),
        next: submission.feedback.next,
      })
      onResult(submission.result, submission.feedback)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That file could not be compared. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const source = trainFileUrl(exercise.id, exercise.audio)
  const engine = exercise.note.toLowerCase().includes("production character") ? "Production pass" : "Clean samples"

  return (
    <section className="review-layout" aria-label="Exercise">
      <PageHeader
        eyebrow="Train"
        title={`${level.title}, ${exercise.type_label}`}
        subtitle={`${exercise.tempo} BPM${exercise.key ? `, ${exercise.key}` : ""}, ${exercise.bars} bars. Listen, then recreate it in Logic.`}
      />
      <div className="train-stage">
        <div className="card train-player">
          <Waveform src={source} />
          <audio
            key={exercise.id}
            ref={audioRef}
            src={source}
            loop={loop}
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
          <div className="train-actions">
            <Button onClick={() => void togglePlay()}>{playing ? "Stop" : "Play"}</Button>
            <Button tone={loop ? "primary" : "secondary"} aria-pressed={loop} onClick={() => setLoop((value) => !value)}>
              Loop
            </Button>
            <button
              type="button"
              className="train-count"
              aria-pressed={countIn}
              title="Four clicks at the exercise tempo before the loop starts."
              onClick={() => setCountIn((value) => !value)}
            >
              Count in
            </button>
            <span className="engine-badge" title={exercise.note}>
              {engine}
            </span>
          </div>
        </div>
        <div className="train-beside">
          <article className="card train-copy">
            <h3 className="section-title">Objective</h3>
            <p>{exercise.objective}</p>
          </article>
          <article className="card train-copy">
            <h3 className="section-title">How to practise</h3>
            <p>{exercise.instructions}</p>
          </article>
          <label className="train-download">
            {busy ? "Comparing" : "Upload your recreation"}
            <input
              className="sr-only"
              type="file"
              accept=".mid,.midi,.wav,.mp3,.m4a,.aiff,.aif,.webm"
              disabled={busy}
              onChange={(event) => {
                const chosen = event.target.files?.[0]
                event.target.value = ""
                if (!chosen) return
                setFile(chosen)
                setUnknown(null)
                void send(chosen)
              }}
            />
          </label>
          <Button tone="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
      <details
        className="card train-reveal"
        onToggle={(event) => {
          if (event.currentTarget.open && !revealed && !busy) void reveal()
        }}
      >
        <summary>Reveal how it is built</summary>
        {busy && !revealed ? <p className="text-secondary">Preparing the pattern.</p> : null}
        {revealed && exercise.pattern ? <PatternView pattern={exercise.pattern} /> : null}
        {exercise.built ? <p>{exercise.built}</p> : null}
        {revealed && exercise.midi ? (
          <div className="train-actions">
            <a className="train-download is-secondary" href={trainFileUrl(exercise.id, exercise.midi)} download>
              Download MIDI
            </a>
            <a className="train-download is-secondary" href={source} download>
              Download audio
            </a>
          </div>
        ) : null}
      </details>
      {unknown && file ? <MappingDialog notes={unknown} busy={busy} onCompare={(mapping) => void send(file, mapping)} /> : null}
      {error ? <p className="train-error">{error}</p> : null}
    </section>
  )
}

function Waveform({ src }: { src: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const node = canvas.current
    if (!node) return
    let gone = false
    const context = new AudioContext()
    void fetch(src)
      .then((response) => response.arrayBuffer())
      .then((buffer) => context.decodeAudioData(buffer))
      .then((audio) => {
        if (gone) return
        const data = audio.getChannelData(0)
        const ctx = node.getContext("2d")
        if (!ctx) return
        const width = node.width
        const height = node.height
        const size = Math.max(1, Math.floor(data.length / width))
        ctx.clearRect(0, 0, width, height)
        ctx.fillStyle = getComputedStyle(node).color
        for (let index = 0; index < width; index += 1) {
          let peak = 0
          for (let sample = 0; sample < size; sample += 1) peak = Math.max(peak, Math.abs(data[index * size + sample] ?? 0))
          const bar = Math.max(2, peak * height)
          ctx.fillRect(index, (height - bar) / 2, 1, bar)
        }
      })
      .catch(() => undefined)
      .finally(() => void context.close())
    return () => {
      gone = true
    }
  }, [src])
  return <canvas ref={canvas} className="train-wave" width={720} height={140} />
}

const pitchNames = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

function PatternView({ pattern }: { pattern: TrainPattern }) {
  if (pattern.drums.length > 0) {
    return (
      <div className="train-compare">
        {pattern.drums.map((bar, index) => (
          <div key={index} className="train-bar">
            <p className="readout-label">Bar {index + 1}</p>
            <div className="train-grid-scroll">
              <div className="train-grid">
                {bar.map((cell, step) => (
                  <span key={step} className={cell ? "train-cell has-hit" : "train-cell"}>
                    {cell}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }
  const notes =
    pattern.bass.length > 0
      ? pattern.bass
      : pattern.chords.flatMap((chord) => chord.notes.flatMap((pitch) => Array.from({ length: 16 }, (_, start) => ({ bar: chord.bar, start, pitch }))))
  const pitches = [...new Set(notes.map((note) => note.pitch))].sort((left, right) => right - left)
  if (pitches.length === 0) return null
  const bars = Math.max(...notes.map((note) => note.bar))
  return (
    <div className="train-roll">
      {pitches.map((pitch) => (
        <div key={pitch} className="train-roll-row">
          <span className="readout-label">{pitchNames[pitch % 12]}{Math.floor(pitch / 12) - 1}</span>
          <div className="train-grid-scroll">
          <div className="train-grid" style={{ gridTemplateColumns: `repeat(${bars * 16}, 28px)` }}>
            {Array.from({ length: bars * 16 }, (_, index) => {
              const bar = Math.floor(index / 16) + 1
              const start = index % 16
              const hit = notes.some((note) => note.bar === bar && note.start === start && note.pitch === pitch)
              return <span key={index} className={hit ? "train-cell has-hit" : "train-cell"} />
            })}
          </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function countClicks(bpm: number, count: number) {
  const context = new AudioContext()
  const interval = 60 / bpm
  const start = context.currentTime + 0.05
  for (let index = 0; index < count; index += 1) {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.frequency.value = index === 0 ? 1760 : 1174
    osc.connect(gain)
    gain.connect(context.destination)
    const at = start + index * interval
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.18, at + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
    osc.start(at)
    osc.stop(at + 0.06)
  }
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      void context.close()
      resolve()
    }, count * interval * 1000 + 40)
  })
}
