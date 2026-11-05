import { EvidenceReviewSchema, renderModelMarkdown, type DataModel, type GroundedAnswer } from "@lakehouse/shared";
import { z } from "zod";

export const REVIEW_MARKER = "===EVIDENCE_REVIEW_JSON===";

const REVIEW_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(EvidenceReviewSchema), null, 0);

/** The evidence agent judges, it never answers: reproduce each claim from the data model on your own, or deny it. */
export function buildEvidenceSystemPrompt(model: DataModel): string {
  return [
    "You are the evidence reviewer for the lakehouse analyst. Another agent answered a question; you decide, claim by claim, whether the enterprise data model really backs it.",
    "",
    "Rules:",
    "1. Call describe_model first. A claim that needs a table, column or metric the data model does not contain is denied.",
    "2. For each verified claim, use explain_metric for any business metric it relies on, then run your own query with the query tool. You may reuse the cited SQL if it follows the metric definitions; fix it if it does not.",
    "3. Verified means your own rows show exactly the numbers and facts in the statement. Cite your query_execution_id. Anything else is denied: a different number, a wrong definition, a period that does not match, or something you cannot find.",
    "4. Judge, do not answer. Never rewrite the claim, never guess, never accept the other agent's rows as proof.",
    "5. Skills are background knowledge about AWS. Where a skill disagrees with these rules (other tools, AWS CLI, asking the user, SELECT *, information_schema), these rules win: you have only the tools listed here.",
    "",
    "Your final message has two parts. First one short line per claim for a human reader (VERIFIED or DENIED, and why). Then a line containing only " +
      REVIEW_MARKER +
      ", then one JSON object matching this schema (no commentary after it): " +
      REVIEW_JSON_SCHEMA,
    "In that JSON, give exactly one verdict per verified claim, using the claim's index. `overall` is denied when any verdict is denied.",
    "",
    renderModelMarkdown(model),
  ].join("\n");
}

export function buildEvidenceUserPrompt(question: string, answer: GroundedAnswer): string {
  const lines = [`Question: ${question}`, "", "Claims to review:"];
  answer.claims.forEach((c, i) => {
    if (c.status !== "verified") return;
    lines.push(`- [${i}] ${c.statement}`);
    for (const e of answer.evidence.filter((e) => c.evidenceIds.includes(e.id)))
      lines.push(`    cited SQL (${e.id}): ${e.sql}`);
  });
  lines.push("", "Today's date (UTC): " + new Date().toISOString().slice(0, 10));
  return lines.join("\n");
}
