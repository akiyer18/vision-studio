import { ArrowUp, Headphones, ListChecks, Mic, Paperclip, Sparkles, Square } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { ApiError, upload } from "../../api/client.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { runScenario } from "../../demo/runScenario.ts"
import { features as flags } from "../../features.ts"
import { registerInput } from "../../input/bridge.ts"
import { applyCorrection, describeFeatures, fileKind, fileProblem, inputTypeFor, keyPhrase } from "../../input/describe.ts"
import { rememberIdea } from "../../recentIdeas.ts"
import { useStudio } from "../../state/studio.ts"
import type { AudioFeatures } from "../../types/audio_features.ts"
import type { InputType } from "../../types/input_type.ts"
import { Button } from "../Button.tsx"

type Held = {
  file: File
  inputType: InputType
}

const STARTS = [
  { label: "Rainy night drive", text: "a rainy night drive, missing someone" },
  { label: "Summer festival", text: "a summer festival" },
  { label: "Calm morning", text: "a calm morning" },
]

type Props = {
  started: boolean
  onBegin: () => void
  onBubble: (text: string) => void
}

export function Composer({ started, onBegin, onBubble }: Props) {
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
  const [demoBusy, setDemoBusy] = useState(false)
  const [demoError, setDemoError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
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
  const onBeginRef = useRef(onBegin)
  const onBubbleRef = useRef(onBubble)

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

  useEffect(() => {
    const field = areaRef.current
    if (!field) return
    field.style.height = "auto"
    const next = Math.min(field.scrollHeight, 15 * 1.5 * 6)
    field.style.height = `${Math.max(next, 15 * 1.5 * 2)}px`
  }, [text])

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

  async function answerQuestion(value: string) {
    const current = useStudio.getState().turn
    if (current?.status !== "question" || !current.question) return false
    await postTurn({ answer: { slot: current.question.slot, action: "answer", value } })
    return true
  }

  async function submit(): Promise<"sent" | "confirm" | "blocked"> {
    if (recordingRef.current || waitingRef.current) return "blocked"
    const currentText = textRef.current
    const currentHeld = heldRef.current
    const openQuestion = useStudio.getState().turn?.status === "question"
    if (!currentText.trim() && !currentHeld) {
      if (!openQuestion) setHint("Write a line, or add a sound, before sending.")
      return "blocked"
    }
    setHint(null)
    setError(null)
    setBusy(true)
    useStudio.getState().setStatus("working")
    try {
      if (openQuestion && currentText.trim() && !currentHeld) {
        const value = currentText.trim()
        await answerQuestion(value)
        onBubbleRef.current(value)
        textRef.current = ""
        setText("")
        onBeginRef.current()
        return "sent"
      }
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
          onBubbleRef.current(currentText.trim() || currentHeld.file.name)
          onBeginRef.current()
          return "confirm"
        }
      }
      const said = currentText.trim()
      await sendTurn(audio)
      if (said) rememberIdea(said)
      onBubbleRef.current(said || currentHeld?.file.name || "A sound")
      onBeginRef.current()
      textRef.current = ""
      setText("")
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
      const said = textRef.current.trim()
      await sendTurn(next)
      if (said) rememberIdea(said)
      markFixing(false)
      textRef.current = ""
      setText("")
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
    onBeginRef.current = onBegin
    onBubbleRef.current = onBubble
  })

  useEffect(() => {
    registerInput({
      apply,
      submit: () => submitRef.current(),
      confirm: () => confirmRef.current(),
    })
    return () => registerInput(null)
  }, [])

  async function runDemo() {
    setDemoError(null)
    setDemoBusy(true)
    try {
      await runScenario("rainy")
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : "The demo did not finish.")
    } finally {
      setDemoBusy(false)
    }
  }

  async function quick(next: string) {
    apply(next, null)
    await submitRef.current()
  }

  const confirmLabel = error && waiting ? "Try again" : "Confirm this reading"
  const unsure = waiting && features !== null && features.confidence < 0.6

  return (
    <div className={`canvas-column flex flex-col gap-4 ${started ? "pb-4" : ""}`}>
      {features ? (
        <div className="rounded-2xl border border-white/15 px-4 py-3">
          <p className="text-secondary">{describeFeatures(features)}</p>
          {unsure ? (
            <div className="mt-3 flex flex-col gap-3">
              {fixing ? (
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-muted" htmlFor="fix-key">
                    Key
                  </label>
                  <input
                    id="fix-key"
                    value={keyText}
                    onChange={(event) => {
                      keyTextRef.current = event.target.value
                      setKeyText(event.target.value)
                    }}
                    className="mono rounded-xl border border-white/15 bg-transparent px-3 py-2 text-ink outline-none"
                  />
                  <label className="text-sm text-muted" htmlFor="fix-tempo">
                    Tempo
                  </label>
                  <input
                    id="fix-tempo"
                    inputMode="decimal"
                    value={tempoText}
                    onChange={(event) => {
                      tempoTextRef.current = event.target.value
                      setTempoText(event.target.value)
                    }}
                    className="mono rounded-xl border border-white/15 bg-transparent px-3 py-2 text-ink outline-none"
                  />
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void confirm()} disabled={busy}>
                  {confirmLabel}
                </Button>
                {fixing ? null : (
                  <Button tone="secondary" onClick={() => markFixing(true)} disabled={busy}>
                    Fix the key or tempo
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <form
        data-tour="composer"
        className={`glass flex flex-col gap-2 p-2 ${dragging ? "outline outline-2 outline-accent" : ""}`}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
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
        <div className="flex items-end gap-2">
          <div className="flex shrink-0 items-center">
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
              aria-label="Attach a sound"
              className="inline-flex size-8 items-center justify-center rounded-full text-secondary"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={16} aria-hidden />
            </button>
            {flags.record ? (
              <button
                type="button"
                aria-label="Record"
                className="inline-flex size-8 items-center justify-center rounded-full text-secondary disabled:opacity-40"
                onClick={() => void startRecording()}
                disabled={busy || recording}
              >
                <Mic size={16} aria-hidden />
              </button>
            ) : null}
          </div>
          <label className="sr-only" htmlFor="idea">
            The idea
          </label>
          <textarea
            ref={areaRef}
            id="idea"
            value={text}
            rows={2}
            placeholder="a rainy night drive, missing someone"
            aria-invalid={hint ? true : undefined}
            aria-describedby={hint ? "idea-hint" : undefined}
            onChange={(event) => {
              textRef.current = event.target.value
              setText(event.target.value)
              if (hint) setHint(null)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }}
            className="composer-input w-full bg-transparent py-1 text-ink outline-none placeholder:text-muted"
          />
          <div className="shrink-0">
            {waiting ? null : error ? (
              <Button onClick={() => void submit()}>Try again</Button>
            ) : (
              <button
                type="submit"
                aria-label="Send the idea"
                disabled={busy || recording}
                className="btn-primary inline-flex size-8 items-center justify-center rounded-full bg-accent text-canvas disabled:opacity-40"
              >
                <ArrowUp size={16} aria-hidden />
                <span className="sr-only">Send the idea</span>
              </button>
            )}
          </div>
        </div>
        {hint ? (
          <p id="idea-hint" role="status" className="px-2 text-sm text-secondary">
            {hint}
          </p>
        ) : null}
        {held ? (
          <p className="mono px-2 text-sm text-secondary">
            {held.file.name}{" "}
            <button type="button" className="text-ink underline-offset-4 hover:underline" onClick={clearHeld}>
              Remove
            </button>
          </p>
        ) : null}
        {fileNote ? (
          <p role="status" className="px-2 text-sm text-secondary">
            {fileNote}
          </p>
        ) : null}
        {recording ? (
          <div className="flex items-center gap-3 px-2">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"
              role="meter"
              aria-label="Input level"
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={level}
            >
              <div className="h-full bg-accent" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <p className="text-sm text-ink tabular-nums" aria-live="polite">
              {formatElapsed(elapsed)}
            </p>
            <button type="button" className="inline-flex items-center gap-2 text-ink" onClick={stopRecording}>
              <Square size={14} aria-hidden />
              Stop
            </button>
          </div>
        ) : null}
      </form>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      {started ? null : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick start">
            {STARTS.map((item) => (
              <button
                key={item.label}
                type="button"
                className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-secondary"
                onClick={() => void quick(item.text)}
                disabled={demoBusy || busy || recording}
              >
                {item.label}
              </button>
            ))}
            {flags.demo ? (
              <button
                type="button"
                className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-secondary disabled:opacity-40"
                onClick={() => void runDemo()}
                disabled={demoBusy || busy || recording}
              >
                Try the demo
              </button>
            ) : null}
          </div>
          {demoError ? (
            <p role="alert" className="text-danger">
              {demoError}
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            <HowCard icon={Sparkles} title="Describe it" text="Write a feeling, or bring a sound." />
            <HowCard icon={ListChecks} title="Answer or skip" text="A few questions, or skip them all." />
            <HowCard icon={Headphones} title="Hear your layers" text="Build, listen, and pick a take." />
          </div>
        </>
      )}
    </div>
  )
}

function HowCard({ icon: Icon, title, text }: { icon: typeof Sparkles; title: string; text: string }) {
  return (
    <div className="how-card flex flex-col justify-center gap-1 rounded-2xl border border-white/10 bg-white/3 px-2">
      <div className="flex items-center gap-2">
        <Icon size={16} aria-hidden className="shrink-0 text-accent" />
        <p className="font-semibold whitespace-nowrap">{title}</p>
      </div>
      <p className="text-sm whitespace-nowrap text-secondary">{text}</p>
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
