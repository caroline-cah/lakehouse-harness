// Lambda entrypoint for the workflow steps (infra/workflow.tf → `worker.handler`). One Lambda, one action per
// Step Functions state. This file is the composition root: it reads the environment, builds the AWS clients once per
// container, and dispatches each state's action to the matching step in workflow/steps.ts.
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { awsRegion, requireEnv, type GroundedAnswer } from "@lakehouse/shared";
import { createGithubPublisher } from "../github.js";
import { createDynamoStore } from "../store.js";
import { groundingCheck } from "../validate.js";
import {
  answerStep,
  awaitStep,
  denyStep,
  failStep,
  groundStep,
  publishStep,
  rejectStep,
  verifyStep,
  type AgentResponse,
  type ReviewResponse,
  type WorkerDeps,
} from "../workflow/steps.js";
import { traceHeaders } from "../workflow/trace.js";

const config = {
  questionsTable: requireEnv("QUESTIONS_TABLE"),
  agentRuntimeArn: requireEnv("AGENT_RUNTIME_ARN"),
  /** Optional: without the evidence runtime, answers reach the board unreviewed. */
  evidenceRuntimeArn: process.env.EVIDENCE_RUNTIME_ARN,
  guardrailId: requireEnv("GUARDRAIL_ID"),
  guardrailVersion: requireEnv("GUARDRAIL_VERSION"),
  groundingThreshold: Number(process.env.GROUNDING_THRESHOLD ?? 0.7),
  githubIssue: requireEnv("GITHUB_ISSUE"),
  githubPatParam: requireEnv("GITHUB_PAT_PARAM"),
};

const region = awsRegion();
const agentcore = new BedrockAgentCoreClient({ region });
const bedrock = new BedrockRuntimeClient({ region });

/** One synchronous call to an AgentCore runtime, with a sampled trace so the agent's spans are exported. */
async function invokeRuntime(arn: string, sessionId: string, body: unknown): Promise<unknown> {
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

const evidenceRuntimeArn = config.evidenceRuntimeArn;
const deps: WorkerDeps = {
  store: createDynamoStore(config.questionsTable),
  invokeAgent: async (id, question) => (await invokeRuntime(config.agentRuntimeArn, id, { question })) as AgentResponse,
  // The review runs in its own session, so it gets its own trace.
  ...(evidenceRuntimeArn
    ? {
        reviewEvidence: async (id: string, question: string, answer: GroundedAnswer) =>
          (await invokeRuntime(evidenceRuntimeArn, `${id}-evidence`, { question, answer })) as ReviewResponse,
      }
    : {}),
  grounding: (input) =>
    groundingCheck(
      {
        bedrock,
        guardrailId: config.guardrailId,
        guardrailVersion: config.guardrailVersion,
        threshold: config.groundingThreshold,
      },
      input,
    ),
  publish: createGithubPublisher({ issue: config.githubIssue, patParam: config.githubPatParam, region }),
};

/** The payload each state sends (infra/workflow.tf). */
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
