import { useEffect, useRef, useState } from "react"
import { ArrowUp, Mic, Paperclip } from "lucide-react"

import { ApiError, upload } from "../../api/client.ts"
import { registerDemo, registerQuick } from "../../composer/examples.ts"
import { setComposerRecording } from "../../composer/recording.ts"
import { inFlight } from "../../conversation/flight.ts"
import { postTurn } from "../../conversation/postTurn.ts"
import { runScenario } from "../../demo/runScenario.ts"
import { features as flags } from "../../features.ts"
import { registerInput } from "../../input/bridge.ts"
import type { ReadingPatch } from "../../input/bridge.ts"
import { applyCorrection, describeFeatures, fileKind, fileProblem, inputTypeFor, keyPhrase } from "../../input/describe.ts"
import { noteIdea } from "../../recentIdeas.ts"
import { useStudio } from "../../state/studio.ts"
import type { AudioFeatures } from "../../types/audio_features.ts"
import type { InputType } from "../../types/input_type.ts"
import { Button } from "../Button.tsx"

type Held = {
  file: File
  inputType: InputType
}

type Props = {
  started: boolean
  onBegin: () => void
  onBubble: (text: string) => void
  onExchange: (question: string, answer: string) => void
}

export function Composer({ started, onBegin, onBubble, onExchange }: Props) {
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
  const sendingRef = useRef(false)
  const echoedRef = useRef("")
  const fixingRef = useRef(false)
  const keyTextRef = useRef("")
  const tempoTextRef = useRef("")
  const submitRef = useRef<() => Promise<"sent" | "confirm" | "blocked">>(async () => "blocked")
  const confirmRef = useRef<() => Promise<void>>(async () => undefined)
  const onBeginRef = useRef(onBegin)
  const onBubbleRef = useRef(onBubble)
  const onExchangeRef = useRef(onExchange)
  const turned = useStudio((state) => state.turn !== null)
  const working = useStudio((state) => state.status === "working")

  function markRecording(value: boolean) {
    recordingRef.current = value
    setRecording(value)
    setComposerRecording(value)
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
    return () => {
      setComposerRecording(false)
      release()
    }
  }, [])

  useEffect(() => {
    const field = areaRef.current
    if (!field) return
    field.style.height = "auto"
    const next = Math.min(field.scrollHeight, 14 * 1.45 * 6)
    field.style.height = `${Math.max(next, 14 * 1.45 * 2)}px`
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
    const posted = await postTurn({
      text: textRef.current.trim() || undefined,
      audio_features: audio,
    })
    if (!posted) return false
    markWaiting(false)
    rememberFeatures(audio ?? null)
    return true
  }

  async function answerQuestion(value: string) {
    const current = useStudio.getState().turn
    if (current?.status !== "question" || !current.question) return false
    const posted = await postTurn({ answer: { slot: current.question.slot, action: "answer", value } })
    return posted
  }

  function showIdea(label: string) {
    const trimmed = label.trim()
    if (!trimmed || echoedRef.current === trimmed) return
    echoedRef.current = trimmed
    onBubbleRef.current(trimmed)
  }

  async function submit(): Promise<"sent" | "confirm" | "blocked"> {
    if (sendingRef.current || inFlight() || recordingRef.current || waitingRef.current) return "blocked"
    if (useStudio.getState().status === "working") return "blocked"
    const currentText = textRef.current
    const currentHeld = heldRef.current
    const openQuestion = useStudio.getState().turn?.status === "question"
    if (!currentText.trim() && !currentHeld) {
      if (!openQuestion) setHint("Write a line, or add a sound, before sending.")
      return "blocked"
    }
    sendingRef.current = true
    setHint(null)
    setError(null)
    setBusy(true)
    useStudio.getState().setStatus("working")
    onBeginRef.current()
    const answering = openQuestion && currentText.trim().length > 0 && !currentHeld
    if (!answering) showIdea(currentText.trim() || currentHeld?.file.name || "A sound")
    try {
      if (openQuestion && currentText.trim() && !currentHeld) {
        const asked = useStudio.getState().turn
        const questionText = asked?.status === "question" ? (asked.question?.text ?? "") : ""
        const value = currentText.trim()
        const answered = await answerQuestion(value)
        if (!answered) return "blocked"
        if (questionText) onExchangeRef.current(questionText, value)
        echoedRef.current = ""
        textRef.current = ""
        setText("")
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
          return "confirm"
        }
      }
      const said = currentText.trim()
      noteIdea(said, said.length === 0)
      const posted = await sendTurn(audio)
      if (!posted) return "blocked"
      echoedRef.current = ""
      textRef.current = ""
      setText("")
      return "sent"
    } catch (err) {
      useStudio.getState().setStatus("error")
      setError(err instanceof ApiError ? plainFailure(err.message) : "That did not go through. Try sending it again.")
      return "blocked"
    } finally {
      sendingRef.current = false
      setBusy(false)
    }
  }

  async function confirm() {
    const audio = featuresRef.current
    if (!audio || sendingRef.current || inFlight() || useStudio.getState().status === "working") return
    sendingRef.current = true
    setBusy(true)
    useStudio.getState().setStatus("working")
    setError(null)
    try {
      const next = fixingRef.current ? applyCorrection(audio, keyTextRef.current, tempoTextRef.current) : audio
      rememberFeatures(next)
      const said = textRef.current.trim()
      noteIdea(said, said.length === 0)
      const posted = await sendTurn(next)
      if (!posted) return
      markFixing(false)
      echoedRef.current = ""
      textRef.current = ""
      setText("")
    } catch (err) {
      useStudio.getState().setStatus("error")
      setError(err instanceof ApiError ? plainFailure(err.message) : "That did not go through. Try sending it again.")
    } finally {
      sendingRef.current = false
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
    onExchangeRef.current = onExchange
  })

  function revise(patch: ReadingPatch) {
    if (patch.fixing !== undefined) markFixing(patch.fixing)
    if (patch.key !== undefined) {
      keyTextRef.current = patch.key
      setKeyText(patch.key)
    }
    if (patch.tempo !== undefined) {
      tempoTextRef.current = patch.tempo
      setTempoText(patch.tempo)
    }
  }

  useEffect(() => {
    registerInput({
      apply,
      submit: () => submitRef.current(),
      confirm: () => confirmRef.current(),
      revise,
    })
    return () => registerInput(null)
  }, [])

  async function runDemo() {
    setDemoError(null)
    try {
      await runScenario("rainy")
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : "The demo did not finish.")
    }
  }

  async function quick(next: string) {
    apply(next, null)
    await submitRef.current()
  }

  const quickRef = useRef(quick)
  const demoRef = useRef(runDemo)

  useEffect(() => {
    quickRef.current = quick
    demoRef.current = runDemo
  })

  useEffect(() => {
    const node = areaRef.current
    if (!node) return
    node.style.height = "auto"
    node.style.height = `${Math.min(node.scrollHeight, 14 * 1.45 * 6)}px`
  }, [text])

  useEffect(() => {
    registerQuick((next) => {
      void quickRef.current(next)
    })
    registerDemo(() => {
      void demoRef.current()
    })
    return () => {
      registerQuick(null)
      registerDemo(null)
    }
  }, [])

  const confirmLabel = error && waiting ? "Try again" : "Confirm this reading"
  const unsure = waiting && features !== null && features.confidence < 0.6

  useEffect(() => {
    if (!features) {
      useStudio.getState().setReading(null)
      return
    }
    useStudio.getState().setReading({
      text: describeFeatures(features),
      unsure,
      fixing,
      key: keyText,
      tempo: tempoText,
      confirmLabel,
    })
  }, [features, unsure, fixing, keyText, tempoText, confirmLabel])

  return (
    <div className={`canvas-column flex flex-col gap-4 ${started ? "pb-4" : ""}`}>
      <form
        data-tour="composer"
        className={`composer-shell flex flex-col gap-2 p-2 ${dragging ? "outline outline-1 outline-accent" : ""}`}
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
        <IdeaMode />
        <div className="flex items-end gap-2">
          <div className="flex shrink-0 items-center">
            <input
              ref={fileInput}
              type="file"
              accept=".wav,.mp3,.m4a,.webm,audio/wav,audio/mpeg,audio/mp4,audio/webm"
              className="sr-only"
              aria-label="Choose a sound file"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) acceptFile(file, "drop")
              }}
            />
            <button type="button" aria-label="Attach a sound" title="Attach a sound" className="square-btn" onClick={() => fileInput.current?.click()}>
              <Paperclip aria-hidden="true" size={16} />
              <span className="sr-only">Attach</span>
            </button>
            {flags.record ? (
              <button type="button" aria-label="Record" title="Record" className="square-btn" onClick={() => void startRecording()} disabled={busy || recording}>
                <Mic aria-hidden="true" size={16} />
                <span className="sr-only">Record</span>
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
            placeholder={turned ? "Answer, or add a detail" : "a rainy night drive, missing someone"}
            aria-invalid={hint ? true : undefined}
            aria-describedby={hint ? "idea-hint" : undefined}
            onChange={(event) => {
              textRef.current = event.target.value
              setText(event.target.value)
              if (hint) setHint(null)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
              if (sendingRef.current || inFlight() || busy || recording || useStudio.getState().status === "working") {
                event.preventDefault()
                return
              }
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }}
            className="composer-input w-full bg-transparent py-1 text-ink outline-none placeholder:text-muted"
          />
          <div className="shrink-0">
            {waiting ? null : error ? (
              <Button onClick={() => void submit()} disabled={working}>
                Try again
              </Button>
            ) : (
              <button type="submit" aria-label="Send the idea" title="Send the idea" disabled={busy || recording || working} className="send-btn">
                <ArrowUp aria-hidden="true" size={16} />
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
          <div className="flex items-center gap-2 px-2">
            <span className="rec-led" style={{ opacity: 0.25 + level * 0.75 }} aria-hidden />
            <p className="mono text-[13px] text-ink" aria-live="polite">
              {formatElapsed(elapsed)}
            </p>
            <button type="button" className="text-[13px] text-ink" onClick={stopRecording}>
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
      {demoError ? (
        <p role="alert" className="text-danger">
          {demoError}
        </p>
      ) : null}
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

function IdeaMode() {
  const mode = useStudio((state) => state.mode)
  const setMode = useStudio((state) => state.setMode)
  return (
    <div className="segment" role="group" aria-label="Idea shape">
      <button type="button" aria-pressed={mode === "full"} onClick={() => setMode("full")}>
        A full idea
      </button>
      <button type="button" aria-pressed={mode === "one_sound"} onClick={() => setMode("one_sound")}>
        One sound
      </button>
    </div>
  )
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
