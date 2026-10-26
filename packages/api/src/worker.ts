import { randomBytes } from "node:crypto";
import { parseEvidenceReview, type GroundedAnswer } from "@lakehouse/shared";
import type { EvidenceVerdict, Question, QuestionStore } from "./types.js";
import { evidenceToText, validateAnswer, type GroundingInput, type GroundingVerdict } from "./validate.js";

/** What the runtime returns for POST /invocations (mirrors packages/agent/src/types.ts). */
export type AgentResponse = { answer: unknown } | { refusal: string; errors: string[]; failed?: boolean };

/** What the evidence runtime returns for POST /invocations { question, answer }. */
export type ReviewResponse = { review: unknown } | { refusal: string; errors: string[]; failed?: boolean };

export interface WorkerDeps {
  store: QuestionStore;
  invokeAgent: (id: string, question: string) => Promise<AgentResponse>;
  grounding: (input: GroundingInput) => Promise<GroundingVerdict>;
  /** The evidence agent. Without it (tests, older stacks) answers go to the board unreviewed. */
  reviewEvidence?: (id: string, question: string, answer: GroundedAnswer) => Promise<ReviewResponse>;
  /** Posts the approved answer (GitHub comment) and returns its URL. */
  publish?: (q: Question) => Promise<string>;
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
 * The slow path, as steps of the Step Functions state machine in infra/workflow.tf: answer, ground, verify, wait for a
 * human, publish or reject. Each step reads and writes the question in DynamoDB; only the id travels between states.
 * The in-step deadlines sit under the state timeouts, so a hung agent call lands as `failed` or `denied`, not as a timeout.
 */
const DEFAULT_DEADLINE_MS = 200_000;
const REVIEW_DEADLINE_MS = 180_000;

/**
 * Ask the evidence agent to reproduce every verified claim, and validate its review here too. Fail closed: a review that
 * is missing, late or malformed denies the answer, because nothing was proven.
 */
async function review(deps: WorkerDeps, id: string, question: string, answer: GroundedAnswer, deadlineMs: number): Promise<EvidenceVerdict | undefined> {
  if (!deps.reviewEvidence || !answer.claims.some((c) => c.status === "verified")) return undefined;
  const denied = (error: string): EvidenceVerdict => ({ overall: "denied", verdicts: [], error });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      deps.reviewEvidence(id, question, answer),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`The evidence agent did not answer within ${Math.round(deadlineMs / 1000)} s.`)), deadlineMs); }),
    ]);
    if ("refusal" in res) return denied(res.errors.join("; ") || res.refusal);
    const parsed = parseEvidenceReview(res.review, answer);
    return parsed.ok ? parsed.review : denied(`Review violated its contract: ${parsed.errors.join("; ")}`);
  } catch (err) {
    return denied(err instanceof Error ? err.message : String(err));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type StepOptions = { deadlineMs?: number; reviewDeadlineMs?: number };

async function load(deps: WorkerDeps, id: string): Promise<Question> {
  const q = await deps.store.getQuestion(id);
  if (!q) throw new Error(`question ${id} not found`);
  return q;
}

/**
 * Step 1 of the state machine: run the analyst and validate its answer where it is consumed.
 * `next` tells the state machine where to go: ground and verify an answer, straight to the human for a refusal, or stop.
 */
export async function answerStep(deps: WorkerDeps, id: string, opts: StepOptions = {}): Promise<{ next: "ground" | "decide" | "end" }> {
  const q = await load(deps, id);
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
        return { next: "end" };
      }
      const isContractExhaustion = /evidence contract/i.test(res.refusal) && res.errors.length > 0;
      const refusal = empty(q.question, res.refusal);
      await deps.store.updateQuestion(q.id, {
        answer: refusal,
        contract: isContractExhaustion ? { valid: false, errors: res.errors } : { valid: true, answer: refusal },
        grounding: { grounding: 1, relevance: 1, passed: true, action: "SKIPPED" },
        error: res.errors.join("; "),
        agentSeconds,
      });
      return { next: "decide" };
    }
    const contract = validateAnswer(res.answer);
    if (!contract.valid) {
      await deps.store.updateQuestion(q.id, { status: "failed", contract, error: `Contract violated: ${contract.errors.join("; ")}`, agentSeconds });
      return { next: "end" };
    }
    await deps.store.updateQuestion(q.id, { answer: contract.answer, contract: { valid: true, answer: contract.answer }, agentSeconds });
    return { next: "ground" };
  } catch (err) {
    await failStep(deps, q.id, err instanceof Error ? err.message : String(err));
    return { next: "end" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Step 2: Bedrock Guardrails contextual grounding of the summary against the evidence rows. */
export async function groundStep(deps: WorkerDeps, id: string): Promise<void> {
  const q = await load(deps, id);
  const a = q.answer;
  if (!a) throw new Error(`question ${id} has no answer to ground`);
  const grounding = await deps.grounding({ question: q.question, evidenceText: evidenceToText(a), summary: a.summary, claims: a.claims.map((c) => c.statement), refusals: a.refusals });
  await deps.store.updateQuestion(id, { grounding });
}

/** Step 3: the evidence agent reproduces every verified claim, or the answer is denied. */
export async function verifyStep(deps: WorkerDeps, id: string, opts: StepOptions = {}): Promise<void> {
  const q = await load(deps, id);
  if (!q.answer) throw new Error(`question ${id} has no answer to verify`);
  const evidence = await review(deps, q.id, q.question, q.answer, opts.reviewDeadlineMs ?? REVIEW_DEADLINE_MS);
  if (evidence) await deps.store.updateQuestion(id, { evidence });
}

/** Verify crashed or timed out as a state: fail closed, the human sees a denied answer and why. */
export async function denyStep(deps: WorkerDeps, id: string, error: string): Promise<void> {
  await deps.store.updateQuestion(id, { evidence: { overall: "denied", verdicts: [], error } });
}

/** Step 4: wait for a human. The task token is what Approve or Reject on the board hands back to the state machine. */
export async function awaitStep(deps: WorkerDeps, id: string, taskToken: string): Promise<void> {
  await deps.store.updateQuestion(id, { status: "needs_you", taskToken });
}

/** Step 5a: publish. The adapter checked before resuming; check again here, where the comment is actually posted. */
export async function publishStep(deps: WorkerDeps, id: string): Promise<void> {
  const q = await load(deps, id);
  if (!deps.publish) throw new Error("publishing is not configured");
  if (!q.publish) throw new Error("the asker opted out of publishing");
  if (q.evidence?.overall === "denied") throw new Error("the evidence agent denied this answer");
  const publishedUrl = await deps.publish(q);
  await deps.store.updateQuestion(id, { status: "published", publishedUrl });
}

/** Step 5b: a human (or the decision timeout) rejected the answer. */
export async function rejectStep(deps: WorkerDeps, id: string, reason: string): Promise<void> {
  await deps.store.updateQuestion(id, { status: "rejected", rejectReason: reason.slice(0, 200) });
}

/** Any step that failed: the state machine's Catch lands here, so the card says why instead of hanging in Working. */
export async function failStep(deps: WorkerDeps, id: string, error: string): Promise<void> {
  await deps.store.updateQuestion(id, { status: "failed", error });
}

/**
 * The state machine's path up to the human, in one call: answer, then ground and verify, then needs_you.
 * Production runs the same steps as Step Functions states (infra/workflow.tf); this is for tests and local runs.
 */
export async function runWorker(deps: WorkerDeps, event: { id: string }, opts: StepOptions = {}): Promise<void> {
  const { next } = await answerStep(deps, event.id, opts);
  if (next === "end") return;
  try {
    if (next === "ground") {
      await groundStep(deps, event.id);
      await verifyStep(deps, event.id, opts);
    }
    await deps.store.updateQuestion(event.id, { status: "needs_you" });
  } catch (err) {
    await failStep(deps, event.id, err instanceof Error ? err.message : String(err));
  }
}
