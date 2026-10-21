# tools/py — open-source audio toolbelt (CPU only)

Installed by `bash tools/py/setup.sh` into `tools/py/.venv` (Python 3.11 via `uv`). Called from Node through `lib/pytools.js`;
the CLI `adetools.py` prints exactly one JSON object per command.

| Command | What | Backed by |
|---|---|---|
| `stems` | split a mix into drums / bass / other / vocals (or two stems) | demucs `htdemucs` |
| `analyze` | tempo, beats, downbeats (heuristic), key (Krumhansl-Schmuckler on chroma), onsets with strength, groove template (microtiming ms + velocity profile per 16th, swing 0..1), sections | librosa |
| `transcribe` | polyphonic audio -> MIDI notes (+ .mid file), no quota, no network | basic-pitch (ONNX backend) |
| `process` | effect chain: highpass, lowpass, compressor, reverb, limiter, gain, pitch, saturate, chorus, delay, phaser, bitcrush, noisegate, ladder | pedalboard |
| `master` | bus compressor -> gain to target LUFS -> limiter | pedalboard + pyloudnorm |

## Licenses
| Package | License |
|---|---|
| demucs | MIT |
| basic-pitch | Apache-2.0 |
| librosa | ISC |
| pedalboard | GPL-3.0 (used as a separate process; this repo links to it only via the CLI) |
| pyloudnorm | MIT |
| numpy | BSD-3 |
| soundfile / libsndfile | BSD-3 / LGPL-2.1 |
| torch / torchaudio | BSD-3 |
| onnxruntime | MIT |
| ffmpeg (system) | LGPL/GPL build-dependent |

Model weights: demucs `htdemucs` (MIT, downloaded on setup), basic-pitch ICASSP 2022 model (Apache-2.0, bundled).

## Known quirks on this machine (Intel Mac, Python 3.11)
- `librosa.onset.onset_detect` segfaults inside numba (llvmlite 0.43 wheel); `analyze` uses its own numpy peak picker instead. `beat_track`, `chroma_cqt` and `segment.agglomerative` work.
- `basic-pitch` runs on the ONNX backend (no TensorFlow); its progress prints are redirected to stderr so stdout stays JSON.
- pedalboard's `Limiter` normalizes towards its ceiling, so `master` trims the output back to the target LUFS afterwards.
- demucs `htdemucs` on CPU: about 1.4x real time for a 10 s file with `--segment 7` (4 stems).
- Pins: torch 2.2.2 (last macOS x86_64 wheels), numba 0.60 / llvmlite 0.43, numpy < 2, demucs 4.0.1 (4.1 needs the Rust `sphn` build), setuptools < 81 (resampy imports pkg_resources).
