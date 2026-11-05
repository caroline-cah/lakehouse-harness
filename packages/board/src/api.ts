import type { EvalResult, Question } from "./types.js";

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:3000";
const TOKEN = (import.meta.env.VITE_BOARD_TOKEN as string | undefined) ?? "";
export const REPLAY = (import.meta.env.VITE_REPLAY as string | undefined) ?? "";

const headers = { "x-board-token": TOKEN, "content-type": "application/json" };

export async function fetchQuestions(): Promise<Question[]> {
  const r = await fetch(`${API_URL}/questions`, { headers });
  if (!r.ok) throw new Error(`questions ${r.status}`);
  return (await r.json()) as Question[];
}

export async function fetchEvaluations(id: string): Promise<EvalResult[]> {
  const r = await fetch(`${API_URL}/questions/${id}/evaluations`, { headers });
  if (!r.ok) return [];
  return (await r.json()) as EvalResult[];
}

export async function decide(id: string, decision: "publish" | "reject", reason?: string): Promise<Question> {
  const r = await fetch(`${API_URL}/questions/${id}/${decision}`, {
    method: "POST",
    headers,
    body: JSON.stringify(reason ? { reason } : {}),
  });
  if (!r.ok)
    throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `${decision} ${r.status}`);
  return (await r.json()) as Question;
}
