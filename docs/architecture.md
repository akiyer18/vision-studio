# Architecture

Vision Studio is a web app, an API, and a song agent. Contracts live in `packages/contracts` and are generated into TypeScript and Pydantic. Nothing in this map is unused unless the line says so.

## Routes

The browser address is read in `apps/web/src/route.ts`. Create stays mounted on Home and Genres.

| Path | Page | What it shows |
| --- | --- | --- |
| `/` | home | Landing page. The composer is portalled into the hero. |
| `/create` | create | The studio: conversation, review, results. |
| `/genres` | genre | Genre deep dive. |
| `/styleguide` | styleguide | Visual reference, outside the studio shell. |

Any other path is Home.

## API

`services/api/src/api/main.py`. CORS origins come from `FRONTEND_ORIGIN`.

| Method | Path | Used by |
| --- | --- | --- |
| POST | `/upload` | Composer, when a file or recording is attached. |
| POST | `/turn` | Every conversation turn. |
| POST | `/render` | Build. |
| POST | `/regenerate` | Another take. |
| POST | `/export` | Export to Logic. |
| POST | `/explain` | How a result was made. |
| GET | `/genres` | Genre list. |
| GET | `/genres/{genre_id}` | One genre. |
| GET | `/files/{session_id}/{path}` | Audio and MIDI playback and download. |
| GET | `/debug/{session_id}` | Thread trace of the last render payload. Tests use it too. |

No endpoint is unused.

## Stores

| Store | Where | What it holds |
| --- | --- | --- |
| `useStudio` | `apps/web/src/state/studio.ts` | Session id (a UUID), the turn, renders, picks, status, prompt edits, playback solo and mute, the thread, idea mode, and the layer choice. |
| Recent ideas | `apps/web/src/recentIdeas.ts` | `localStorage` list of ideas that can be restored. |
| Tour | `apps/web/src/tour.ts` | `localStorage` key `vision-studio-tour`. |
| In-flight lock | `apps/web/src/conversation/flight.ts` | One turn or render at a time. |
| Recording flag | `apps/web/src/composer/recording.ts` | Whether the composer is recording. |

The API keeps sessions, turns, uploads, and debug notes in memory on the app, and files under `data/sessions/{id}`.

## Components

All of these are mounted from the shell, Home, or the styleguide.

| File | Role |
| --- | --- |
| `App.tsx` | Styleguide or the shell. |
| `components/Shell.tsx` | Renders the dashboard. |
| `components/layout/Dashboard.tsx` | Pages, the one composer portal, the brief drawer. |
| `components/layout/Home.tsx` | Landing page. |
| `components/layout/PagePane.tsx` | Page transition. |
| `components/layout/PreviewCard.tsx` | Floating demo cards on Home. |
| `components/layout/Transport.tsx` | Brief button, Build now, session status. |
| `components/layout/BriefDrawer.tsx` | Brief, layers, and trace. |
| `components/layout/Readouts.tsx` | Fact row: tempo, key, bars, coverage. |
| `components/layout/PageHeader.tsx` | Create and genre titles. |
| `components/composer/Composer.tsx` | Idea field, attach, record, send. |
| `components/thread/Thread.tsx` | Conversation, including the one live question. |
| `components/thread/QuestionMessage.tsx` | Answer pills and quiet actions. |
| `components/thread/ReviewStage.tsx` | Review, Write prompts, Build. |
| `components/brief/BriefCard.tsx` | Slot list inside the drawer. |
| `components/layers/LayersCard.tsx` | Layer choice. |
| `components/layers/LayersView.tsx` | Rendered layers. |
| `components/layers/stage.tsx` | Lazy player and waveform. |
| `components/player/Player.tsx` | `PlayerBar`. |
| `components/reasoning/ReasoningCard.tsx` | Trace. Stays mounted when the drawer is closed. |
| `components/genre/GenreRoom.tsx` | Genre deep dive. |
| `components/sidebar/Sidebar.tsx` | Navigation, recent ideas, Help. |
| `components/sidebar/RecentList.tsx` | Recent ideas. |
| `components/tour/Tour.tsx` | First-run tour on Create. |
| `components/DemoMenu.tsx` | Scripted demo. |
| `components/Styleguide.tsx` | Styleguide page. |
| `components/Button.tsx`, `Chip.tsx`, `Logo.tsx`, `Skeleton.tsx`, `SourceBadge.tsx`, `Waveform.tsx` | Shared pieces. |

`components/layout/Insight.tsx` was unused and has been removed. Feature flags in `apps/web/src/features.ts` are all read: `analyser` and `edits` keep Analyse and Tweak marked Soon, and `soundcharts` gates similar artists.

## Providers and renderers

| Name | Where | When |
| --- | --- | --- |
| `MockProvider` | `services/agent/src/agent/turn.py` | `PROVIDER=mock`, and when Bedrock fails. |
| `BedrockProvider` | `services/agent/src/agent/bedrock.py` | `PROVIDER=bedrock`. |
| `MockRenderer` | `services/api/src/api/renderer.py` | `RENDERER=mock`, and when Stability is not configured. |
| `StabilityAPIRenderer` | `services/api/src/api/stability.py` | `RENDERER=stability_api`. Falls back to the mock renderer. |

## Tests

Python: `uv run pytest` (`services/`).

| File | Covers |
| --- | --- |
| `services/agent/tests/test_mock_agent.py` | Mock interviewer. |
| `services/agent/tests/test_interview.py` | Stubbed Bedrock interviewer. |
| `services/agent/tests/test_bedrock.py` | Extraction, polish, guardrails. |
| `services/agent/tests/test_bedrock_live.py` | Live Bedrock. Skipped unless `RUN_BEDROCK=1`. |
| `services/agent/tests/test_contract.py` | Turn response shape. |
| `services/agent/tests/test_turn_response.py` | Response fields. |
| `services/agent/tests/test_complete.py` | Timing and prompts. |
| `services/agent/tests/test_one_sound.py` | One sound mode. |
| `services/agent/tests/test_facets.py` | Facet questions. |
| `services/agent/tests/test_explain.py` | Explanations. |
| `services/agent/tests/test_genres.py` | Genre files. |
| `services/agent/tests/test_midi.py` | MIDI writing. |
| `services/api/tests/test_api.py` | Upload, turn, render, export, files. |
| `services/api/tests/test_audio_input.py` | wav, mp3, webm, and Stability fallback. |
| `services/api/tests/test_security.py` | Session ids, magic bytes, limits, boot check. |

Web: `npm --prefix apps/web test` runs `apps/web/src/recentIdeas.test.ts`. Lint is oxlint (`npm run lint`). Typecheck is `tsc -b`. Python lint is `ruff check` with the `F` and `E9` rules in `pyproject.toml`. The web app does not use eslint.
