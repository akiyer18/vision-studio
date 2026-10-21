export type TransportState = {
  mode: "idle" | "one" | "together"
  activeId: string | null
  togetherIds: string[]
  seconds: number
}

const idle: TransportState = { mode: "idle", activeId: null, togetherIds: [], seconds: 0 }

class Transport {
  private state: TransportState = idle
  private listeners = new Set<() => void>()
  private context: AudioContext | null = null
  private sources: AudioBufferSourceNode[] = []
  private request = 0
  private timer = 0
  private startedAt = 0
  private clips = new Map<string, string>()
  private buffers = new Map<string, Promise<AudioBuffer>>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = () => this.state

  register(id: string, url: string) {
    this.clips.set(id, url)
    return () => {
      if (this.clips.get(id) === url) this.clips.delete(id)
    }
  }

  prefetch(url: string) {
    void this.load(url, this.audio()).catch(() => undefined)
  }

  async playOne(id: string): Promise<void> {
    const url = this.clips.get(id)
    if (!url) throw new Error("missing")
    const context = this.audio()
    void context.resume()
    const ticket = this.claim()
    const buffer = await this.load(url, context)
    if (ticket !== this.request) return
    await this.start(ticket, context, [{ id, buffer }], "one")
  }

  async playTogether(ids: string[]): Promise<void> {
    if (ids.length === 0) throw new Error("missing")
    const context = this.audio()
    void context.resume()
    const ticket = this.claim()
    const loaded = (
      await Promise.all(
        ids.map(async (id) => {
          const url = this.clips.get(id)
          if (!url) return null
          try {
            return { id, buffer: await this.load(url, context) }
          } catch {
            return null
          }
        }),
      )
    ).filter((item): item is { id: string; buffer: AudioBuffer } => item !== null)
    if (ticket !== this.request) return
    if (loaded.length === 0) throw new Error("missing")
    await this.start(ticket, context, loaded, "together")
  }

  stop() {
    this.claim()
  }

  private claim(): number {
    this.request += 1
    this.halt()
    this.emit(idle)
    return this.request
  }

  private async start(
    ticket: number,
    context: AudioContext,
    items: { id: string; buffer: AudioBuffer }[],
    mode: "one" | "together",
  ) {
    await context.resume()
    if (ticket !== this.request) return
    const when = context.currentTime + 0.05
    let ended = 0
    this.sources = items.map((item) => {
      const source = context.createBufferSource()
      source.buffer = item.buffer
      source.connect(context.destination)
      source.start(when)
      source.onended = () => {
        if (ticket !== this.request) return
        ended += 1
        if (ended >= items.length) this.stop()
      }
      return source
    })
    this.startedAt = when
    this.emit({
      mode,
      activeId: mode === "one" ? items[0].id : null,
      togetherIds: mode === "together" ? items.map((item) => item.id) : [],
      seconds: 0,
    })
    this.timer = window.setInterval(() => {
      if (ticket !== this.request) return
      this.emit({ ...this.state, seconds: Math.max(0, context.currentTime - this.startedAt) })
    }, 50)
  }

  private halt() {
    window.clearInterval(this.timer)
    this.timer = 0
    const sources = this.sources
    this.sources = []
    for (const source of sources) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // The buffer had already finished.
      }
      source.disconnect()
    }
  }

  private audio(): AudioContext {
    if (!this.context) this.context = new AudioContext()
    return this.context
  }

  private load(url: string, context: AudioContext): Promise<AudioBuffer> {
    const existing = this.buffers.get(url)
    if (existing) return existing
    const pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error("missing")
      return context.decodeAudioData(await response.arrayBuffer())
    })
    this.buffers.set(url, pending)
    pending.catch(() => {
      if (this.buffers.get(url) === pending) this.buffers.delete(url)
    })
    return pending
  }

  private emit(next: TransportState) {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

export const transport = new Transport()
