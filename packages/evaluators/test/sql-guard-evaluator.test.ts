import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { evaluateSqlGuard, extractToolCall, findTargetSpan, type EvaluatorEvent, type Span } from "../src/sql-guard-evaluator.js";

const spans = JSON.parse(readFileSync(new URL("./fixtures/session-spans.json", import.meta.url), "utf8")) as Span[];
const querySpan = spans.find((s) => s.name === "execute_tool lakehouse___query")!;
const describeSpan = spans.find((s) => s.name === "execute_tool lakehouse___describe_model")!;

function event(target: Span, overrides: Partial<EvaluatorEvent> = {}): EvaluatorEvent {
  return { schemaVersion: "1.0", evaluatorId: "ev", evaluatorName: "SqlGuard", evaluationLevel: "TOOL_CALL", evaluationInput: { sessionSpans: spans }, evaluationReferenceInputs: [], evaluationTarget: { traceIds: [target.traceId], spanIds: [target.spanId] }, ...overrides };
}

describe("extractToolCall", () => {
  test("reads tool name and sql from the real fixture", () => {
    const call = extractToolCall(querySpan)!;
    expect(call.tool).toBe("lakehouse___query");
    expect(call.args.sql).toMatch(/FROM order_lines/i);
  });
  test("describe_model has no sql", () => {
    expect(extractToolCall(describeSpan)!.args.sql).toBeUndefined();
  });
});

describe("evaluateSqlGuard", () => {
  test("passes clean sql", () => {
    const r = evaluateSqlGuard(event(querySpan));
    expect(r).toMatchObject({ label: "PASS", value: 1 });
  });
  test("fails pii sql from span", () => {
    const bad: Span = { ...querySpan, events: [{ name: "gen_ai.tool.message", attributes: { role: "tool", id: "x", content: JSON.stringify({ sql: "SELECT email FROM customers", purpose: "p" }) } }] };
    const r = evaluateSqlGuard(event(bad, { evaluationInput: { sessionSpans: [bad] } }));
    expect(r).toMatchObject({ label: "FAIL", value: 0 });
    expect("explanation" in r && r.explanation).toMatch(/pii_column/);
  });
  test("skips describe_model span", () => {
    expect(evaluateSqlGuard(event(describeSpan))).toMatchObject({ label: "SKIP", value: 1 });
  });
  test("returns errorCode when target span missing", () => {
    const r = evaluateSqlGuard(event(querySpan, { evaluationTarget: { traceIds: [], spanIds: ["nope"] } }));
    expect(r).toMatchObject({ errorCode: "TARGET_NOT_FOUND" });
  });
});

describe("findTargetSpan", () => {
  test("finds by span id", () => {
    expect(findTargetSpan(spans, { spanIds: [querySpan.spanId] })?.name).toBe("execute_tool lakehouse___query");
  });
});
