import { useRef, useState } from "react"
import {
  ApiError,
  revealExercise,
  startExercise,
  submitExercise,
  trainFileUrl,
  type TrainExercise,
  type TrainFeedback,
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
      audio.loop = true
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

  async function another() {
    setBusy(true)
    setError("")
    try {
      const next = await startExercise({ category: exercise.category, type: exercise.type, level: exercise.level })
      setRevealed(false)
      setFile(null)
      setUnknown(null)
      setPlaying(false)
      onExercise(next)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "A new variation did not load. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="review-layout" aria-label="Exercise">
      <PageHeader
        eyebrow="Train"
        title={`${level.title}, ${exercise.type_label}`}
        subtitle="Listen on a loop, recreate it in Logic, then upload the file. This page cannot see your session."
      />
      <div className="train-readouts">
        <article className="card readout-tile">
          <p className="readout-label">Tempo</p>
          <p className="readout">{exercise.tempo}</p>
        </article>
        {exercise.key ? (
          <article className="card readout-tile">
            <p className="readout-label">Key</p>
            <p className="readout">{exercise.key}</p>
          </article>
        ) : null}
        <article className="card readout-tile">
          <p className="readout-label">Bars</p>
          <p className="readout">{exercise.bars}</p>
        </article>
      </div>
      <div className="card train-player">
        <audio
          key={exercise.id}
          ref={audioRef}
          src={trainFileUrl(exercise.id, exercise.audio)}
          loop
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <div className="train-actions">
          <Button onClick={() => void togglePlay()}>{playing ? "Stop" : "Play"}</Button>
          <Button tone={countIn ? "primary" : "secondary"} aria-pressed={countIn} onClick={() => setCountIn((value) => !value)}>
            Count in
          </Button>
          <Button tone="secondary" disabled={busy} onClick={() => void another()}>
            New variation
          </Button>
        </div>
        <p className="text-secondary">The reference loops. Count in plays four clicks at the exercise tempo before it starts.</p>
        <p className="text-secondary">{exercise.note}</p>
      </div>
      <article className="card train-copy">
        <h2 className="section-title">Learning objective</h2>
        <p>{exercise.objective}</p>
      </article>
      <article className="card train-copy">
        <h2 className="section-title">How to practise</h2>
        <p>{exercise.instructions}</p>
      </article>
      <div className="train-actions">
        {revealed && exercise.midi ? (
          <a className="train-download" href={trainFileUrl(exercise.id, exercise.midi)} download>
            Download MIDI
          </a>
        ) : (
          <Button disabled={busy} onClick={() => void reveal()}>
            Show me how it is built
          </Button>
        )}
        <label className="train-download is-secondary">
          Upload your recreation
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
      {!revealed ? (
        <p className="text-secondary">Practise by ear first. The MIDI download appears after you ask to see how it is built.</p>
      ) : null}
      {exercise.built ? (
        <article className="card train-copy">
          <h2 className="section-title">How it is built</h2>
          <p>{exercise.built}</p>
        </article>
      ) : null}
      {unknown && file ? <MappingDialog notes={unknown} busy={busy} onCompare={(mapping) => void send(file, mapping)} /> : null}
      {error ? <p className="train-error">{error}</p> : null}
    </section>
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
