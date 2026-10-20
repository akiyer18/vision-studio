import type { SongBrief } from "./types/song_brief.ts";
import type { TurnResponse } from "./types/turn_response.ts";

function slot(value: string) {
  return {
    value,
    source: "guessed" as const,
    reason: "default",
    confidence: 0.4,
  };
}

export const readyTurn = {
  status: "ready",
  brief: {
    slots: {
      output: slot("drums"),
      mood: slot("peaceful"),
      energy: slot("slow and breathing"),
      world: slot("warm and intimate"),
      key: slot("C major"),
      style: slot("none named"),
      palette: slot("piano"),
      structure: slot("8 bars"),
      must_keep: slot("nothing"),
    },
    output: ["drums"],
    questions_asked: 0,
    skipped: [],
  },
  prompts: [
    {
      layer: "drums",
      prompt: "TrackType: Instrument, soft brushed drum kit, 76 BPM",
      negative: "vocals",
      seeds: [1, 2, 3],
      kb_sources: ["peaceful", "warm and intimate"],
    },
  ],
  trace: [{ step: "defaults", detail: "filled from the peaceful preset" }],
} satisfies TurnResponse;

export const unknownSlots = {
  slots: {},
  output: [],
  questions_asked: 0,
  skipped: [],
} satisfies SongBrief;
