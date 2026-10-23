import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { createDynamoStore } from "./store.js";
import { groundingCheck } from "./validate.js";
import { runWorker, traceHeaders, type AgentResponse } from "./worker.js";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const region = process.env.AWS_REGION ?? "eu-central-1";
const agentcore = new BedrockAgentCoreClient({ region });
const bedrock = new BedrockRuntimeClient({ region });
const store = createDynamoStore(env("QUESTIONS_TABLE"));

export async function handler(event: { id: string }): Promise<void> {
  await runWorker(
    {
      store,
      invokeAgent: async (id, question) => {
        const trace = traceHeaders();
        const res = await agentcore.send(
          new InvokeAgentRuntimeCommand({
            agentRuntimeArn: env("AGENT_RUNTIME_ARN"),
            runtimeSessionId: id,
            traceParent: trace.traceParent,
            traceId: trace.traceId,
            qualifier: "DEFAULT",
            contentType: "application/json",
            accept: "application/json",
            payload: Buffer.from(JSON.stringify({ question })),
          }),
        );
        const text = (await res.response?.transformToString()) ?? "";
        return JSON.parse(text) as AgentResponse;
      },
      grounding: (input) =>
        groundingCheck({ bedrock, guardrailId: env("GUARDRAIL_ID"), guardrailVersion: env("GUARDRAIL_VERSION"), threshold: Number(process.env.GROUNDING_THRESHOLD ?? 0.7) }, input),
    },
    event,
  );
}
