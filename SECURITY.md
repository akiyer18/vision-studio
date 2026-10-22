# Security

Secrets stay on the server. The browser only knows the API address.

## Secrets

Stability, AWS, Soundcharts, and fal keys are read from the environment (`.env` on the server). They are not `VITE_` variables. The only frontend variable is `VITE_API_URL`.

The API refuses to boot if a secret name, a long secret value, or any `VITE_` variable other than `VITE_API_URL` appears in `apps/web/src` or `apps/web/dist`. The boot error does not include the secret. Debug responses do not include API keys. Stability errors are redacted before they are stored.

## Uploads

`POST /upload` accepts wav, mp3, m4a, aiff, webm, and mid. The bytes must match the extension. The limit is 50 MB and 5 minutes. The stored file name is random. ffmpeg is called with an argument list and a 60 second timeout, never a shell string.

## Files

Session ids are UUIDs. `GET /files/{session_id}/{path}` resolves inside `data/sessions/{id}` and rejects paths that leave that folder. Session folders older than 7 days are removed when the API starts.

## API

CORS allows only `FRONTEND_ORIGIN` (local Vite origins when that variable is unset). Request bodies larger than 52 MB are refused. `/turn`, `/render`, and `/upload` are limited per IP and per session. Outbound calls have timeouts: Bedrock connects in 2 seconds and reads in 8, Stability in 30, ffmpeg in 60. Unexpected failures return "Something went wrong. Try again." Details stay in the server log.

## Model calls

User text is data inside `<<<USER_DATA>>>` and `<<<END_USER_DATA>>>`. It is not concatenated into the system prompt. A marker typed by the user is broken up so it cannot close the block. Tool outputs are checked against the tool schema. A `record_slots` envelope may still contain a bad slot so the agent can drop that slot and say why.
