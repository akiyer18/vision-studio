#!/usr/bin/env python
"""ADE Hack open-source audio toolbelt. Every command prints exactly ONE JSON object on stdout; logs go to stderr.

  stems      --in f --out dir [--model htdemucs] [--two-stems vocals|drums] [--segment 7]
  analyze    --in f
  transcribe --in f [--onset 0.5] [--frame 0.3] [--min-note-ms 60] [--out midi]
  process    --in f --out f --chain '[{...}]'
  master     --in f --out f [--lufs -12]
"""
import argparse, json, os, sys, time, warnings
warnings.filterwarnings("ignore")
os.environ.setdefault("OMP_NUM_THREADS", "4")

def log(*a):
    print(*a, file=sys.stderr, flush=True)

def out(obj):
    sys.stdout.write(json.dumps(obj, allow_nan=False) + "\n"); sys.stdout.flush()

def fail(msg, **extra):
    out({"ok": False, "error": str(msg), **extra}); sys.exit(1)

def load_mono(path, sr=22050):
    import librosa
    y, _sr = librosa.load(path, sr=sr, mono=True)
    return y, sr

# ---------------------------------------------------------------- stems
def cmd_stems(a):
    import torch, soundfile as sf
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    from demucs.audio import AudioFile
    t0 = time.time()
    torch.set_num_threads(max(1, os.cpu_count() or 2))
    model = get_model(a.model); model.cpu(); model.eval()
    wav = AudioFile(a.inp).read(streams=0, samplerate=model.samplerate, channels=model.audio_channels)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        sources = apply_model(model, wav[None], device="cpu", segment=a.segment, shifts=0, split=True, overlap=0.1, progress=False)[0]
    sources = sources * (ref.std() + 1e-8) + ref.mean()
    os.makedirs(a.out, exist_ok=True)
    base = os.path.splitext(os.path.basename(a.inp))[0]
    stems = {}
    names = list(model.sources)
    if a.two_stems:
        if a.two_stems not in names: fail(f"unknown stem {a.two_stems}; model has {names}")
        idx = names.index(a.two_stems)
        other = sum(sources[i] for i in range(len(names)) if i != idx)
        pairs = [(a.two_stems, sources[idx]), (f"no_{a.two_stems}", other)]
    else:
        pairs = list(zip(names, sources))
    for name, tensor in pairs:
        p = os.path.join(a.out, f"{base}-{name}.wav")
        sf.write(p, tensor.T.numpy(), model.samplerate, subtype="PCM_16")
        stems[name] = p
    out({"ok": True, "model": a.model, "sampleRate": model.samplerate, "stems": stems, "seconds": round(time.time() - t0, 1)})

# ---------------------------------------------------------------- analyze
KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

def estimate_key(chroma_mean):
    import numpy as np
    best = None; scores = []
    for mode, prof in (("major", KS_MAJOR), ("minor", KS_MINOR)):
        for tonic in range(12):
            rolled = np.roll(prof, tonic)
            c = float(np.corrcoef(chroma_mean, rolled)[0, 1])
            scores.append(c)
            if best is None or c > best[0]: best = (c, tonic, mode)
    scores.sort(reverse=True)
    margin = float(scores[0] - scores[1]) if len(scores) > 1 else 0.0
    return {"tonic": NOTE_NAMES[best[1]], "mode": best[2], "confidence": round(max(0.0, min(1.0, margin * 5)), 3), "correlation": round(best[0], 3)}

def cmd_analyze(a):
    import numpy as np, librosa
    y, sr = load_mono(a.inp)
    dur = float(len(y) / sr)
    res = {"ok": True, "duration": round(dur, 3), "sampleRate": sr}
    hop = 512
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    # tempo + beats
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, onset_envelope=onset_env, hop_length=hop, trim=False)
    tempo = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else 0.0
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop).tolist()
    res["tempo"] = round(tempo, 2); res["beats"] = [round(b, 4) for b in beats]
    # downbeats: no reliable librosa estimator; try grouping beats by onset strength maxima every 4
    downbeats = None
    if len(beats) >= 8 and tempo > 0:
        strengths = onset_env[np.clip(beat_frames, 0, len(onset_env) - 1)]
        best_phase = int(np.argmax([strengths[p::4].mean() for p in range(4)]))
        downbeats = [round(b, 4) for b in beats[best_phase::4]]
    res["downbeats"] = downbeats
    # key
    try:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
        res["key"] = estimate_key(chroma.mean(axis=1))
    except Exception as e:
        log("key failed:", e); res["key"] = None; chroma = None
    # onsets with strengths
    on_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop, backtrack=True, units="frames")
    peak_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop, backtrack=False, units="frames")
    times = librosa.frames_to_time(on_frames, sr=sr, hop_length=hop)
    pk = onset_env[np.clip(peak_frames, 0, len(onset_env) - 1)] if len(peak_frames) == len(on_frames) else onset_env[np.clip(on_frames, 0, len(onset_env) - 1)]
    mx = float(pk.max()) if len(pk) else 1.0
    onsets = [{"time": round(float(t), 4), "strength": round(float(s / (mx or 1.0)), 3)} for t, s in zip(times, pk)]
    res["onsets"] = onsets
    # groove: microtiming vs 16th grid derived from beats
    groove = {"swing": None, "microtiming": [0.0] * 16, "velocityProfile": [0.0] * 16, "onsetsUsed": 0}
    if len(beats) >= 2 and onsets:
        beat_len = float(np.median(np.diff(beats)))
        sixteenth = beat_len / 4.0
        # grid phase: position within a 4-beat bar using downbeats if available else beats[0]
        bar_start = (downbeats[0] if downbeats else beats[0])
        dev_sum = [0.0] * 16; dev_n = [0] * 16; vel_sum = [0.0] * 16
        odd8_delays = []
        for o in onsets:
            rel = o["time"] - bar_start
            if rel < -sixteenth / 2: continue
            pos = rel / sixteenth
            nearest = int(round(pos))
            dev_ms = (pos - nearest) * sixteenth * 1000.0
            slot = nearest % 16
            if abs(dev_ms) <= sixteenth * 1000 * 0.5:
                dev_sum[slot] += dev_ms; dev_n[slot] += 1; vel_sum[slot] += o["strength"]
                if nearest % 4 == 2:   # the "and" 8th positions (odd 8ths)
                    odd8_delays.append(dev_ms)
        groove["microtiming"] = [round(dev_sum[i] / dev_n[i], 1) if dev_n[i] else 0.0 for i in range(16)]
        vmax = max(vel_sum) or 1.0
        groove["velocityProfile"] = [round(vel_sum[i] / vmax, 3) for i in range(16)]
        groove["onsetsUsed"] = int(sum(dev_n))
        if odd8_delays:
            mean_delay = float(np.mean(odd8_delays))            # ms late relative to straight 8th
            triplet_delay = sixteenth * 1000.0 * (2.0 / 3.0)     # full swing = 1/3 beat late = 2/3 of a 16th
            groove["swing"] = round(max(0.0, min(1.0, mean_delay / triplet_delay)), 3)
        else:
            groove["swing"] = 0.0
    res["groove"] = groove
    # sections (cheap agglomerative on chroma)
    sections = []
    try:
        if chroma is not None and dur > 8:
            k = int(max(3, min(6, dur // 8)))
            bounds = librosa.segment.agglomerative(chroma, k)
            bt = librosa.frames_to_time(bounds, sr=sr, hop_length=hop).tolist() + [dur]
            sections = [{"start": round(bt[i], 3), "end": round(bt[i + 1], 3)} for i in range(len(bt) - 1) if bt[i + 1] - bt[i] > 0.5]
    except Exception as e:
        log("sections failed:", e)
    res["sections"] = sections
    out(res)

# ---------------------------------------------------------------- transcribe
def cmd_transcribe(a):
    import numpy as np
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH
    t0 = time.time()
    model_output, midi_data, note_events = predict(a.inp, ICASSP_2022_MODEL_PATH, onset_threshold=a.onset, frame_threshold=a.frame, minimum_note_length=a.min_note_ms, minimum_frequency=None, maximum_frequency=None, melodia_trick=True)
    notes = []
    for ev in note_events:  # (start_s, end_s, pitch_midi, amplitude, pitch_bends)
        start, end, pitch, amp = float(ev[0]), float(ev[1]), int(ev[2]), float(ev[3])
        notes.append({"pitch": pitch, "startSeconds": round(start, 4), "durationSeconds": round(max(0.01, end - start), 4), "velocity": int(max(1, min(127, round(amp * 127))))})
    notes.sort(key=lambda n: (n["startSeconds"], n["pitch"]))
    midi_path = a.out or os.path.splitext(a.inp)[0] + "-basicpitch.mid"
    try:
        midi_data.write(midi_path)
    except Exception as e:
        log("midi write failed:", e); midi_path = None
    out({"ok": True, "backend": "basic-pitch", "notes": notes, "noteCount": len(notes), "midiPath": midi_path, "seconds": round(time.time() - t0, 1)})

# ---------------------------------------------------------------- process / master
def build_board(chain):
    import pedalboard as pb
    plugins = []
    for step in chain:
        t = str(step.get("type", "")).lower()
        if t == "highpass": plugins.append(pb.HighpassFilter(cutoff_frequency_hz=float(step.get("hz", 100))))
        elif t == "lowpass": plugins.append(pb.LowpassFilter(cutoff_frequency_hz=float(step.get("hz", 8000))))
        elif t == "compressor": plugins.append(pb.Compressor(threshold_db=float(step.get("threshold_db", -18)), ratio=float(step.get("ratio", 4)), attack_ms=float(step.get("attack_ms", 5)), release_ms=float(step.get("release_ms", 80))))
        elif t == "reverb": plugins.append(pb.Reverb(room_size=float(step.get("room_size", 0.3)), damping=float(step.get("damping", 0.5)), wet_level=float(step.get("wet", 0.15)), dry_level=float(step.get("dry", 1.0 - float(step.get("wet", 0.15)))), width=float(step.get("width", 1.0))))
        elif t == "limiter": plugins.append(pb.Limiter(threshold_db=float(step.get("threshold_db", -1)), release_ms=float(step.get("release_ms", 100))))
        elif t == "gain": plugins.append(pb.Gain(gain_db=float(step.get("db", 0))))
        elif t == "pitch": plugins.append(pb.PitchShift(semitones=float(step.get("semitones", 0))))
        elif t in ("saturate", "distortion"): plugins.append(pb.Distortion(drive_db=float(step.get("drive_db", 12))))
        elif t == "chorus": plugins.append(pb.Chorus(rate_hz=float(step.get("rate_hz", 1.0)), depth=float(step.get("depth", 0.25)), mix=float(step.get("mix", 0.3))))
        elif t == "delay": plugins.append(pb.Delay(delay_seconds=float(step.get("seconds", 0.25)), feedback=float(step.get("feedback", 0.3)), mix=float(step.get("mix", 0.2))))
        elif t == "phaser": plugins.append(pb.Phaser(rate_hz=float(step.get("rate_hz", 0.5)), depth=float(step.get("depth", 0.5)), mix=float(step.get("mix", 0.3))))
        elif t == "bitcrush": plugins.append(pb.Bitcrush(bit_depth=float(step.get("bits", 8))))
        elif t == "noisegate": plugins.append(pb.NoiseGate(threshold_db=float(step.get("threshold_db", -60)), ratio=float(step.get("ratio", 10)), attack_ms=float(step.get("attack_ms", 1)), release_ms=float(step.get("release_ms", 100))))
        elif t == "ladder": plugins.append(pb.LadderFilter(mode=pb.LadderFilter.Mode.LPF12, cutoff_hz=float(step.get("hz", 1000)), resonance=float(step.get("resonance", 0.2)), drive=float(step.get("drive", 1.0))))
        else: fail(f"unknown chain step type: {t}", known=["highpass","lowpass","compressor","reverb","limiter","gain","pitch","saturate","chorus","delay","phaser","bitcrush","noisegate","ladder"])
    return pb.Pedalboard(plugins)

def peak_dbfs(x):
    import numpy as np
    p = float(np.max(np.abs(x))) if x.size else 0.0
    return round(20 * np.log10(p) if p > 0 else -120.0, 2)

def read_audio(path):
    import soundfile as sf, numpy as np
    x, sr = sf.read(path, dtype="float32", always_2d=True)   # (frames, channels)
    return x.T.copy(), sr                                      # pedalboard wants (channels, frames)

def write_audio(path, x, sr):
    import soundfile as sf
    sf.write(path, x.T, sr, subtype="PCM_16")

def cmd_process(a):
    try: chain = json.loads(a.chain)
    except Exception as e: fail(f"chain is not JSON: {e}")
    if not isinstance(chain, list) or not chain: fail("chain must be a non-empty JSON array")
    board = build_board(chain)
    x, sr = read_audio(a.inp)
    y = board(x, sr)
    write_audio(a.out, y, sr)
    out({"ok": True, "out": a.out, "peakDbfs": peak_dbfs(y), "inPeakDbfs": peak_dbfs(x), "sampleRate": sr, "steps": len(chain)})

def integrated_lufs(x, sr):
    import pyloudnorm as pyln, numpy as np
    meter = pyln.Meter(sr)
    data = x.T if x.shape[0] <= 2 else x
    try: return float(meter.integrated_loudness(data))
    except Exception: return float("nan")

def cmd_master(a):
    import numpy as np, pedalboard as pb
    x, sr = read_audio(a.inp)
    lufs_in = integrated_lufs(x, sr)
    # gentle bus compression, then gain to target, then true-peak-ish limiter
    board = pb.Pedalboard([pb.Compressor(threshold_db=-14, ratio=2.0, attack_ms=10, release_ms=120)])
    y = board(x, sr)
    lufs_mid = integrated_lufs(y, sr)
    gain = (a.lufs - lufs_mid) if np.isfinite(lufs_mid) else 0.0
    gain = float(max(-24.0, min(24.0, gain)))
    y = pb.Pedalboard([pb.Gain(gain_db=gain), pb.Limiter(threshold_db=-1.0, release_ms=80)])(y, sr)
    lufs_out = integrated_lufs(y, sr)
    write_audio(a.out, y, sr)
    out({"ok": True, "out": a.out, "targetLufs": a.lufs, "lufsIn": None if not np.isfinite(lufs_in) else round(lufs_in, 2), "lufs": None if not np.isfinite(lufs_out) else round(lufs_out, 2), "gainDb": round(gain, 2), "peakDbfs": peak_dbfs(y), "sampleRate": sr})

def cmd_versions(a):
    import importlib
    v = {}
    for p in ["numpy", "librosa", "torch", "demucs", "basic_pitch", "pedalboard", "soundfile", "pyloudnorm"]:
        try: v[p] = importlib.import_module(p).__version__
        except Exception as e: v[p] = f"ERROR {e}"
    out({"ok": True, "python": sys.version.split()[0], "versions": v})

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("stems"); s.add_argument("--in", dest="inp", required=True); s.add_argument("--out", required=True); s.add_argument("--model", default="htdemucs"); s.add_argument("--two-stems", dest="two_stems"); s.add_argument("--segment", type=float, default=7.0); s.set_defaults(fn=cmd_stems)
    s = sub.add_parser("analyze"); s.add_argument("--in", dest="inp", required=True); s.set_defaults(fn=cmd_analyze)
    s = sub.add_parser("transcribe"); s.add_argument("--in", dest="inp", required=True); s.add_argument("--onset", type=float, default=0.5); s.add_argument("--frame", type=float, default=0.3); s.add_argument("--min-note-ms", dest="min_note_ms", type=float, default=60); s.add_argument("--out"); s.set_defaults(fn=cmd_transcribe)
    s = sub.add_parser("process"); s.add_argument("--in", dest="inp", required=True); s.add_argument("--out", required=True); s.add_argument("--chain", required=True); s.set_defaults(fn=cmd_process)
    s = sub.add_parser("master"); s.add_argument("--in", dest="inp", required=True); s.add_argument("--out", required=True); s.add_argument("--lufs", type=float, default=-12.0); s.set_defaults(fn=cmd_master)
    s = sub.add_parser("versions"); s.set_defaults(fn=cmd_versions)
    for p in sub.choices.values(): p.add_argument("--json", action="store_true", help="(always JSON; accepted for compatibility)")
    a = ap.parse_args()
    if getattr(a, "inp", None) and not os.path.exists(a.inp): fail(f"input not found: {a.inp}")
    try:
        a.fn(a)
    except SystemExit: raise
    except Exception as e:
        import traceback; traceback.print_exc(file=sys.stderr)
        fail(f"{type(e).__name__}: {e}")

if __name__ == "__main__":
    main()
