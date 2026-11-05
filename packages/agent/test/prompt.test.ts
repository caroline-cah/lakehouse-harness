import { describe, expect, test } from "vitest";
import { loadDataModel } from "@lakehouse/shared";
import { buildSystemPrompt, buildUserPrompt } from "../src/prompt.js";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(loadDataModel());
  test("contains the six rules", () => {
    expect(prompt).toMatch(/describe_model/);
    expect(prompt).toMatch(/exactly as the rows/i);
    expect(prompt).toMatch(/both inputs/i);
    expect(prompt).toMatch(/say so/i);
    expect(prompt).toMatch(/never speculate/i);
    expect(prompt).toMatch(/these rules win/i);
  });
  test("asks for the answer as text before the structured output", () => {
    expect(prompt).toMatch(/plain text/i);
    expect(prompt).toContain("===GROUNDED_ANSWER_JSON===");
    expect(prompt).toContain('"evidenceIds"');
    expect(prompt).toMatch(/ROUND/);
  });
  test("contains the model but no pii column as a usable column", () => {
    expect(prompt).toContain("# Lakehouse data model");
    expect(prompt).not.toMatch(/\|\s*email\s*\|/);
  });
});

describe("buildUserPrompt", () => {
  test("includes hints as verified examples when present", () => {
    const p = buildUserPrompt({
      question: "Revenue last week?",
      hints: [{ question: "Revenue per store last week?", answer: "Göteborg led with 1 232 725 SEK." }],
    });
    expect(p).toContain("Revenue last week?");
    expect(p).toMatch(/verified answer/i);
    expect(p).toContain("1 232 725");
  });
  test("has no hint section without hints", () => {
    expect(buildUserPrompt({ question: "Q" })).not.toMatch(/verified answer/i);
  });
});
