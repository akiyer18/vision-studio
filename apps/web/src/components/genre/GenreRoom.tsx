import { useEffect, useState } from "react"

import { genreDetail, listGenres, type GenreDetail, type GenreSummary } from "../../api/client.ts"
import { features } from "../../features.ts"
import { Button } from "../Button.tsx"

type Props = {
  onUse: (genre: GenreDetail) => void
}

export type { GenreDetail }

export function GenreRoom({ onUse }: Props) {
  const [genres, setGenres] = useState<GenreSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<GenreDetail | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    listGenres().then(
      (items) => {
        if (cancel) return
        setGenres(items)
        setSelected((current) => current ?? items[0]?.id ?? null)
      },
      () => {
        if (!cancel) setProblem("The genre files did not load.")
      },
    )
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    let cancel = false
    genreDetail(selected).then(
      (item) => {
        if (!cancel) setDetail(item)
      },
      () => {
        if (!cancel) setProblem("That genre file did not load.")
      },
    )
    return () => {
      cancel = true
    }
  }, [selected])

  const similar = features.soundcharts && detail ? detail.references.flatMap((item) => similarArtists(item.artist)) : []

  return (
    <div className="genre-room">
      <div className="genre-list px-4 py-4">
        <p className="section-title">Genres</p>
        <ul className="mt-3 flex flex-col gap-1">
          {genres.map((genre) => (
            <li key={genre.id}>
              <button
                type="button"
                aria-current={genre.id === selected ? "true" : undefined}
                className={`w-full rounded-xl px-2 py-2 text-left text-sm ${genre.id === selected ? "bg-white/8 text-ink" : "text-secondary"}`}
                onClick={() => setSelected(genre.id)}
              >
                {genre.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="genre-detail px-4 py-4">
        {problem ? <p role="alert" className="text-danger">{problem}</p> : null}
        {detail && detail.id === selected ? (
          <article className="glass flex flex-col gap-4 p-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="section-title">{detail.title}</h1>
              <Button onClick={() => onUse(detail)}>Use in Create</Button>
            </header>
            <p className="text-secondary">{detail.history}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Trait label="Tempo" value={detail.tempo_range} />
              <Trait label="Keys" value={detail.keys.join(", ")} />
              <Trait label="Instruments" value={detail.instruments.join(", ")} />
              <Trait label="Drums" value={detail.drum_pattern} />
              <Trait label="Production" value={detail.production} />
            </dl>
            <div>
              <h2 className="text-sm text-muted">References</h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-secondary">
                {detail.references.map((item) => (
                  <li key={item.artist}>
                    {item.artist}: {item.tracks.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
            {similar.length > 0 ? (
              <div>
                <h2 className="text-sm text-muted">Similar artists</h2>
                <ul className="mt-2 flex flex-col gap-1 text-sm text-secondary">
                  {similar.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ) : problem ? null : (
          <p className="text-secondary">Opening the genre.</p>
        )}
      </div>
    </div>
  )
}

function Trait({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  )
}

function similarArtists(_artist: string): string[] {
  return []
}
