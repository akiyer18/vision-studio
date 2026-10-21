import { useState } from "react"

import { fileName } from "../api/client.ts"
import { transport } from "../playback/transport.ts"
import { exportCurrent } from "../studio/renderSession.ts"
import { useStudio } from "../state/studio.ts"
import type { ExportListing } from "../state/studio.ts"
import { Button } from "./Button.tsx"
import { StepError, StepFrame } from "./StepCopy.tsx"

export function ExportStep() {
  const listing = useStudio((state) => state.exportListing)
  const exportError = useStudio((state) => state.exportError)
  const [pending, setPending] = useState(false)

  async function send() {
    setPending(true)
    await exportCurrent()
    setPending(false)
  }

  function startOver() {
    transport.stop()
    useStudio.getState().resetSession()
  }

  return (
    <StepFrame title="Export">
      <p className="max-w-xl text-dust">Variation 1 is used for any layer you did not pick.</p>
      {exportError ? (
        <StepError message={exportError} onRetry={() => void send()} />
      ) : (
        <Button disabled={pending} onClick={() => void send()}>
          Export to Logic
        </Button>
      )}
      {listing ? <ExportList listing={listing} /> : null}
      <Button tone="secondary" onClick={startOver}>
        Start a new idea
      </Button>
    </StepFrame>
  )
}

function ExportList({ listing }: { listing: ExportListing }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  async function copy() {
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(listing.folder)
      setCopied(true)
    } catch {
      setCopyError("The path could not be copied.")
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {listing.defaults ? <p className="text-dust">Nothing was picked, so variation 1 of each layer was exported.</p> : null}
      <p className="break-all text-lamp">{listing.folder}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button tone="secondary" onClick={() => void copy()}>
          Copy path
        </Button>
        {copied ? <span className="text-dust">Copied.</span> : null}
        {copyError ? (
          <p role="alert" className="text-fault">
            {copyError}
          </p>
        ) : null}
      </div>
      <ul aria-label="Exported files" className="flex flex-col gap-1">
        {listing.files.map((file) => (
          <li key={file} className="break-all text-dust">
            {fileName(file)}
          </li>
        ))}
      </ul>
    </div>
  )
}
