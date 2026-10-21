#!/usr/bin/env bash
# One-time setup of the open-source audio toolbelt (CPU only).
set -euo pipefail
cd "$(dirname "$0")"
UV="${UV:-$HOME/.local/bin/uv}"; command -v uv >/dev/null 2>&1 && UV=uv
echo "[setup] creating venv (Python 3.11) ..." >&2
"$UV" venv .venv --python 3.11 --quiet
echo "[setup] installing packages (torch CPU wheels, demucs, basic-pitch[onnx], librosa, pedalboard) ..." >&2
UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-900}" UV_CONCURRENT_DOWNLOADS="${UV_CONCURRENT_DOWNLOADS:-4}" "$UV" pip install --python .venv/bin/python -r requirements.txt
echo "[setup] pre-downloading demucs htdemucs weights ..." >&2
.venv/bin/python - <<'PY' >&2
import warnings; warnings.filterwarnings("ignore")
from demucs.pretrained import get_model
m = get_model("htdemucs"); print("htdemucs ok, sources:", m.sources)
PY
echo "[setup] versions:" >&2
.venv/bin/python - <<'PY' >&2
import importlib
for p in ["numpy","librosa","torch","demucs","basic_pitch","pedalboard","soundfile","pyloudnorm"]:
    try: print(f"  {p} {importlib.import_module(p).__version__}")
    except Exception as e: print(f"  {p} ERROR {e}")
PY
echo "[setup] done -> $(pwd)/.venv" >&2
