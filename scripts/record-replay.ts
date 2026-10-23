// Records board snapshots for replay mode. Usage: pnpm tsx scripts/record-replay.ts <minutes> [out=fixtures/replay.json]
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const minutes = Number(process.argv[2] ?? 12);
const out = process.argv[3] ?? "fixtures/replay.json";
const api = execSync("terraform -chdir=infra output -raw api_url").toString().trim();
const token = execSync("terraform -chdir=infra output -raw board_token").toString().trim();
const headers = { "x-board-token": token };

const frames: { at: string; questions: unknown[]; evaluations: Record<string, unknown[]> }[] = [];
const evals: Record<string, unknown[]> = {};
const end = Date.now() + minutes * 60_000;
let last = "";
while (Date.now() < end) {
  const questions = (await (await fetch(`${api}/questions`, { headers })).json()) as { id: string; status: string }[];
  for (const q of questions.filter((x) => ["needs_you", "published", "rejected"].includes(x.status))) {
    if ((evals[q.id]?.length ?? 0) >= 5) continue;
    const r = (await (await fetch(`${api}/questions/${q.id}/evaluations`, { headers })).json()) as unknown[];
    if (r.length) evals[q.id] = r;
  }
  const key = JSON.stringify({ questions, evals });
  if (key !== last) {
    frames.push({ at: new Date().toISOString(), questions, evaluations: structuredClone(evals) });
    last = key;
    writeFileSync(out, JSON.stringify(frames));
    console.log(`${frames.length} frames, ${questions.length} questions`);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`wrote ${out}`);
