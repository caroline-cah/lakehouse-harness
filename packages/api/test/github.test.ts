import { describe, expect, test } from "vitest";
import { commentBody } from "../src/github.js";
import type { Question } from "../src/types.js";

const q: Question = {
  id: "abc", name: "Ida", question: "Revenue per store last week?", publish: true, status: "needs_you", createdAt: "t", updatedAt: "t",
  answer: {
    question: "Revenue per store last week?",
    claims: [{ statement: "Göteborg led with 1059350.7 SEK", status: "verified", evidenceIds: ["q1"] }, { statement: "No data for Kiruna", status: "not_found", evidenceIds: [] }],
    evidence: [{ id: "q1", kind: "query", sql: "SELECT 1", query_execution_id: "qe-123", row_count: 8, columns: ["revenue"], sample: [{ revenue: "1059350.7" }] }],
    summary: "Göteborg led.",
    refusals: [],
  },
  grounding: { grounding: 0.91, relevance: 0.97, passed: true, action: "NONE" },
};

describe("commentBody", () => {
  test("publish posts comment body with claims", () => {
    const b = commentBody(q);
    expect(b).toContain("**Question** (Ida): Revenue per store last week?");
    expect(b).toContain("Göteborg led.");
    expect(b).toMatch(/✅ .*Göteborg led with 1059350.7 SEK.*\[q1\]/);
    expect(b).toMatch(/❔ .*No data for Kiruna/);
    expect(b).toContain("qe-123");
    expect(b).toContain("grounding 0.91");
  });
});

describe("commentBody escaping", () => {
  test("user text cannot inject markdown or mentions", () => {
    const b = commentBody({ ...q, name: "@channel [x](http://evil)", question: "**bold** <script>alert(1)</script> @octocat" });
    expect(b).not.toMatch(/\*\*bold\*\*/);
    expect(b).not.toMatch(/\[x\]\(http/);
    expect(b).not.toMatch(/(^|\s)@octocat/);
    expect(b).not.toMatch(/(^|\s)@channel/);
    expect(b).toContain("octocat");
  });
});
