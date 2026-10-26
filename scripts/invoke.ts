// Invokes the deployed analyst runtime once, then the evidence runtime on its answer.
// Usage: pnpm tsx scripts/invoke.ts "<question>" [sessionId]
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const question = process.argv[2];
if (!question) throw new Error("usage: invoke.ts <question> [sessionId]");
const sessionId = process.argv[3] ?? `local-${randomUUID()}-lakehouse-demo`;
const region = process.env.AWS_REGION ?? "eu-central-1";
const arn = process.env.AGENT_RUNTIME_ARN ?? execSync("terraform -chdir=infra output -raw agent_runtime_arn").toString().trim();

const evidenceArn = process.env.EVIDENCE_RUNTIME_ARN ?? execSync("terraform -chdir=infra output -raw evidence_runtime_arn").toString().trim();

const client = new BedrockAgentCoreClient({ region });

async function invoke(runtimeArn: string, session: string, payload: unknown): Promise<string> {
  const started = Date.now();
  const res = await client.send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtimeArn,
      runtimeSessionId: session,
      qualifier: "DEFAULT",
      contentType: "application/json",
      accept: "application/json",
      payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
  const body = (await res.response?.transformToString()) ?? "";
  console.log(`session ${session} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  console.log(body);
  return body;
}

const answered = JSON.parse(await invoke(arn, sessionId, { question })) as { answer?: unknown };
if (answered.answer) await invoke(evidenceArn, `${sessionId}-evidence`, { question, answer: answered.answer });
