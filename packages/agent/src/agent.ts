import { Agent, StructuredOutputError, type ToolList } from "@strands-agents/sdk";
import { BedrockModel } from "@strands-agents/sdk/models/bedrock";
import { loadDataModel, parseGroundedAnswer } from "@lakehouse/shared";
import { answerWithRetries } from "./output.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import type { InvokePayload, InvokeResponse } from "./types.js";

export interface BuildAgentOptions {
  modelId: string;
  region: string;
  tools: ToolList;
}

/** One agent per invocation: the AgentCore session is the question, so no conversation state needs to survive. */
export function buildAgent(opts: BuildAgentOptions): Agent {
  return new Agent({
    model: new BedrockModel({ modelId: opts.modelId, region: opts.region }),
    systemPrompt: buildSystemPrompt(loadDataModel()),
    tools: opts.tools,
    printer: false,
  });
}

/** Production path: prose + JSON in one final message, validated and retried by the harness. */
export function answerText(agent: Agent, payload: InvokePayload): Promise<InvokeResponse> {
  return answerWithRetries(agent, payload);
}

/** Minimal surface of Agent we depend on, so tests can pass a fake. */
export interface Invokable {
  invoke(prompt: string): Promise<{ structuredOutput?: unknown }>;
}

/**
 * Runs the agent and re-validates its structured output against the contract before returning it.
 * Strands already validated once; validating again where the answer is consumed is the point.
 */
export async function answerWith(agent: Invokable, payload: InvokePayload): Promise<InvokeResponse> {
  try {
    const result = await agent.invoke(buildUserPrompt(payload));
    const parsed = parseGroundedAnswer(result.structuredOutput);
    if (!parsed.ok) return { refusal: "The agent could not produce an answer that satisfies the evidence contract.", errors: parsed.errors };
    return { answer: parsed.answer };
  } catch (err) {
    if (err instanceof StructuredOutputError) {
      return { refusal: "The agent could not produce an answer that satisfies the evidence contract.", errors: [err.message] };
    }
    throw err;
  }
}
