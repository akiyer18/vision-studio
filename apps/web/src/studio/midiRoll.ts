export type RollNote = { pitch: number; start: number; end: number }

export function readRoll(data: Uint8Array): RollNote[] {
  if (data.length < 14 || text(data, 0, 4) !== "MThd") return []
  const ppq = (data[12] << 8) | data[13]
  if (ppq <= 0) return []
  const notes: RollNote[] = []
  let offset = 14
  while (offset + 8 <= data.length && text(data, offset, 4) === "MTrk") {
    const length = read32(data, offset + 4)
    const end = Math.min(data.length, offset + 8 + length)
    let tick = 0
    let status = 0
    let cursor = offset + 8
    const open = new Map<number, number>()
    while (cursor < end) {
      const delta = readVlq(data, cursor, end)
      cursor = delta.next
      tick += delta.value
      if (cursor >= end) break
      let command = data[cursor] ?? 0
      if (command >= 0x80) {
        status = command
        cursor += 1
        if (cursor >= end) break
        command = data[cursor] ?? 0
      }
      if (status === 0xff) {
        cursor += 1
        const size = readVlq(data, cursor, end)
        cursor = size.next + size.value
        continue
      }
      if (status === 0xf0 || status === 0xf7) {
        const size = readVlq(data, cursor, end)
        cursor = size.next + size.value
        continue
      }
      const kind = status & 0xf0
      if (kind === 0xc0 || kind === 0xd0) {
        cursor += 1
        continue
      }
      const data1 = command
      const data2 = data[cursor + 1] ?? 0
      cursor += 2
      if (kind === 0x90 && data2 > 0) open.set(data1, tick)
      if (kind === 0x80 || (kind === 0x90 && data2 === 0)) {
        const start = open.get(data1)
        if (start !== undefined) {
          notes.push({ pitch: data1, start: start / ppq, end: Math.max(start + 1, tick) / ppq })
          open.delete(data1)
        }
      }
    }
    offset = end
  }
  return notes
}

function text(data: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...data.slice(start, start + length))
}

function read32(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 24) | ((data[offset + 1] ?? 0) << 16) | ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0)
}

function readVlq(data: Uint8Array, offset: number, end: number): { value: number; next: number } {
  let value = 0
  let cursor = offset
  while (cursor < end) {
    const byte = data[cursor] ?? 0
    cursor += 1
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) break
  }
  return { value, next: cursor }
}
