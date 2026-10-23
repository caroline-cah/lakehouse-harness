import type { EvalResult, Question } from "./types.js";

/** One recorded snapshot of the board. fixtures/replay.json is an array of these, in time order. */
export interface Snapshot {
  at: string;
  questions: Question[];
  evaluations: Record<string, EvalResult[]>;
}

export async function loadReplay(url: string): Promise<Snapshot[]> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`replay ${r.status}`);
  return (await r.json()) as Snapshot[];
}

/** Plays snapshots with their original spacing (scaled by `speed`), calling `onFrame` for each. Returns a stop function. */
export function playReplay(frames: Snapshot[], onFrame: (s: Snapshot) => void, speed = 1): () => void {
  let i = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    const f = frames[i];
    if (!f) return;
    onFrame(f);
    const next = frames[i + 1];
    if (!next) return;
    const gap = Math.max(200, (Date.parse(next.at) - Date.parse(f.at)) / speed);
    i += 1;
    timer = setTimeout(tick, gap);
  };
  tick();
  return () => timer && clearTimeout(timer);
}
