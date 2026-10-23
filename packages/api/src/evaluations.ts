import { FilterLogEventsCommand, type CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import type { EvalResult } from "./types.js";

export interface EvaluationsDeps {
  logs: Pick<CloudWatchLogsClient, "send">;
  logGroup: string;
  lookbackMs?: number;
}

function pick(obj: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}

/**
 * One online-evaluation result record (OTel GenAI evaluation event conventions) → one board row.
 * Field names are looked up under several spellings because the record format is documented as "follows OTel conventions".
 */
export function parseEvaluationRecord(message: string, at: string): EvalResult | undefined {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(message) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const attrs = (d.attributes as Record<string, unknown> | undefined) ?? d;
  const evaluator = pick(attrs, ["gen_ai.evaluation.name", "evaluatorName", "evaluator_name", "evaluatorId"]);
  if (typeof evaluator !== "string") return undefined;
  const value = pick(attrs, ["gen_ai.evaluation.score.value", "value", "score"]);
  const label = pick(attrs, ["gen_ai.evaluation.score.label", "label"]);
  const explanation = pick(attrs, ["gen_ai.evaluation.explanation", "explanation"]);
  const out: EvalResult = { evaluator, label: typeof label === "string" ? label : "", at };
  if (typeof value === "number") out.value = value;
  if (typeof explanation === "string") out.explanation = explanation;
  return out;
}

/** The board polls this; it must never throw and never block Approve. */
export async function listEvaluations(deps: EvaluationsDeps, sessionId: string): Promise<EvalResult[]> {
  if (!deps.logGroup) return [];
  try {
    const res = await deps.logs.send(
      new FilterLogEventsCommand({
        logGroupName: deps.logGroup,
        filterPattern: `"${sessionId}"`,
        startTime: Date.now() - (deps.lookbackMs ?? 6 * 3600_000),
        limit: 100,
      }),
    );
    const out: EvalResult[] = [];
    for (const e of res.events ?? []) {
      const r = parseEvaluationRecord(e.message ?? "", new Date(e.timestamp ?? Date.now()).toISOString());
      if (r) out.push(r);
    }
    return out;
  } catch (err) {
    console.error("listEvaluations failed", err instanceof Error ? err.message : err);
    return [];
  }
}
