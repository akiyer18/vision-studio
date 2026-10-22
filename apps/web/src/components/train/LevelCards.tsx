import { finishChoice, levelCopy, type Level } from "../../level.ts"

const order: Level[] = ["beginner", "intermediate", "advanced"]

export function LevelCards() {
  return (
    <div className="home-people">
      {order.map((level) => {
        const item = levelCopy[level]
        return (
          <button key={level} type="button" className="card home-room is-live text-left" onClick={() => finishChoice(level)}>
            <h2 className="section-title">{item.title}</h2>
            <p className="text-secondary">{item.copy}</p>
          </button>
        )
      })}
    </div>
  )
}
