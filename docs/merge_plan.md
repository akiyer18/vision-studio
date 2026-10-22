# Stable Audio merge

The Stable Audio project from `origin/main` is kept as a self-contained project under
`stable-audio-features/`. Its relative directory layout is preserved, including the
Ableton integration, Node server, Python tooling, genre knowledge, scripts, tests,
capture tool, and sample outputs.

The Vision Studio application remains the repository's primary root project. Its
root configuration and documentation stay authoritative for `apps/web`,
`services/api`, `services/agent`, and `packages/contracts`. The Stable Audio
project's root-level configuration files are retained inside
`stable-audio-features/` rather than replacing those files.

Stable Audio code uses paths relative to its own project directory. No Vision Studio
imports or Makefile targets referenced the former root-level Stable Audio paths, so
no application import rewrite was required by the relocation.
