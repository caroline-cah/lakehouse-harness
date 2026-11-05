import { describe, expect, test } from "vitest";
import { JSON_MARKER, splitAnswerText, answerWithRetries } from "../src/output.js";

const good = {
  question: "Q",
  claims: [{ statement: "Göteborg led with 1059350.7 SEK", status: "verified", evidenceIds: ["q1"] }],
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

describe("splitAnswerText", () => {
  test("splits prose from the json block after the marker", () => {
    const text = `Göteborg led with 1059350.7 SEK.\n\n${JSON_MARKER}\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\``;
    const r = splitAnswerText(text);
    expect(r.prose).toBe("Göteborg led with 1059350.7 SEK.");
    expect(r.json).toEqual(good);
  });
  test("tolerates a bare json object without fences", () => {
    const r = splitAnswerText(`Answer.\n${JSON_MARKER}\n${JSON.stringify(good)}`);
    expect(r.json).toEqual(good);
  });
  test("reports a missing marker", () => {
    const r = splitAnswerText("Just prose");
    expect(r.json).toBeUndefined();
    expect(r.error).toMatch(/marker/i);
  });
  test("reports invalid json", () => {
    const r = splitAnswerText(`Answer.\n${JSON_MARKER}\n{not json`);
    expect(r.error).toMatch(/JSON/);
  });
});

describe("answerWithRetries", () => {
  const textOf = (obj: unknown, prose = "Göteborg led with 1059350.7 SEK.") =>
    `${prose}\n\n${JSON_MARKER}\n${JSON.stringify(obj)}`;
  test("returns the answer on the first valid response", async () => {
    const calls: string[] = [];
    const agent = {
      invoke: async (p: string) => {
        calls.push(p);
        return { lastMessage: { role: "assistant", content: [{ type: "textBlock", text: textOf(good) }] } };
      },
    };
    const r = await answerWithRetries(agent as never, { question: "Q" });
    expect(r).toEqual({ answer: good });
    expect(calls).toHaveLength(1);
  });
  test("retries with the validation errors and succeeds", async () => {
    const calls: string[] = [];
    const bad = { ...good, claims: [{ ...good.claims[0], evidenceIds: [] }] };
    let n = 0;
    const agent = {
      invoke: async (p: string) => {
        calls.push(p);
        n++;
        return {
          lastMessage: { role: "assistant", content: [{ type: "textBlock", text: textOf(n === 1 ? bad : good) }] },
        };
      },
    };
    const r = await answerWithRetries(agent as never, { question: "Q" });
    expect("answer" in r).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/evidence id/i);
  });
  test("gives up after the retry budget with a refusal", async () => {
    const agent = {
      invoke: async () => ({
        lastMessage: { role: "assistant", content: [{ type: "textBlock", text: "no marker here" }] },
      }),
    };
    const r = await answerWithRetries(agent as never, { question: "Q" }, { retries: 2 });
    expect("refusal" in r && r.errors.length).toBeGreaterThan(0);
  });
  test("the summary is taken from the json, the prose is checked to match it", async () => {
    const agent = {
      invoke: async () => ({
        lastMessage: {
          role: "assistant",
          content: [{ type: "textBlock", text: textOf(good, "Something else entirely.") }],
        },
      }),
    };
    const r = await answerWithRetries(agent as never, { question: "Q" });
    expect("answer" in r && r.answer.summary).toBe(good.summary);
  });
});
