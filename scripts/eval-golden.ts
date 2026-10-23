// Golden-set evaluation: invoke the runtime per question, wait for its spans, score with AgentCore Evaluations (on demand).
// Usage: pnpm tsx scripts/eval-golden.ts [--only g1,g2] [--out talk/golden-results.md]
import { BedrockAgentCoreClient, EvaluateCommand, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const region = process.env.AWS_REGION ?? "eu-central-1";
const tf = (k: string) => execSync(`terraform -chdir=infra output -raw ${k}`).toString().trim();
const arn = tf("agent_runtime_arn");
const logGroup = tf("agent_log_group");
const evaluatorIds = JSON.parse(execSync("terraform -chdir=infra output -json evaluator_ids").toString()) as Record<string, string>;
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1]!.split(",") : undefined;
const out = args.includes("--out") ? args[args.indexOf("--out") + 1]! : "talk/golden-results.md";

interface Golden { id: string; question: string; expected_key?: string[]; expected_text?: string }
const golden = (JSON.parse(readFileSync("golden/questions.json", "utf8")) as Golden[]).filter((g) => !only || only.includes(g.id));
const expected = JSON.parse(readFileSync("golden/expected.json", "utf8")) as Record<string, Record<string, unknown>>;

const agentcore = new BedrockAgentCoreClient({ region });
const logs = new CloudWatchLogsClient({ region });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function expectedResponse(g: Golden): string {
  if (g.expected_text) return g.expected_text;
  const [week, key] = g.expected_key!;
  const v = expected[week!]![key!];
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

async function invoke(question: string, sessionId: string): Promise<string> {
  const r = await agentcore.send(new InvokeAgentRuntimeCommand({ agentRuntimeArn: arn, runtimeSessionId: sessionId, qualifier: "DEFAULT", contentType: "application/json", accept: "application/json", payload: Buffer.from(JSON.stringify({ question })) }));
  return (await r.response?.transformToString()) ?? "";
}

/** The trace of the agent invocation (the trace-level evaluators score it). */
function invokeTraceId(spans: Record<string, unknown>[]): string {
  const inv = spans.find((s) => String(s.name ?? "").startsWith("invoke_agent"));
  return String(inv?.traceId ?? spans[0]?.traceId ?? "");
}

async function spansFor(sessionId: string): Promise<Record<string, unknown>[]> {
  const start = Date.now() - 30 * 60_000;
  for (let i = 0; i < 20; i++) {
    const r = await logs.send(new FilterLogEventsCommand({ logGroupName: logGroup, logStreamNames: ["spans"], filterPattern: `"${sessionId}"`, startTime: start, limit: 500 }));
    const spans = (r.events ?? []).map((e) => JSON.parse(e.message ?? "{}") as Record<string, unknown>);
    const hasFinal = spans.some((s) => String(s.name ?? "").startsWith("invoke_agent"));
    if (hasFinal) return spans;
    await sleep(30_000);
  }
  throw new Error(`spans for ${sessionId} did not arrive in 10 min`);
}

const rows: string[] = ["| id | evaluator | label | value | seconds |", "|---|---|---|---|---|"];
for (const g of golden) {
  const sessionId = `golden-${g.id}-${randomUUID()}`;
  const started = Date.now();
  const answer = await invoke(g.question, sessionId);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${g.id} answered in ${seconds} s: ${answer.slice(0, 120)}…`);
  const spans = await spansFor(sessionId);
  const evaluators = ["Builtin.Correctness", "Builtin.Helpfulness", "Builtin.ToolSelectionAccuracy", evaluatorIds.sql_guard!, evaluatorIds.data_model_compliance!, evaluatorIds.response_similarity!];
  for (const ev of evaluators) {
    try {
      const r = await agentcore.send(
        new EvaluateCommand({
          evaluatorId: ev,
          evaluationInput: { sessionSpans: spans as never },
          ...(ev === evaluatorIds.response_similarity
            ? { evaluationReferenceInputs: [{ context: { spanContext: { sessionId, traceId: invokeTraceId(spans) } }, expectedResponse: { text: expectedResponse(g) } }] }
            : {}),
        } as never),
      );
      const results = (r as { evaluationResults?: { label?: string; value?: number; errorCode?: string; errorMessage?: string }[] }).evaluationResults ?? [];
      // Trace/tool-level evaluators return several rows; keep the worst (most useful for a regression table).
      const scored = results.filter((x) => !x.errorCode);
      const worst = scored.sort((a, b) => (a.value ?? 1) - (b.value ?? 1))[0];
      rows.push(`| ${g.id} | ${ev.replace(/-[A-Za-z0-9]{10}$/, "")} | ${worst?.label ?? results[0]?.errorCode ?? "n/a"} | ${worst?.value ?? ""} | ${seconds} |`);
      console.log(`  ${ev}: ${worst?.label ?? results[0]?.errorMessage}`);
    } catch (err) {
      rows.push(`| ${g.id} | ${ev} | error | | ${seconds} |`);
      console.log(`  ${ev}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
const md = `# Golden set, ${new Date().toISOString().slice(0, 16)} UTC\n\nAgent ${process.env.MODEL_ID ?? "eu.anthropic.claude-sonnet-4-6"}; judges per evaluator config. One row per evaluator, worst result in the session.\n\n${rows.join("\n")}\n`;
writeFileSync(out, md);
console.log(`wrote ${out}`);
