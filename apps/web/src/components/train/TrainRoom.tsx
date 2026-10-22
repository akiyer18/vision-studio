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

type Flow =
  | { stage: "home" }
  | { stage: "setup"; category: "rhythm" | "harmony" }
  | { stage: "play"; exercise: TrainExercise }
  | { stage: "result"; exercise: TrainExercise; result: TrainResult; feedback: TrainFeedback }

export function TrainRoom() {
  const level = useLevel()
  const choosing = useChoosing()
  const counts = useTrainCounts()
  const next = useTrainNext()
  const [flow, setFlow] = useState<Flow>({ stage: "home" })
  const [difficulty, setDifficulty] = useState<Level>(level ?? "beginner")
  const [kind, setKind] = useState<"drums" | "bass">("drums")
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
        onExercise={(exercise) => setFlow({ stage: "play", exercise })}
        onResult={(result, feedback) => setFlow({ stage: "result", exercise: flow.exercise, result, feedback })}
      />
    )
  }

  if (flow.stage === "result") {
    return (
      <ResultView
        result={flow.result}
        feedback={flow.feedback}
        onBack={() => setFlow({ stage: "play", exercise: flow.exercise })}
        onHome={() => setFlow({ stage: "home" })}
      />
    )
  }

  if (flow.stage === "setup") {
    return (
      <section className="review-layout" aria-label="Choose a difficulty">
        <PageHeader
          eyebrow="Train"
          title={flow.category === "rhythm" ? "Rhythm" : "Harmony"}
          subtitle="Difficulty starts from the level you chose. You can change it for this exercise."
        />
        {flow.category === "rhythm" ? (
          <div className="train-actions">
            <Button tone={kind === "drums" ? "primary" : "secondary"} aria-pressed={kind === "drums"} onClick={() => setKind("drums")}>
              Drums only
            </Button>
            <Button tone={kind === "bass" ? "primary" : "secondary"} aria-pressed={kind === "bass"} onClick={() => setKind("bass")}>
              Drums and bass line
            </Button>
          </div>
        ) : null}
        <div className="train-actions">
          {levels.map((item) => (
            <Button
              key={item}
              tone={difficulty === item ? "primary" : "secondary"}
              aria-pressed={difficulty === item}
              onClick={() => setDifficulty(item)}
            >
              {levelCopy[item].title}
            </Button>
          ))}
        </div>
        <div className="train-actions">
          <Button
            disabled={loading}
            onClick={() =>
              void begin(flow.category, flow.category === "harmony" ? "chords" : kind, difficulty, setLoading, setError, setFlow)
            }
          >
            {loading ? "Preparing the reference" : "Start exercise"}
          </Button>
          <Button tone="ghost" onClick={() => setFlow({ stage: "home" })}>
            Back
          </Button>
        </div>
        {error ? <p className="train-error">{error}</p> : null}
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
      </p>
      {next ? <p className="text-secondary">Next: {next}</p> : null}
      <div className="home-skills">
        <button
          type="button"
          className="card home-room is-live text-left"
          onClick={() => {
            setDifficulty(level)
            setKind("drums")
            setError("")
            setFlow({ stage: "setup", category: "rhythm" })
          }}
        >
          <h2 className="section-title">Rhythm</h2>
          <p className="text-secondary">Drums only, or drums and a bass line. Grooves, syncopation, and where the hits sit.</p>
        </button>
        <button
          type="button"
          className="card home-room is-live text-left"
          onClick={() => {
            setDifficulty(level)
            setError("")
            setFlow({ stage: "setup", category: "harmony" })
          }}
        >
          <h2 className="section-title">Harmony</h2>
          <p className="text-secondary">Chords, inversions, and how the voices move from bar to bar.</p>
        </button>
        <article className="card home-room is-soon">
          <h2 className="section-title">Sound design</h2>
          <p className="text-secondary">Tone, brightness, and the space around a sound.</p>
          <div className="mt-auto flex items-center gap-2">
            <span className="soon-tag">Coming soon</span>
            <Button tone="secondary" disabled>
              Open
            </Button>
          </div>
        </article>
        <article className="card home-room is-soon">
          <h2 className="section-title">Arrangement</h2>
          <p className="text-secondary">What enters, what leaves, and why a section feels small or full.</p>
          <div className="mt-auto flex items-center gap-2">
            <span className="soon-tag">Coming soon</span>
            <Button tone="secondary" disabled>
              Open
            </Button>
          </div>
        </article>
      </div>
    </section>
  )
}

async function begin(
  category: "rhythm" | "harmony",
  type: string,
  level: Level,
  setLoading: (value: boolean) => void,
  setError: (value: string) => void,
  setFlow: (flow: Flow) => void,
) {
  setLoading(true)
  setError("")
  try {
    const exercise = await startExercise({ category, type, level })
    setFlow({ stage: "play", exercise })
  } catch (caught) {
    setError(caught instanceof ApiError ? caught.message : "The exercise did not load. Try again.")
  } finally {
    setLoading(false)
  }
}
