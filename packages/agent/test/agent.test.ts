import { describe, expect, test } from "vitest";
import { StructuredOutputError } from "@strands-agents/sdk";
import { answerWith } from "../src/agent.js";

describe("answerWith", () => {
  test("returns a refusal on StructuredOutputError", async () => {
    const r = await answerWith({ invoke: async () => { throw new StructuredOutputError("no structured output"); } } as never, { question: "Q" });
    expect(r).toMatchObject({ refusal: expect.stringMatching(/could not produce/i), errors: ["no structured output"] });
  });
  test("re-validates structured output at the boundary", async () => {
    const r = await answerWith({ invoke: async () => ({ structuredOutput: { question: "Q", claims: [{ statement: "x", status: "verified", evidenceIds: [] }], evidence: [], summary: "", refusals: [] } }) } as never, { question: "Q" });
    expect("refusal" in r).toBe(true);
  });
  test("returns the answer when valid", async () => {
    const out = { question: "Q", claims: [], evidence: [], summary: "", refusals: ["n/a"] };
    const r = await answerWith({ invoke: async () => ({ structuredOutput: out }) } as never, { question: "Q" });
    expect(r).toEqual({ answer: { ...out } });
  });
});
