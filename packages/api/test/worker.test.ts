import { beforeEach, describe, expect, test } from "vitest";
import type { GroundedAnswer } from "@lakehouse/shared";
import { answerStep, awaitStep, publishStep, rejectStep, runWorker } from "../src/worker.js";
import { MemoryStore } from "./memory-store.js";

const answer: GroundedAnswer = {
  question: "Q",
  claims: [{ statement: "Göteborg led with 1059350.7 SEK", status: "verified", evidenceIds: ["q1"] }],
  evidence: [{ id: "q1", kind: "query", sql: "SELECT 1", query_execution_id: "qe", row_count: 1, columns: ["revenue"], sample: [{ revenue: "1059350.7" }] }],
  summary: "Göteborg led with 1059350.7 SEK.",
  refusals: [],
};
const ok = async () => ({ grounding: 0.9, relevance: 0.95, passed: true, action: "NONE" as const });

let store: MemoryStore;
beforeEach(async () => {
  store = new MemoryStore();
  await store.putQuestion({ id: "q-1", name: "Ida", question: "Q", publish: true, status: "asked", createdAt: "2026-10-22T10:00:00Z", updatedAt: "2026-10-22T10:00:00Z" });
});

describe("runWorker", () => {
  test("worker stores needs_you with verdicts", async () => {
    await runWorker({ store, invokeAgent: async () => ({ answer }), grounding: ok }, { id: "q-1" });
    expect(store.items[0]).toMatchObject({ status: "needs_you", contract: { valid: true }, grounding: { grounding: 0.9, passed: true } });
    expect(store.items[0]?.answer?.summary).toBe(answer.summary);
  });
  test("worker stores a refusal as needs_you with valid contract", async () => {
    await runWorker({ store, invokeAgent: async () => ({ refusal: "cannot", errors: ["pii"] }), grounding: ok }, { id: "q-1" });
    expect(store.items[0]).toMatchObject({ status: "needs_you", contract: { valid: true } });
    expect(store.items[0]?.answer?.refusals).toEqual(["cannot"]);
  });
  test("worker re-validates and fails an invalid answer", async () => {
    const bad = { ...answer, claims: [{ ...answer.claims[0]!, evidenceIds: ["nope"] }] };
    await runWorker({ store, invokeAgent: async () => ({ answer: bad }), grounding: ok }, { id: "q-1" });
    expect(store.items[0]).toMatchObject({ status: "failed", contract: { valid: false } });
  });
  test("worker stores failed when runtime throws", async () => {
    await runWorker({ store, invokeAgent: async () => { throw new Error("runtime down"); }, grounding: ok }, { id: "q-1" });
    expect(store.items[0]).toMatchObject({ status: "failed", error: expect.stringContaining("runtime down") });
  });
  test("worker marks working before the agent runs", async () => {
    const seen: string[] = [];
    await runWorker({ store, invokeAgent: async () => { seen.push((await store.getQuestion("q-1"))!.status); return { answer }; }, grounding: ok }, { id: "q-1" });
    expect(seen).toEqual(["working"]);
  });
});

describe("traceHeaders", () => {
  test("produces a sampled W3C traceparent and a matching X-Ray trace id", async () => {
    const { traceHeaders } = await import("../src/worker.js");
    const h = traceHeaders();
    expect(h.traceParent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const traceId = h.traceParent.split("-")[1]!;
    expect(h.traceId).toBe(`Root=1-${traceId.slice(0, 8)}-${traceId.slice(8)};Sampled=1`);
  });
});

describe("review fixes", () => {
  test("a runtime failure lands as failed with the error", async () => {
    await runWorker({ store, invokeAgent: async () => ({ refusal: "The agent failed before producing an answer.", errors: ["Cognito token request failed: 500"], failed: true }), grounding: ok }, { id: "q-1" });
    expect(store.items[0]).toMatchObject({ status: "failed", error: expect.stringContaining("Cognito") });
  });
  test("exhausted contract retries land as needs_you with an invalid contract", async () => {
    await runWorker({ store, invokeAgent: async () => ({ refusal: "The agent could not produce an answer that satisfies the evidence contract.", errors: ["summary: numbers missing 999"] }), grounding: ok }, { id: "q-1" });
    expect(store.items[0]).toMatchObject({ status: "needs_you", contract: { valid: false, errors: ["summary: numbers missing 999"] } });
  });
  test("a hung agent call fails the card at the deadline", async () => {
    await runWorker({ store, invokeAgent: () => new Promise(() => {}), grounding: ok }, { id: "q-1" }, { deadlineMs: 50 });
    expect(store.items[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/deadline|timed out/i) });
  });
});

describe("evidence agent", () => {
  const verified = { verdicts: [{ claimIndex: 0, verdict: "verified", reason: "Re-ran it.", query_execution_id: "qe2" }], overall: "verified" };
  test("stores the review next to the answer", async () => {
    await runWorker({ store, invokeAgent: async () => ({ answer }), grounding: ok, reviewEvidence: async () => ({ review: verified }) }, { id: "q-1" });
    expect(store.items[0]).toMatchObject({ status: "needs_you", evidence: verified });
  });
  test("a denied claim is stored as denied", async () => {
    const denied = { verdicts: [{ claimIndex: 0, verdict: "denied", reason: "Rows say 1000." }], overall: "denied" };
    await runWorker({ store, invokeAgent: async () => ({ answer }), grounding: ok, reviewEvidence: async () => ({ review: denied }) }, { id: "q-1" });
    expect(store.items[0]?.evidence?.overall).toBe("denied");
  });
  test("fails closed: a review that breaks its contract denies the answer", async () => {
    const unproven = { verdicts: [{ claimIndex: 0, verdict: "verified", reason: "Trust me." }], overall: "verified" };
    await runWorker({ store, invokeAgent: async () => ({ answer }), grounding: ok, reviewEvidence: async () => ({ review: unproven }) }, { id: "q-1" });
    expect(store.items[0]?.evidence).toMatchObject({ overall: "denied", error: expect.stringContaining("query you ran") });
  });
  test("fails closed: a late review denies the answer", async () => {
    await runWorker({ store, invokeAgent: async () => ({ answer }), grounding: ok, reviewEvidence: () => new Promise(() => undefined) }, { id: "q-1" }, { reviewDeadlineMs: 20 });
    expect(store.items[0]).toMatchObject({ status: "needs_you", evidence: { overall: "denied" } });
  });
  test("a refusal is not reviewed", async () => {
    let called = false;
    await runWorker({ store, invokeAgent: async () => ({ refusal: "cannot", errors: [] }), grounding: ok, reviewEvidence: async () => { called = true; return { review: verified }; } }, { id: "q-1" });
    expect(called).toBe(false);
  });
});

describe("state machine steps", () => {
  test("answerStep routes an answer to grounding, a refusal to the human, a crash to the end", async () => {
    expect(await answerStep({ store, invokeAgent: async () => ({ answer }), grounding: ok }, "q-1")).toEqual({ next: "ground" });
    expect(await answerStep({ store, invokeAgent: async () => ({ refusal: "cannot", errors: [] }), grounding: ok }, "q-1")).toEqual({ next: "decide" });
    expect(await answerStep({ store, invokeAgent: async () => { throw new Error("down"); }, grounding: ok }, "q-1")).toEqual({ next: "end" });
    expect(store.items[0]).toMatchObject({ status: "failed", error: "down" });
  });
  test("awaitStep parks the question for a human with the task token", async () => {
    await awaitStep({ store, invokeAgent: async () => ({ answer }), grounding: ok }, "q-1", "tok");
    expect(store.items[0]).toMatchObject({ status: "needs_you", taskToken: "tok" });
  });
  test("publishStep posts and marks published", async () => {
    await store.updateQuestion("q-1", { answer, evidence: { overall: "verified", verdicts: [] } });
    await publishStep({ store, invokeAgent: async () => ({ answer }), grounding: ok, publish: async () => "https://github.com/x/y/issues/7#c1" }, "q-1");
    expect(store.items[0]).toMatchObject({ status: "published", publishedUrl: "https://github.com/x/y/issues/7#c1" });
  });
  test("publishStep checks again where the comment is posted: a denied answer never goes out", async () => {
    let posted = false;
    await store.updateQuestion("q-1", { answer, evidence: { overall: "denied", verdicts: [] } });
    await expect(publishStep({ store, invokeAgent: async () => ({ answer }), grounding: ok, publish: async () => { posted = true; return "x"; } }, "q-1")).rejects.toThrow(/denied/);
    expect(posted).toBe(false);
  });
  test("rejectStep records the reason", async () => {
    await rejectStep({ store, invokeAgent: async () => ({ answer }), grounding: ok }, "q-1", "wrong week");
    expect(store.items[0]).toMatchObject({ status: "rejected", rejectReason: "wrong week" });
  });
});
