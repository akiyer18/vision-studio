delete process.env.ANTHROPIC_API_KEY; // force the rule-based path
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describeToPattern, PatternSchema } from "../lib/pattern.js";
import { patternToMidi } from "../lib/midi.js";

if (typeof zodOutputFormat !== "function") throw new Error("zodOutputFormat import broken");
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".tmp");
await mkdir(out, { recursive: true });

const cases = [
  "four on the floor with offbeat hats, 2 bars",
  "boom bap at 88 bpm with ghost snares",
  "trap hats, half-time snare, 140 bpm",
  "dembow",
  "breakbeat with a crash on 1",
  "something nice for my track",
];

let failed = 0;
for (const [i, description] of cases.entries()) {
  const { pattern, source } = await describeToPattern({ description, bpm: 120 });
  PatternSchema.parse(pattern);
  const maxStep = pattern.bars * 16 - 1;
  const hits = pattern.lanes.reduce((n, l) => n + l.steps.length, 0);
  const inRange = pattern.lanes.every((l) => l.steps.every((s) => s.step <= maxStep));
  for (const mapping of ["gm", "single"]) {
    const buf = patternToMidi(pattern, { mapping });
    const file = path.join(out, `test-${i}-${mapping}.mid`);
    await writeFile(file, buf);
    const ok = buf.subarray(0, 4).toString() === "MThd" && buf.length > 30 + hits * 6 && buf.length < 20000;
    if (!ok) failed++;
    console.log(`${ok ? "ok " : "FAIL"} ${file} ${buf.length}B`);
  }
  if (source !== "rules" || !inRange || hits === 0) failed++;
  console.log(`  "${description}" -> bpm ${pattern.bpm}, bars ${pattern.bars}, swing ${pattern.swing}, lanes ${pattern.lanes.map((l) => `${l.instrument}(${l.steps.length})`).join(" ")}, source ${source}`);
}
if (failed) { console.error(`${failed} failures`); process.exit(1); }
console.log("all pattern/midi tests passed");
