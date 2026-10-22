import { levelCopy, useChoosing, useLevel } from "../../level.ts"
import { PageHeader } from "../layout/PageHeader.tsx"
import { LevelCards } from "./LevelCards.tsx"

const skills = [
  { title: "Rhythm", copy: "Grooves, syncopation, and where the hits sit." },
  { title: "Harmony", copy: "Chords, voicings, and why a progression feels a certain way." },
  { title: "Sound design", copy: "Tone, brightness, and the space around a sound." },
  { title: "Arrangement", copy: "What enters, what leaves, and why a section feels small or full." },
]

export function TrainRoom() {
  const level = useLevel()
  const choosing = useChoosing()
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
  const chosen = levelCopy[level]
  return (
    <section className="review-layout" aria-label="Train">
      <PageHeader
        eyebrow="Train"
        title={chosen.title}
        subtitle="Learn by doing. Recreate short exercises in your own DAW and get feedback bar by bar."
      />
      <div className="home-skills">
        {skills.map((skill) => (
          <article key={skill.title} className="card home-room is-live">
            <h2 className="section-title">{skill.title}</h2>
            <p className="text-secondary">{skill.copy}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
