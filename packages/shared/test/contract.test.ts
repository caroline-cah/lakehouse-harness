import { describe, expect, test } from "vitest";
import { GroundedAnswerSchema, parseGroundedAnswer } from "../src/contract.js";

const evidence = {
  id: "q1",
  kind: "query",
  sql: "SELECT s.name, SUM(l.qty * l.unit_price - l.discount) revenue FROM order_lines l JOIN orders o ON l.order_id = o.order_id JOIN stores s ON o.store_id = s.store_id GROUP BY 1 LIMIT 200",
  query_execution_id: "abc-123",
  row_count: 2,
  columns: ["name", "revenue"],
  sample: [
    { name: "Göteborg", revenue: "112000.4" },
    { name: "Malmö", revenue: "100000" },
  ],
};

const grounded = {
  question: "What was last week's revenue per store?",
  claims: [{ statement: "Göteborg made 112 000 SEK last week.", status: "verified", evidenceIds: ["q1"] }],
  evidence: [evidence],
  summary: "Göteborg led with 112 000 SEK, Malmö followed with 100 000 SEK.",
  refusals: [],
};

describe("GroundedAnswerSchema", () => {
  test("accepts a grounded answer", () => {
    expect(GroundedAnswerSchema.safeParse(grounded).success).toBe(true);
  });
  test("rejects verified claim without evidence", () => {
    const r = GroundedAnswerSchema.safeParse({ ...grounded, claims: [{ ...grounded.claims[0], evidenceIds: [] }] });
    expect(r.success).toBe(false);
  });
  test("rejects dangling evidence id", () => {
    const r = GroundedAnswerSchema.safeParse({ ...grounded, claims: [{ ...grounded.claims[0], evidenceIds: ["nope"] }] });
    expect(r.success).toBe(false);
  });
  test("untraceable number rejected", () => {
    const r = parseGroundedAnswer({ ...grounded, summary: "Göteborg made 999 999 SEK." });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/999999/);
  });
  test("derived percentage allowed", () => {
    expect(parseGroundedAnswer({ ...grounded, summary: "Göteborg is 12 % ahead of Malmö (112 000 vs 100 000)." }).ok).toBe(true);
  });
  test("refuses off-topic", () => {
    const r = parseGroundedAnswer({
      question: "What is the weather in Linköping?",
      claims: [],
      evidence: [],
      summary: "",
      refusals: ["The lakehouse holds retail orders, not weather. I cannot answer this."],
    });
    expect(r.ok).toBe(true);
  });
  test("summary over 600 chars rejected", () => {
    expect(parseGroundedAnswer({ ...grounded, summary: "x".repeat(601) }).ok).toBe(false);
  });
  test("sample of 25 rows accepted, 26 rejected", () => {
    const row = { name: "a", revenue: "1" };
    const wide = { ...grounded, summary: "Göteborg led." };
    expect(parseGroundedAnswer({ ...wide, evidence: [{ ...evidence, sample: new Array(25).fill(row) }] }).ok).toBe(true);
    expect(parseGroundedAnswer({ ...wide, evidence: [{ ...evidence, sample: new Array(26).fill(row) }] }).ok).toBe(false);
  });
  test("parse errors are readable strings", () => {
    const r = parseGroundedAnswer({ hello: "world" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/question|claims/);
  });
});
