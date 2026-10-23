import { beforeEach, describe, expect, test } from "vitest";
import type { GroundedAnswer } from "@lakehouse/shared";
import { runWorker } from "../src/worker.js";
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
