import { z } from "zod";
import { numbersTraceable } from "./numbers.js";

/**
 * The evidence contract (Harness Engineering, Part 1): an answer is a set of claims, each one either
 * verified by named evidence or explicitly not found. The schema makes an ungrounded answer
 * structurally impossible rather than merely discouraged by the prompt.
 */
export const EvidenceSchema = z.object({
  id: z.string().min(1).describe("Short id you assign, e.g. q1, q2; claims reference it"),
  kind: z.literal("query"),
  sql: z.string().min(1).describe("The exact SQL the query tool ran"),
  query_execution_id: z.string().min(1).describe("query_execution_id returned by the query tool"),
  row_count: z.number().int().nonnegative(),
  columns: z.array(z.string()),
  sample: z.array(z.record(z.string(), z.unknown())).max(25).describe("The returned rows, verbatim, up to 25 (aggregate in SQL if a question needs more)"),
});

export const ClaimSchema = z.object({
  statement: z.string().min(1),
  status: z.enum(["verified", "not_found"]),
  evidenceIds: z.array(z.string()).default([]),
});

export const GroundedAnswerSchema = z
  .object({
    question: z.string().min(1),
    claims: z.array(ClaimSchema),
    evidence: z.array(EvidenceSchema),
    summary: z.string().max(600).describe("Plain-language answer for a non-technical reader; numbers exactly as the rows returned them"),
    refusals: z.array(z.string()).default([]).describe("What you could not do and why, e.g. the data model forbids a column"),
  })
  .superRefine((answer, ctx) => {
    const ids = new Set(answer.evidence.map((e) => e.id));
    answer.claims.forEach((claim, i) => {
      if (claim.status === "verified" && claim.evidenceIds.length === 0) {
        ctx.addIssue({ code: "custom", path: ["claims", i, "evidenceIds"], message: "A verified claim must reference at least one evidence id." });
      }
      for (const id of claim.evidenceIds) {
        if (!ids.has(id)) ctx.addIssue({ code: "custom", path: ["claims", i, "evidenceIds"], message: `Evidence id "${id}" does not exist in evidence[].` });
      }
    });
    const trace = numbersTraceable(answer.summary, answer.evidence.map((e) => e.sample));
    if (!trace.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["summary"],
        message: `These numbers do not appear in the evidence rows: ${trace.missing.join(", ")}. Quote numbers exactly as returned, or drop them.`,
      });
    }
  });

export type Evidence = z.infer<typeof EvidenceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type GroundedAnswer = z.infer<typeof GroundedAnswerSchema>;

export type ParseResult = { ok: true; answer: GroundedAnswer } | { ok: false; errors: string[] };

/** Validate at the trust boundary. Errors are plain strings a card (or a model retry) can show. */
export function parseGroundedAnswer(json: unknown): ParseResult {
  const r = GroundedAnswerSchema.safeParse(json);
  if (r.success) return { ok: true, answer: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "answer"}: ${i.message}`) };
}
