import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { createDynamoStore } from "./store.js";
import { groundingCheck } from "./validate.js";
import type { GroundedAnswer } from "@lakehouse/shared";
import { createGithubPublisher } from "./github.js";
import { answerStep, awaitStep, denyStep, failStep, groundStep, publishStep, rejectStep, traceHeaders, verifyStep, type AgentResponse, type ReviewResponse, type WorkerDeps } from "./worker.js";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const region = process.env.AWS_REGION ?? "eu-central-1";
const agentcore = new BedrockAgentCoreClient({ region });
const bedrock = new BedrockRuntimeClient({ region });
const store = createDynamoStore(env("QUESTIONS_TABLE"));

async function invoke(arn: string, sessionId: string, body: unknown): Promise<unknown> {
  const trace = traceHeaders();
  const res = await agentcore.send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: arn,
      runtimeSessionId: sessionId,
      traceParent: trace.traceParent,
      traceId: trace.traceId,
      qualifier: "DEFAULT",
      contentType: "application/json",
      accept: "application/json",
      payload: Buffer.from(JSON.stringify(body)),
    }),
  );
  const text = (await res.response?.transformToString()) ?? "";
  return JSON.parse(text) as unknown;
}

const deps: WorkerDeps = {
  store,
  invokeAgent: async (id, question) => (await invoke(env("AGENT_RUNTIME_ARN"), id, { question })) as AgentResponse,
  // Its own session, so the review gets its own trace.
  ...(process.env.EVIDENCE_RUNTIME_ARN
    ? { reviewEvidence: async (id: string, question: string, answer: GroundedAnswer) => (await invoke(env("EVIDENCE_RUNTIME_ARN"), `${id}-evidence`, { question, answer })) as ReviewResponse }
    : {}),
  grounding: (input) =>
    groundingCheck({ bedrock, guardrailId: env("GUARDRAIL_ID"), guardrailVersion: env("GUARDRAIL_VERSION"), threshold: Number(process.env.GROUNDING_THRESHOLD ?? 0.7) }, input),
  publish: createGithubPublisher({ issue: env("GITHUB_ISSUE"), patParam: env("GITHUB_PAT_PARAM"), region }),
};

/** One Lambda, one action per Step Functions state (infra/workflow.tf). */
export type StepEvent =
  | { action: "answer" | "ground" | "verify" | "publish"; id: string }
  | { action: "await"; id: string; token: string }
  | { action: "reject"; id: string; reason?: string }
  | { action: "fail" | "deny"; id: string; error?: string };

export async function handler(event: StepEvent): Promise<unknown> {
  switch (event.action) {
    case "answer":
      return answerStep(deps, event.id);
    case "ground":
      return groundStep(deps, event.id);
    case "verify":
      return verifyStep(deps, event.id);
    case "await":
      return awaitStep(deps, event.id, event.token);
    case "publish":
      return publishStep(deps, event.id);
    case "reject":
      return rejectStep(deps, event.id, event.reason ?? "rejected");
    case "fail":
      return failStep(deps, event.id, event.error ?? "The workflow failed.");
    case "deny":
      return denyStep(deps, event.id, event.error ?? "The evidence review did not complete.");
  }
}
