import { randomBytes } from "node:crypto";
import type { GroundedAnswer } from "@lakehouse/shared";
import type { QuestionStore } from "./types.js";
import { evidenceToText, validateAnswer, type GroundingInput, type GroundingVerdict } from "./validate.js";

/** What the runtime returns for POST /invocations (mirrors packages/agent/src/types.ts). */
export type AgentResponse = { answer: unknown } | { refusal: string; errors: string[]; failed?: boolean };

export interface WorkerDeps {
  store: QuestionStore;
  invokeAgent: (id: string, question: string) => Promise<AgentResponse>;
  grounding: (input: GroundingInput) => Promise<GroundingVerdict>;
}

/**
 * A fresh, explicitly sampled trace for the runtime invocation. Without it, calls that originate inside Lambda
 * inherit a not-sampled X-Ray context and the agent's spans are never exported (verified 2026-10-22).
 * X-Ray trace ids embed the epoch in the first 8 hex chars, so the two headers are derived from one id.
 */
export function traceHeaders(now: number = Date.now()): { traceParent: string; traceId: string } {
  const epochHex = Math.floor(now / 1000).toString(16).padStart(8, "0");
  const rest = randomBytes(12).toString("hex");
  const traceId32 = `${epochHex}${rest}`;
  const spanId = randomBytes(8).toString("hex");
  return { traceParent: `00-${traceId32}-${spanId}-01`, traceId: `Root=1-${epochHex}-${rest};Sampled=1` };
}

const empty = (question: string, refusal: string): GroundedAnswer => ({ question, claims: [], evidence: [], summary: "", refusals: [refusal] });

/**
 * The slow path: run the agent, validate the answer where it is consumed, run the grounding check, store verdicts.
 * Never retried by Lambda (maximum_retry_attempts = 0), so a crash leaves the card in `working` for the board to show.
 */
const DEFAULT_DEADLINE_MS = 165_000; // under the worker Lambda's 180 s timeout, so a hung call still lands as `failed`

export async function runWorker(deps: WorkerDeps, event: { id: string }, opts: { deadlineMs?: number } = {}): Promise<void> {
  const q = await deps.store.getQuestion(event.id);
  if (!q) throw new Error(`question ${event.id} not found`);
  await deps.store.updateQuestion(q.id, { status: "working" });
  const started = Date.now();
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The agent did not answer within the ${Math.round(deadlineMs / 1000)} s deadline.`)), deadlineMs);
  });
  try {
    const res = await Promise.race([deps.invokeAgent(q.id, q.question), deadline]);
    const agentSeconds = Math.round((Date.now() - started) / 10) / 100;
    if ("refusal" in res) {
      if (res.failed) {
        // The runtime crashed (token, Bedrock, Gateway): not an answer, not a refusal.
        await deps.store.updateQuestion(q.id, { status: "failed", error: res.errors.join("; ") || res.refusal, agentSeconds });
        return;
      }
      const isContractExhaustion = /evidence contract/i.test(res.refusal) && res.errors.length > 0;
      const refusal = empty(q.question, res.refusal);
      await deps.store.updateQuestion(q.id, {
        status: "needs_you",
        answer: refusal,
        contract: isContractExhaustion ? { valid: false, errors: res.errors } : { valid: true, answer: refusal },
        grounding: { grounding: 1, relevance: 1, passed: true, action: "SKIPPED" },
        error: res.errors.join("; "),
        agentSeconds,
      });
      return;
    }
    const contract = validateAnswer(res.answer);
    if (!contract.valid) {
      await deps.store.updateQuestion(q.id, { status: "failed", contract, error: `Contract violated: ${contract.errors.join("; ")}`, agentSeconds });
      return;
    }
    const grounding = await deps.grounding({ question: q.question, evidenceText: evidenceToText(contract.answer), summary: contract.answer.summary, claims: contract.answer.claims.map((c) => c.statement), refusals: contract.answer.refusals });
    await deps.store.updateQuestion(q.id, { status: "needs_you", answer: contract.answer, contract: { valid: true, answer: contract.answer }, grounding, agentSeconds });
  } catch (err) {
    await deps.store.updateQuestion(q.id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
