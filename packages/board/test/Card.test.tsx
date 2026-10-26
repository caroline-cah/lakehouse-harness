import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(cleanup);
import { Card } from "../src/Card.js";
import type { Question } from "../src/types.js";

const base: Question = {
  id: "q-1", name: "Ida", question: "Revenue per store last week?", publish: true, status: "needs_you", createdAt: "t", updatedAt: "t",
  answer: {
    question: "Revenue per store last week?",
    claims: [{ statement: "Göteborg led with 1059350.7 SEK", status: "verified", evidenceIds: ["q1"] }],
    evidence: [{ id: "q1", kind: "query", sql: "SELECT 1", query_execution_id: "qe-1", row_count: 8, columns: ["revenue"], sample: [{ revenue: "1059350.7" }] }],
    summary: "Göteborg led.",
    refusals: [],
  },
  contract: { valid: true, answer: undefined as never },
  grounding: { grounding: 0.91, relevance: 0.97, passed: true, action: "NONE" },
};

describe("Card", () => {
  test("evaluations pending renders judging", () => {
    render(<Card q={base} evaluations={[]} busy={false} onDecide={vi.fn()} />);
    expect(screen.getByText(/judging/i)).toBeTruthy();
  });
  test("needs_you shows approve and reject", () => {
    render(<Card q={base} evaluations={[]} busy={false} onDecide={vi.fn()} />);
    expect(screen.getByRole("button", { name: /approve/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
  });
  test("refusal card shows refusal text and no approve when summary empty", () => {
    const q: Question = { ...base, answer: { ...base.answer!, claims: [], evidence: [], summary: "", refusals: ["Email is personal data."] } };
    render(<Card q={q} evaluations={[]} busy={false} onDecide={vi.fn()} />);
    expect(screen.getByText(/Email is personal data/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
  });
  test("grounding below threshold is red", () => {
    const q: Question = { ...base, grounding: { grounding: 0.4, relevance: 0.9, passed: false, action: "GUARDRAIL_INTERVENED" } };
    const { container } = render(<Card q={q} evaluations={[]} busy={false} onDecide={vi.fn()} />);
    expect(container.querySelector(".badge-grounding.bad")).toBeTruthy();
  });
  test("evaluation chips render label and value", () => {
    render(<Card q={base} evaluations={[{ evaluator: "Builtin.Helpfulness", label: "Very Helpful", value: 0.83, at: "t" }, { evaluator: "SqlGuard", label: "PASS", value: 1, at: "t" }]} busy={false} onDecide={vi.fn()} />);
    expect(screen.getByText(/Helpfulness/)).toBeTruthy();
    expect(screen.getByText(/0\.83/)).toBeTruthy();
    expect(screen.getByText(/SqlGuard/)).toBeTruthy();
    expect(screen.queryByText(/judging/i)).toBeNull();
  });
  test("evidence chips show id and row count", () => {
    render(<Card q={base} evaluations={[]} busy={false} onDecide={vi.fn()} />);
    expect(screen.getByText(/q1 · 8 rows/)).toBeTruthy();
  });
});

describe("badge grouping", () => {
  test("one chip per evaluator with the worst value and a count", () => {
    const evals = [
      { evaluator: "Builtin.ToolSelectionAccuracy", label: "Yes", value: 1, at: "t" },
      { evaluator: "Builtin.ToolSelectionAccuracy", label: "No", value: 0, at: "t" },
      { evaluator: "Builtin.ToolSelectionAccuracy", label: "Yes", value: 1, at: "t" },
      { evaluator: "SqlGuard-abc1234567", label: "PASS", value: 1, at: "t" },
    ];
    render(<Card q={base} evaluations={evals} busy={false} onDecide={vi.fn()} />);
    expect(screen.getAllByText(/ToolSelectionAccuracy/)).toHaveLength(1);
    expect(screen.getByText(/ToolSelectionAccuracy No 0\.00 · 2\/3/)).toBeTruthy();
    expect(screen.getByText(/SqlGuard PASS 1\.00/)).toBeTruthy();
  });
  test("evidence verdicts are stamped on their claims, and a denial removes Approve", () => {
    const denied: Question = { ...base, evidence: { overall: "denied", verdicts: [{ claimIndex: 0, verdict: "denied", reason: "My rows say 1000 SEK." }] } };
    render(<Card q={denied} evaluations={[]} busy={false} onDecide={vi.fn()} />);
    expect(screen.getByText(/DENIED · My rows say 1000 SEK/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
  });
  test("a verified stamp keeps Approve", () => {
    const ok: Question = { ...base, evidence: { overall: "verified", verdicts: [{ claimIndex: 0, verdict: "verified", reason: "Re-ran it: 1059350.7.", query_execution_id: "qe-2" }] } };
    render(<Card q={ok} evaluations={[]} busy={false} onDecide={vi.fn()} />);
    expect(screen.getByText(/VERIFIED · Re-ran it/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /approve/i })).toBeTruthy();
  });
});
