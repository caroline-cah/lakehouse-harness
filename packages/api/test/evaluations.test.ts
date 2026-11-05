import { describe, expect, test } from "vitest";
import { listEvaluations, parseEvaluationRecord } from "../src/evaluations.js";

const record = JSON.stringify({
  "@timestamp": "2026-10-22T10:00:00Z",
  attributes: {
    "session.id": "q-1",
    "gen_ai.evaluation.name": "Builtin.Helpfulness",
    "gen_ai.evaluation.score.value": 0.83,
    "gen_ai.evaluation.score.label": "Very Helpful",
    "gen_ai.evaluation.explanation": "clear and complete",
  },
  body: "evaluation result",
});

describe("parseEvaluationRecord", () => {
  test("listEvaluations parses a result record", () => {
    expect(parseEvaluationRecord(record, "2026-10-22T10:00:00Z")).toEqual({
      evaluator: "Builtin.Helpfulness",
      label: "Very Helpful",
      value: 0.83,
      explanation: "clear and complete",
      at: "2026-10-22T10:00:00Z",
    });
  });
  test("returns undefined on malformed", () => {
    expect(parseEvaluationRecord("not json", "t")).toBeUndefined();
    expect(parseEvaluationRecord("{}", "t")).toBeUndefined();
  });
});

describe("listEvaluations", () => {
  test("listEvaluations returns [] on malformed and never throws", async () => {
    const logs = {
      send: async () => {
        throw new Error("boom");
      },
    };
    expect(await listEvaluations({ logs: logs as never, logGroup: "/x" }, "q-1")).toEqual([]);
  });
  test("maps FilterLogEvents results", async () => {
    const logs = {
      send: async () => ({
        events: [
          { message: record, timestamp: Date.parse("2026-10-22T10:00:00Z") },
          { message: "garbage", timestamp: 1 },
        ],
      }),
    };
    const r = await listEvaluations({ logs: logs as never, logGroup: "/x" }, "q-1");
    expect(r).toHaveLength(1);
    expect(r[0]?.evaluator).toBe("Builtin.Helpfulness");
  });
  test("returns [] without a log group", async () => {
    expect(await listEvaluations({ logs: { send: async () => ({}) } as never, logGroup: "" }, "q-1")).toEqual([]);
  });
});
