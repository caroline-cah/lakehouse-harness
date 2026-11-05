import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Server } from "node:http";
import type { GroundedAnswer } from "@lakehouse/shared";
import { reviewText } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { REVIEW_MARKER, buildEvidenceUserPrompt } from "../src/evidence-prompt.js";

const answer: GroundedAnswer = {
  question: "Q",
  claims: [
    { statement: "Göteborg led with 1059350.7 SEK", status: "verified", evidenceIds: ["q1"] },
    { statement: "Margin is not in the data", status: "not_found", evidenceIds: [] },
  ],
  evidence: [
    {
      id: "q1",
      kind: "query",
      sql: "SELECT 1",
      query_execution_id: "qe",
      row_count: 1,
      columns: ["revenue"],
      sample: [{ revenue: "1059350.7" }],
    },
  ],
  summary: "Göteborg led with 1059350.7 SEK.",
  refusals: [],
};

const reply = (review: unknown) => ({
  lastMessage: {
    role: "assistant",
    content: [{ type: "textBlock", text: `[0] VERIFIED\n${REVIEW_MARKER}\n${JSON.stringify(review)}` }],
  },
});

describe("evidence agent", () => {
  test("only verified claims are sent for review, with their cited SQL", () => {
    const p = buildEvidenceUserPrompt("Q", answer);
    expect(p).toContain("[0] Göteborg led");
    expect(p).toContain("cited SQL (q1): SELECT 1");
    expect(p).not.toContain("Margin");
  });

  test("returns the review when it covers every verified claim", async () => {
    const review = {
      verdicts: [{ claimIndex: 0, verdict: "verified", reason: "Re-ran it.", query_execution_id: "qe2" }],
      overall: "verified",
    };
    const r = await reviewText({ invoke: async () => reply(review) }, { question: "Q", answer });
    expect(r).toEqual({ review });
  });

  test("retries, then gives up, when a verdict claims proof without a query", async () => {
    let calls = 0;
    const review = { verdicts: [{ claimIndex: 0, verdict: "verified", reason: "Looks right." }], overall: "verified" };
    const r = await reviewText(
      {
        invoke: async () => {
          calls++;
          return reply(review);
        },
      },
      { question: "Q", answer },
    );
    expect("refusal" in r).toBe(true);
    expect(calls).toBe(3);
  });
});

describe("evidence runtime http contract", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const app = createApp({
      review: async (p) => ({ review: { verdicts: [], overall: p.answer.claims.length ? "denied" : "verified" } }),
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => server.close());

  test("requires the answer to review", async () => {
    const r = await fetch(`${base}/invocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Q" }),
    });
    expect(r.status).toBe(400);
  });
  test("passes the answer to the reviewer", async () => {
    const r = await fetch(`${base}/invocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Q", answer }),
    });
    expect(await r.json()).toEqual({ review: { verdicts: [], overall: "denied" } });
  });
});
