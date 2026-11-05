import { describe, expect, test } from "vitest";
import type { GroundedAnswer } from "@lakehouse/shared";
import { evidenceToText, groundingCheck, validateAnswer } from "../src/validate.js";

const answer: GroundedAnswer = {
  question: "Revenue per store last week?",
  claims: [{ statement: "Göteborg led with 1059350.7 SEK", status: "verified", evidenceIds: ["q1"] }],
  evidence: [
    {
      id: "q1",
      kind: "query",
      sql: "SELECT name, revenue FROM x",
      query_execution_id: "qe",
      row_count: 2,
      columns: ["name", "revenue"],
      sample: [
        { name: "Göteborg", revenue: "1059350.7" },
        { name: "Malmö", revenue: "822856" },
      ],
    },
  ],
  summary: "Göteborg led with 1059350.7 SEK; Malmö made 822856 SEK.",
  refusals: [],
};

function fakeBedrock(grounding: number, relevance: number, action = "NONE") {
  const calls: unknown[] = [];
  return {
    calls,
    async send(cmd: { input: unknown }) {
      calls.push(cmd.input);
      return {
        action,
        assessments: [
          {
            contextualGroundingPolicy: {
              filters: [
                { type: "GROUNDING", score: grounding, threshold: 0.7, action: grounding >= 0.7 ? "NONE" : "BLOCKED" },
                { type: "RELEVANCE", score: relevance, threshold: 0.7, action: "NONE" },
              ],
            },
          },
        ],
      };
    },
  };
}

describe("validateAnswer", () => {
  test("accepts a contract-valid answer", () => {
    const v = validateAnswer(answer);
    expect(v.valid).toBe(true);
  });
  test("returns errors on bad json", () => {
    const v = validateAnswer({ nope: true });
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.errors.length).toBeGreaterThan(0);
  });
});

describe("evidenceToText", () => {
  test("renders id, row count and rows", () => {
    const t = evidenceToText(answer);
    expect(t).toContain("Evidence q1: the query returned 2 rows");
    expect(t).toContain("name is Göteborg");
    expect(t).toMatch(/Row 1 of 2: .*revenue is 1059350\.7\./);
  });
  test("evidence text caps at 20000 chars", () => {
    const big = {
      ...answer,
      evidence: Array.from({ length: 50 }, (_, i) => ({ ...answer.evidence[0]!, id: `q${i}`, sql: "x".repeat(2000) })),
    };
    expect(evidenceToText(big).length).toBeLessThanOrEqual(20000);
  });
});

describe("groundingCheck", () => {
  const input = { question: answer.question, evidenceText: evidenceToText(answer), summary: answer.summary };
  test("grounding scores parsed from assessment", async () => {
    const bedrock = fakeBedrock(0.92, 0.95);
    const v = await groundingCheck({ bedrock: bedrock as never, guardrailId: "g1", guardrailVersion: "1" }, input);
    expect(v).toMatchObject({ grounding: 0.92, relevance: 0.95, passed: true, action: "NONE" });
    const sent = bedrock.calls[0] as { content: { text: { text: string; qualifiers?: string[] } }[] };
    expect(sent.content.map((c) => c.text.qualifiers?.[0] ?? "none")).toEqual(["grounding_source", "query", "none"]);
  });
  test("passed false below threshold", async () => {
    const v = await groundingCheck(
      { bedrock: fakeBedrock(0.4, 0.9, "GUARDRAIL_INTERVENED") as never, guardrailId: "g1", guardrailVersion: "1" },
      input,
    );
    expect(v.passed).toBe(false);
    expect(v.action).toBe("GUARDRAIL_INTERVENED");
  });
  test("skips the check when there is no summary", async () => {
    const bedrock = fakeBedrock(1, 1);
    const v = await groundingCheck(
      { bedrock: bedrock as never, guardrailId: "g1", guardrailVersion: "1" },
      { ...input, summary: "" },
    );
    expect(v.passed).toBe(true);
    expect(bedrock.calls).toHaveLength(0);
  });
});

describe("groundingCheck fail-closed", () => {
  test("empty summary with claims is not passed", async () => {
    const bedrock = fakeBedrock(1, 1);
    const v = await groundingCheck(
      { bedrock: bedrock as never, guardrailId: "g1", guardrailVersion: "1" },
      { question: "Q", evidenceText: "x", summary: "", claims: ["Göteborg led"] },
    );
    expect(v.passed).toBe(false);
    expect(v.action).toBe("SKIPPED");
  });
  test("the published summary is the guarded content", async () => {
    const bedrock = fakeBedrock(0.9, 0.9);
    await groundingCheck(
      { bedrock: bedrock as never, guardrailId: "g1", guardrailVersion: "1" },
      { question: "Q", evidenceText: "x", summary: "S", claims: ["Claim one"] },
    );
    const sent = bedrock.calls[0] as { content: { text: { text: string } }[] };
    expect(sent.content[2]!.text.text).toBe("S");
  });
  test("filters and order of a query are rendered in words", () => {
    const t = evidenceToText({
      ...answer,
      evidence: [
        {
          ...answer.evidence[0]!,
          sql: "SELECT name, revenue FROM x WHERE order_ts >= '2026-10-12T00:00:00Z' AND order_ts < '2026-10-19T00:00:00Z' GROUP BY 1 ORDER BY revenue DESC LIMIT 200",
        },
      ],
    });
    expect(t).toMatch(/Filters: order_ts >= '2026-10-12T00:00:00Z'/);
    expect(t).toMatch(/ordered by revenue, descending/);
  });
});

describe("groundingCheck refusals", () => {
  test("a summary with no claims and no evidence is not graded", async () => {
    const bedrock = fakeBedrock(0.1, 0.1);
    const v = await groundingCheck(
      { bedrock: bedrock as never, guardrailId: "g1", guardrailVersion: "1" },
      {
        question: "Weather?",
        evidenceText: "",
        summary: "This question is outside the data model.",
        claims: [],
        refusals: ["Weather is not in the lakehouse."],
      },
    );
    expect(v).toMatchObject({ passed: true, action: "SKIPPED" });
    expect(bedrock.calls).toHaveLength(0);
  });
  test("a summary with no claims, no evidence and no refusal is still graded", async () => {
    const bedrock = fakeBedrock(0.1, 0.1);
    const v = await groundingCheck(
      { bedrock: bedrock as never, guardrailId: "g1", guardrailVersion: "1" },
      { question: "Q", evidenceText: "", summary: "Revenue was great.", claims: [], refusals: [] },
    );
    expect(bedrock.calls).toHaveLength(1);
    expect(v.passed).toBe(false);
  });
});

describe("queryFactsInWords", () => {
  test("describes the sort direction without claiming highest or lowest", async () => {
    const { queryFactsInWords } = await import("../src/validate.js");
    expect(queryFactsInWords("SELECT a FROM t ORDER BY revenue DESC LIMIT 5")).toMatch(
      /ordered by revenue, descending/,
    );
    expect(queryFactsInWords("SELECT a FROM t ORDER BY name")).toMatch(/ordered by name, ascending/);
    expect(queryFactsInWords("SELECT a FROM t ORDER BY revenue DESC")).not.toMatch(/highest|lowest/);
  });
  test("keeps literal quotes in filters", async () => {
    const { queryFactsInWords } = await import("../src/validate.js");
    expect(queryFactsInWords("SELECT a FROM t WHERE status <> 'cancelled' AND x > 1 GROUP BY a")).toContain(
      "status <> 'cancelled' AND x > 1",
    );
  });
});
