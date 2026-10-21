import { useEffect, useRef, useState } from "react"

import { ApiError, upload } from "../api/client.ts"
import { postTurn } from "../conversation/postTurn.ts"
import { applyCorrection, fileProblem, fileKind, inputTypeFor, keyPhrase } from "../input/describe.ts"
import { registerInput } from "../input/bridge.ts"
import type { AudioFeatures } from "../types/audio_features.ts"
import type { InputType } from "../types/input_type.ts"
import { useStudio } from "../state/studio.ts"
import { Button } from "./Button.tsx"
import { RecognitionCard } from "./RecognitionCard.tsx"
import { VuMeter } from "./VuMeter.tsx"

type Held = {
  file: File
  inputType: InputType
}

export function InputPanel() {
  const [text, setText] = useState("")
  const [held, setHeld] = useState<Held | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [features, setFeatures] = useState<AudioFeatures | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [keyText, setKeyText] = useState("")
  const [tempoText, setTempoText] = useState("")
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const contextRef = useRef<AudioContext | null>(null)
  const startedRef = useRef(0)
  const timerRef = useRef(0)
  const textRef = useRef("")
  const heldRef = useRef<Held | null>(null)
  const featuresRef = useRef<AudioFeatures | null>(null)
  const recordingRef = useRef(false)
  const waitingRef = useRef(false)
  const fixingRef = useRef(false)
  const keyTextRef = useRef("")
  const tempoTextRef = useRef("")
  const submitRef = useRef<() => Promise<"sent" | "confirm" | "blocked">>(async () => "blocked")
  const confirmRef = useRef<() => Promise<void>>(async () => undefined)

  function markRecording(value: boolean) {
    recordingRef.current = value
    setRecording(value)
  }

  function markWaiting(value: boolean) {
    waitingRef.current = value
    setWaiting(value)
  }

  function markFixing(value: boolean) {
    fixingRef.current = value
    setFixing(value)
  }

  function rememberFeatures(next: AudioFeatures | null) {
    featuresRef.current = next
    setFeatures(next)
  }

  function release() {
    window.clearInterval(timerRef.current)
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null
      recorder.stop()
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    const context = contextRef.current
    contextRef.current = null
    void context?.close()
  }

  useEffect(() => {
    return () => release()
  }, [])

  function acceptFile(file: File, source: "drop" | "recording") {
    const problem = fileProblem(file)
    if (problem) {
      setFileNote(problem)
      return
    }
    const kind = fileKind(file)
    if (kind === "other") return
    setFileNote(null)
    setError(null)
    rememberFeatures(null)
    markWaiting(false)
    markFixing(false)
    const next = { file, inputType: inputTypeFor(kind, source) }
    heldRef.current = next
    setHeld(next)
  }

  function clearHeld() {
    heldRef.current = null
    setHeld(null)
    rememberFeatures(null)
    markWaiting(false)
    markFixing(false)
    setFileNote(null)
    if (fileInput.current) fileInput.current.value = ""
  }

  async function startRecording() {
    setError(null)
    setFileNote(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Recording needs this page on localhost or a secure address.")
      return
    }
    const context = new AudioContext()
    contextRef.current = context
    void context.resume()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const choice = recorderChoice()
      const recorder = choice.mime ? new MediaRecorder(stream, { mimeType: choice.mime }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const mime = recorder.mimeType || choice.mime || "audio/webm"
        const blob = new Blob(chunksRef.current, { type: mime })
        acceptFile(new File([blob], nameForMime(mime), { type: mime }), "recording")
        release()
        markRecording(false)
        setLevel(0)
      }
      void context.resume()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      startedRef.current = Date.now()
      setElapsed(0)
      timerRef.current = window.setInterval(() => {
        setElapsed(Date.now() - startedRef.current)
        try {
          analyser.getFloatTimeDomainData(samples)
        } catch {
          return
        }
        let sum = 0
        for (const sample of samples) sum += sample * sample
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 8))
      }, 50)
      recorder.start(200)
      markRecording(true)
    } catch (err) {
      release()
      markRecording(false)
      setError(micMessage(err))
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.stop()
      return
    }
    release()
    markRecording(false)
    setLevel(0)
  }

  async function sendTurn(audio?: AudioFeatures) {
    await postTurn({
      text: textRef.current.trim() || undefined,
      audio_features: audio,
    })
    markWaiting(false)
    rememberFeatures(audio ?? null)
  }

  async function submit(): Promise<"sent" | "confirm" | "blocked"> {
    if (recordingRef.current || waitingRef.current) return "blocked"
    const currentText = textRef.current
    const currentHeld = heldRef.current
    if (!currentText.trim() && !currentHeld) {
      setHint("Write a line, or add a sound, before sending.")
      return "blocked"
    }
    setHint(null)
    setError(null)
    setBusy(true)
    useStudio.getState().setStatus("working")
    try {
      let audio = featuresRef.current ?? undefined
      if (currentHeld) {
        audio = await upload({
          session_id: useStudio.getState().sessionId,
          input_type: currentHeld.inputType,
          file: currentHeld.file,
        })
        rememberFeatures(audio)
        if (audio.confidence < 0.6) {
          markWaiting(true)
          markFixing(false)
          keyTextRef.current = keyPhrase(audio)
          tempoTextRef.current = typeof audio.bpm === "number" ? String(Math.round(audio.bpm)) : ""
          setKeyText(keyTextRef.current)
          setTempoText(tempoTextRef.current)
          useStudio.getState().setStatus("idle")
          return "confirm"
        }
      }
      await sendTurn(audio)
      return "sent"
    } catch (err) {
      useStudio.getState().setStatus("error")
      setError(err instanceof ApiError ? plainFailure(err.message) : "That did not go through. Try sending it again.")
      return "blocked"
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    const audio = featuresRef.current
    if (!audio) return
    setBusy(true)
    useStudio.getState().setStatus("working")
    setError(null)
    try {
      const next = fixingRef.current ? applyCorrection(audio, keyTextRef.current, tempoTextRef.current) : audio
      rememberFeatures(next)
      await sendTurn(next)
      markFixing(false)
    } catch (err) {
      useStudio.getState().setStatus("error")
      setError(err instanceof ApiError ? plainFailure(err.message) : "That did not go through. Try sending it again.")
    } finally {
      setBusy(false)
    }
  }

  function apply(nextText: string, file: File | null) {
    release()
    markRecording(false)
    setLevel(0)
    setElapsed(0)
    textRef.current = nextText
    setText(nextText)
    setHint(null)
    setError(null)
    setFileNote(null)
    rememberFeatures(null)
    markWaiting(false)
    markFixing(false)
    keyTextRef.current = ""
    tempoTextRef.current = ""
    setKeyText("")
    setTempoText("")
    if (file) {
      const next = { file, inputType: inputTypeFor("audio", "drop") }
      heldRef.current = next
      setHeld(next)
    } else {
      heldRef.current = null
      setHeld(null)
    }
    if (fileInput.current) fileInput.current.value = ""
  }

  useEffect(() => {
    submitRef.current = submit
    confirmRef.current = confirm
  })

  useEffect(() => {
    registerInput({
      apply,
      submit: () => submitRef.current(),
      confirm: () => confirmRef.current(),
    })
    return () => registerInput(null)
  }, [])

  const invite = !hint && !text.trim() && !held && !features && !recording

  return (
    <div className="flex flex-col gap-3">
      <h2>Input</h2>
      {invite ? <p className="text-sm text-dust">Write a line, drop a loop, or press Record.</p> : null}
      <label className="sr-only" htmlFor="idea">
        The idea
      </label>
      <textarea
        id="idea"
        value={text}
        rows={5}
        placeholder="a rainy night drive, missing someone"
        aria-invalid={hint ? true : undefined}
        aria-describedby={hint ? "idea-hint" : undefined}
        onChange={(event) => {
          textRef.current = event.target.value
          setText(event.target.value)
          if (hint) setHint(null)
        }}
        className="min-h-36 w-full resize-y rounded-panel border border-walnut-line bg-studio-night/40 px-3 py-3 text-base text-tape-cream outline-none placeholder:text-dust focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
      />
      {hint ? (
        <p id="idea-hint" role="status" className="text-sm text-dust">
          {hint}
        </p>
      ) : null}
      <div
        className={`rounded-panel border border-dashed px-3 py-4 text-center ${dragging ? "border-vu-amber" : "border-walnut-line"}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (file) acceptFile(file, "drop")
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".wav,.mp3,.m4a,.webm,.mid,.midi,audio/wav,audio/mpeg,audio/mp4,audio/webm,audio/midi"
          className="sr-only"
          aria-label="Choose a sound file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) acceptFile(file, "drop")
          }}
        />
        <button
          type="button"
          className="text-sm text-tape-cream underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
          onClick={() => fileInput.current?.click()}
        >
          Drop a wav, mp3, m4a, webm, or MIDI file
        </button>
        {held ? (
          <p className="mt-2 text-sm text-dust">
            {held.file.name}{" "}
            <button
              type="button"
              aria-label="Remove the file"
              className="text-tape-cream underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vu-amber"
              onClick={clearHeld}
            >
              Remove
            </button>
          </p>
        ) : null}
        {fileNote ? (
          <p role="status" className="mt-2 text-sm text-dust">
            {fileNote}
          </p>
        ) : null}
      </div>
      {recording ? (
        <div className="flex items-center gap-3">
          <VuMeter value={level} label="Input level" />
          <p className="text-sm text-tape-cream tabular-nums" aria-live="polite">
            {formatElapsed(elapsed)}
          </p>
          <Button tone="secondary" onClick={stopRecording}>
            Stop
          </Button>
        </div>
      ) : (
        <Button tone="secondary" onClick={() => void startRecording()} disabled={busy}>
          Record
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-clip-red">
          {error}
        </p>
      ) : null}
      {features ? (
        <RecognitionCard
          features={features}
          fixing={fixing}
          keyText={keyText}
          tempoText={tempoText}
          onKeyText={(value) => {
            keyTextRef.current = value
            setKeyText(value)
          }}
          onTempoText={(value) => {
            tempoTextRef.current = value
            setTempoText(value)
          }}
          onFix={() => markFixing(true)}
          onConfirm={() => void confirm()}
          busy={busy}
          ask={waiting}
        />
      ) : null}
      <Button onClick={() => void submit()} disabled={busy || recording || waiting}>
        Send the idea
      </Button>
    </div>
  )
}

function recorderChoice(): { mime: string } {
  if (typeof MediaRecorder === "undefined") return { mime: "" }
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return { mime: "audio/webm;codecs=opus" }
  if (MediaRecorder.isTypeSupported("audio/webm")) return { mime: "audio/webm" }
  if (MediaRecorder.isTypeSupported("audio/mp4")) return { mime: "audio/mp4" }
  return { mime: "" }
}

function nameForMime(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a")) return "take.m4a"
  if (mime.includes("wav")) return "take.wav"
  return "take.webm"
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function micMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ""
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Allow the microphone for this site, then press Record again."
  }
  if (name === "NotFoundError") {
    return "No microphone is connected. Plug one in, or drop a file instead."
  }
  if (name === "NotReadableError") {
    return "The microphone is busy in another app. Close that app, then press Record again."
  }
  if (name === "SecurityError") {
    return "Recording needs this page on localhost or a secure address."
  }
  return "The microphone did not start. Press Record again, or drop a file."
}

function plainFailure(message: string): string {
  const trimmed = message.trim()
  if (trimmed && trimmed.length < 160 && !/traceback|exception/i.test(trimmed)) return trimmed
  return "That did not go through. Try sending it again."
}
