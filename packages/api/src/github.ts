import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { Question } from "./types.js";

/** Audience text goes into a GitHub comment: neutralise markdown, links, html and mentions. */
export function escapeUserText(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-!<>|~]/g, (c) => `\\${c}`).replace(/(^|[^\w])@/g, "$1@\u200b");
}

/** The published comment: question, summary, each claim with its evidence, the validators' verdicts. */
export function commentBody(q: Question): string {
  const a = q.answer;
  const lines = [`**Question** (${escapeUserText(q.name)}): ${escapeUserText(q.question)}`, ""];
  if (!a) return lines.concat("_No answer._").join("\n");
  if (a.summary) lines.push(a.summary, "");
  if (a.claims.length) {
    lines.push("**Claims**");
    for (const c of a.claims)
      lines.push(
        `- ${c.status === "verified" ? "✅" : "❔"} ${c.statement}${c.evidenceIds.length ? ` [${c.evidenceIds.join(", ")}]` : ""}`,
      );
    lines.push("");
  }
  if (a.refusals.length) {
    lines.push("**Could not do**");
    for (const r of a.refusals) lines.push(`- ${r}`);
    lines.push("");
  }
  if (a.evidence.length) {
    lines.push("**Evidence**");
    for (const e of a.evidence)
      lines.push(
        `- \`${e.id}\` Athena ${e.query_execution_id}, ${e.row_count} rows: \`${e.sql.replace(/\s+/g, " ").slice(0, 300)}\``,
      );
    lines.push("");
  }
  const g = q.grounding;
  lines.push(
    `_Checked by: evidence contract ✅${g ? `, Guardrails grounding ${g.grounding.toFixed(2)} / relevance ${g.relevance.toFixed(2)}` : ""}. Approved by a human before posting._`,
  );
  return lines.join("\n");
}

export interface GithubPublisher {
  (q: Question): Promise<string>;
}

let patCache: string | undefined;

/** Posts the comment on `owner/repo#issue` with a fine-grained PAT read from SSM. Returns the comment URL. */
export function createGithubPublisher(opts: {
  issue: string;
  patParam: string;
  region: string;
  fetchImpl?: typeof fetch;
}): GithubPublisher {
  const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(opts.issue);
  if (!m) throw new Error(`GITHUB_ISSUE must look like owner/repo#7, got ${opts.issue}`);
  const [, owner, repo, issue] = m;
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (q) => {
    if (!patCache) {
      const r = await new SSMClient({ region: opts.region }).send(
        new GetParameterCommand({ Name: opts.patParam, WithDecryption: true }),
      );
      patCache = r.Parameter?.Value;
      if (!patCache) throw new Error("GitHub PAT parameter is empty");
    }
    const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/issues/${issue}/comments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${patCache}`,
        Accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "lakehouse-harness",
      },
      body: JSON.stringify({ body: commentBody(q) }),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { html_url: string };
    return json.html_url;
  };
}
