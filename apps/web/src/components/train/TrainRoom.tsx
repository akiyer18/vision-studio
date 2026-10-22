import { useState } from "react"
import { ApiError, startExercise, type TrainExercise, type TrainFeedback, type TrainResult } from "../../api/client.ts"
import { levelCopy, useChoosing, useLevel, type Level } from "../../level.ts"
import { useTrainCounts, useTrainNext } from "../../trainProgress.ts"
import { Button } from "../Button.tsx"
import { PageHeader } from "../layout/PageHeader.tsx"
import { ExerciseScreen } from "./ExerciseScreen.tsx"
import { LevelCards } from "./LevelCards.tsx"
import { ResultView } from "./ResultView.tsx"

const levels: Level[] = ["beginner", "intermediate", "advanced"]
const barChoices = [4, 8, 16, 32] as const
const keys = ["C major", "A minor", "D minor", "E minor", "F major", "G major", "Bb major", "Eb major"]

type Setup = {
  category: "rhythm" | "harmony"
  type: "drums" | "bass" | "chords"
  level: Level
  tempo: number
  bars: (typeof barChoices)[number]
  key: string
}

type Flow =
  | { stage: "home" }
  | { stage: "setup"; category: "rhythm" | "harmony" }
  | { stage: "play"; exercise: TrainExercise; setup: Setup }
  | { stage: "result"; exercise: TrainExercise; result: TrainResult; feedback: TrainFeedback; setup: Setup }

export function TrainRoom() {
  const level = useLevel()
  const choosing = useChoosing()
  const counts = useTrainCounts()
  const next = useTrainNext()
  const [flow, setFlow] = useState<Flow>({ stage: "home" })
  const [difficulty, setDifficulty] = useState<Level>(level ?? "beginner")
  const [kind, setKind] = useState<"drums" | "bass">("drums")
  const [tempo, setTempo] = useState(100)
  const [bars, setBars] = useState<(typeof barChoices)[number]>(4)
  const [keyName, setKeyName] = useState("A minor")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  if (!level || choosing) {
    return (
      <section className="review-layout" aria-label="Choose your level">
        <PageHeader
          eyebrow="Train"
          title="Choose your level"
          subtitle="This sets Train and how deep the explanations go. Create can still make the same things."
        />
        <LevelCards />
      </section>
    )
  }

  if (flow.stage === "play") {
    return (
      <ExerciseScreen
        exercise={flow.exercise}
        onBack={() => setFlow({ stage: "home" })}
        onExercise={(exercise) => setFlow({ stage: "play", exercise, setup: flow.setup })}
        onResult={(result, feedback) => setFlow({ stage: "result", exercise: flow.exercise, result, feedback, setup: flow.setup })}
      />
    )
  }

  if (flow.stage === "result") {
    return (
      <ResultView
        result={flow.result}
        feedback={flow.feedback}
        busy={loading}
        error={error}
        onBack={() => setFlow({ stage: "play", exercise: flow.exercise, setup: flow.setup })}
        onNext={() => void begin(flow.setup, setLoading, setError, setFlow)}
      />
    )
  }

  if (flow.stage === "setup") {
    const needsKey = flow.category === "harmony" || kind === "bass"
    const typeName = flow.category === "harmony" ? "chords" : kind === "drums" ? "drums" : "drums and bass"
    const summary = `${levelCopy[difficulty].title} ${typeName}, ${needsKey ? `${keyName}, ` : ""}${tempo} BPM, ${bars} bars.`
    return (
      <section className="review-layout" aria-label="Set up the exercise">
        <PageHeader
          eyebrow="Train"
          title={flow.category === "rhythm" ? "Rhythm" : "Harmony"}
          subtitle="Set the level, the exercise, and the tempo. Then listen."
        />
        <article className="card train-setup">
          <div>
            <p className="readout-label">Level</p>
            <div className="train-segment" role="group" aria-label="Level">
              {levels.map((item) => (
                <button key={item} type="button" aria-pressed={difficulty === item} onClick={() => setDifficulty(item)}>
                  {levelCopy[item].title}
                </button>
              ))}
            </div>
            <p className="text-secondary">{levelCopy[difficulty].copy}</p>
          </div>
          <div>
            <p className="readout-label">Exercise</p>
            <div className="train-types">
              {flow.category === "rhythm" ? (
                <>
                  <button type="button" className="train-type" aria-pressed={kind === "drums"} onClick={() => setKind("drums")}>
                    <StepIcon />
                    <span>Drums</span>
                  </button>
                  <button type="button" className="train-type" aria-pressed={kind === "bass"} onClick={() => setKind("bass")}>
                    <KeysIcon />
                    <span>Drums and bass</span>
                  </button>
                </>
              ) : (
                <button type="button" className="train-type" aria-pressed>
                  <ChordIcon />
                  <span>Chords</span>
                </button>
              )}
            </div>
          </div>
          <label className="train-tempo">
            <span className="readout-label">Tempo</span>
            <span className="readout">{tempo}</span>
            <input
              type="range"
              min={60}
              max={160}
              value={tempo}
              aria-valuetext={`${tempo} BPM`}
              onChange={(event) => setTempo(Number(event.target.value))}
            />
          </label>
          <div>
            <p className="readout-label">Bars</p>
            <div className="train-segment" role="group" aria-label="Bars">
              {barChoices.map((item) => (
                <button key={item} type="button" aria-pressed={bars === item} onClick={() => setBars(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          {needsKey ? (
            <label className="train-key">
              <span className="readout-label">Key</span>
              <select value={keyName} onChange={(event) => setKeyName(event.target.value)}>
                {keys.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          ) : null}
          <p>{summary}</p>
          <Button
            disabled={loading}
            onClick={() =>
              void begin(
                {
                  category: flow.category,
                  type: flow.category === "harmony" ? "chords" : kind,
                  level: difficulty,
                  tempo,
                  bars,
                  key: needsKey ? keyName : "",
                },
                setLoading,
                setError,
                setFlow,
              )
            }
          >
            {loading ? "Preparing the reference" : "Start exercise"}
          </Button>
          {error ? <p className="train-error">{error}</p> : null}
        </article>
      </section>
    )
  }

  return (
    <section className="review-layout" aria-label="Train">
      <PageHeader
        eyebrow="Train"
        title={levelCopy[level].title}
        subtitle="Learn by doing. Recreate a short exercise in Logic and upload it for feedback."
      />
      <p className="train-strip">
        Rhythm: {counts.rhythm} done, Harmony: {counts.harmony} done
        {next ? ` · Next: ${next}` : ""}
      </p>
      <div className="train-categories">
        <button
          type="button"
          className="card train-category is-live text-left"
          onClick={() => {
            setDifficulty(level)
            setKind("drums")
            setKeyName("A minor")
            setError("")
            setFlow({ stage: "setup", category: "rhythm" })
          }}
        >
          <StepIcon />
          <h2 className="section-title">Rhythm</h2>
          <p className="text-secondary">Hear and recreate grooves</p>
        </button>
        <button
          type="button"
          className="card train-category is-live text-left"
          onClick={() => {
            setDifficulty(level)
            setKeyName("C major")
            setError("")
            setFlow({ stage: "setup", category: "harmony" })
          }}
        >
          <ChordIcon />
          <h2 className="section-title">Harmony</h2>
          <p className="text-secondary">Hear and recreate chord progressions</p>
        </button>
        <article className="card train-soon">
          <h2 className="section-title">Sound design</h2>
          <p className="text-secondary">Tone, space, and brightness.</p>
          <span className="soon-tag">Coming soon</span>
        </article>
        <article className="card train-soon">
          <h2 className="section-title">Arrangement</h2>
          <p className="text-secondary">What enters, and what leaves.</p>
          <span className="soon-tag">Coming soon</span>
        </article>
      </div>
    </section>
  )
}

async function begin(
  setup: Setup,
  setLoading: (value: boolean) => void,
  setError: (value: string) => void,
  setFlow: (flow: Flow) => void,
) {
  setLoading(true)
  setError("")
  try {
    const exercise = await startExercise({
      category: setup.category,
      type: setup.type,
      level: setup.level,
      tempo: setup.tempo,
      bars: setup.bars,
      key: setup.key || undefined,
    })
    setFlow({ stage: "play", exercise, setup })
  } catch (caught) {
    setError(caught instanceof ApiError ? caught.message : "The exercise did not load. Try again.")
  } finally {
    setLoading(false)
  }
}

function StepIcon() {
  return (
    <svg className="train-icon" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="20" width="4" height="8" rx="1" />
      <rect x="10" y="12" width="4" height="16" rx="1" />
      <rect x="17" y="16" width="4" height="12" rx="1" />
      <rect x="24" y="8" width="4" height="20" rx="1" />
    </svg>
  )
}

function KeysIcon() {
  return (
    <svg className="train-icon" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="6" width="24" height="20" rx="2" />
      <path d="M10 6v10M16 6v10M22 6v10" />
    </svg>
  )
}

function ChordIcon() {
  return (
    <svg className="train-icon" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="8" cy="22" r="2" />
      <circle cx="16" cy="14" r="2" />
      <circle cx="24" cy="10" r="2" />
      <path d="M8 22V8M16 14V8M24 10V8" />
    </svg>
  )
}
