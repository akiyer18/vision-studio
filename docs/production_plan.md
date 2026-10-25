# Production plan

Target architecture for Vision Studio after the hackathon. Product behaviour (Create interviewer, Train flow, button labels, facet and exercise split) stays the same. Persistence, accounts, storage, and where long work runs change.

## Decisions

- **Auth:** Clerk (email magic link and Google). The API verifies Clerk JWTs. Cognito is deferred (magic link is awkward). Supabase Auth is deferred so Postgres stays independent.
- **Data:** Neon Postgres, Cloudflare R2 (S3-compatible), Upstash Redis.
- **Compute (staging and early production):** Fly.io for the API and workers. Marketing site and app SPA on Cloudflare Pages.
- **AWS:** Bedrock stays on AWS. Stable Audio stays on its HTTP API. The rest stays on cheaper managed services until traffic needs ECS and RDS.

## Target architecture

```
Marketing site ──► Cloudflare Pages
App SPA        ──► Cloudflare Pages ──► Clerk
                     │
                     ▼
                  FastAPI (Fly) ──► Neon Postgres
                     │           ──► Cloudflare R2
                     │           ──► Upstash Redis
                     ▼
                  Workers (Fly) ──► Bedrock
                                  ──► Stable Audio API
```

- **Marketing site:** static pages (home, pricing, how it works) at the apex domain. Separate deploy from the studio. The SPA home hero can remain for demos; production moves the promotional surface to `apps/marketing` (or a separate repo).
- **App:** Create, Train, and Analyse at `app.…`. Auth gate around studio routes. Anonymous Create can stay for demos behind a flag.
- **API:** FastAPI is the HTTP edge. Short turns return immediately. Renders, Stable Audio, heavy analysis, and Train production passes enqueue jobs.
- **Workers:** consume Redis jobs (`render`, `analyse`, `train_reference`, `train_grade`). Progress lives on a `jobs` row; the frontend polls `GET /jobs/{id}` (SSE later).
- **Postgres:** source of truth for users, sessions, ideas, renders, exercises, attempts, analyses, jobs, and usage.
- **R2:** audio, MIDI, and exports. The API issues short-lived signed URLs.
- **Clerk:** magic link and Google. A `users` row is created or linked on the first verified request.

## Environments

| Env | App | API | Secrets | Data |
| --- | --- | --- | --- | --- |
| local | `127.0.0.1:5173` | `127.0.0.1:8000` | `.env` (uncommitted) | Docker Compose: Postgres, Redis, MinIO |
| staging | `staging.app.…` | `staging.api.…` | GitHub Actions → Fly / Neon / R2 / Clerk staging | Neon staging branch, R2 staging bucket |
| production | `app.…` | `api.…` | separate project secrets | Neon primary, R2 prod bucket |

`PROVIDER` and `RENDERER` stay as today. Staging defaults to mock unless Bedrock or Stability keys are present. Local `make dev` can use Compose; without Compose, mock mode and the filesystem fallback keep the hackathon path working.

## Hosting and cost

Indicative monthly cost for early traffic, before Bedrock and Stable Audio usage.

### Recommended path

| Piece | Service | Indicative |
| --- | --- | --- |
| Auth | Clerk | free → ~£20 past free seats |
| Postgres | Neon | free → ~£15–20 launch |
| Redis | Upstash | free → ~£10 |
| Pages + objects | Cloudflare Pages + R2 | Pages free; R2 ~£0–5 |
| API + workers | Fly.io | ~£10–30 |
| Models | Bedrock + Stable Audio | usage, tracked per job |

**Rough total before model and audio usage: £40–90 / month.**

### AWS-native path (later)

Clerk or Cognito, App Runner or ECS, RDS, ElastiCache or SQS, S3: typically £150–400+ / month before Bedrock. Move when traffic or compliance needs one cloud.

## Postgres schema

| Table | Role |
| --- | --- |
| `users` | Clerk subject id, email, plan (`free` \| `pro`), created_at |
| `sessions` | Existing UUID session id, user_id, brief JSON, mode, status, timestamps |
| `ideas` | Recent ideas for a user (title, brief, prompts, selected layers) |
| `renders` | Layer variations: job_id, object_key, bpm, seconds |
| `exercises` | Train rolls: category, level, template, setup, object keys |
| `attempts` | Train submissions: upload key, feedback, stars |
| `analyses` | Analyse results: source key, result JSON, job_id |
| `jobs` | kind, status, progress, payload, error, cost_cents |
| `usage` | Per-job units and cost_cents for quota and billing |

Migrations use Alembic under `services/api`. Session files under `data/sessions/{id}` become object keys `sessions/{id}/…`.

## Job queue and progress

1. `POST /render` (and heavy analyse / train production) creates a `jobs` row, enqueues Redis, returns `{ job_id }`.
2. The worker runs Stability, Bedrock, or ffmpeg, writes R2, updates `renders` or `exercises`, and sets progress 0–100.
3. The frontend keeps the current UI and polls `GET /jobs/{id}` while a job is in flight.
4. The mock path can complete inline so local demos need no Redis. When Redis is configured, paid providers go through the queue.

## Accounts and local data import

- Sign-in: magic link and Google via Clerk, minimal and on-brand.
- First authenticated request: if `localStorage` still has `vision-studio-recent-ideas` or `vision-studio-train-progress`, `POST /me/import` upserts them, then those keys are cleared. Tour and level can stay local until a settings screen exists.
- Guests: anonymous UUID sessions still work for Create demos; Recent ideas stay local until sign-in. Signed-in users read and write ideas through the API.

## Usage limits and cost tracking

- Plans live in config: free has daily render and Bedrock turn caps; pro is higher.
- Each job records estimated `cost_cents` (Stable Audio seconds, Bedrock tokens) on `jobs` and `usage`.
- Before enqueue, the API checks remaining quota. Over limit returns a clear error the UI can show with Try again.

## Migration path from today

1. Compose, schema, and repositories beside the in-memory store.
2. Dual-write: Postgres and local files when `STORAGE=local`.
3. R2 and signed URLs behind `STORAGE=s3`.
4. Queue behind `QUEUE=redis`; otherwise inline.
5. Clerk; import on first sign-in.
6. Signed-in users stop using localStorage for ideas and train progress. `STORAGE=local` keeps the hackathon filesystem path.

## CI and deploy

- Every push and pull request: lint, typecheck, tests, build.
- Merge to `main`: the `deploy-staging` job builds the web app, deploys the API with Fly (`fly.toml`), runs Alembic migrations, and deploys `apps/web/dist` to Cloudflare Pages project `vision-studio-staging`.
- Required GitHub secrets when deploying: `FLY_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Steps no-op when a secret is missing so forks still pass CI.
- Production deploy stays manual until the staging path is proven.
