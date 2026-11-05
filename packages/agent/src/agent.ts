import { Agent, StructuredOutputError, type ToolList } from "@strands-agents/sdk";
import { BedrockModel } from "@strands-agents/sdk/models/bedrock";
import { AgentSkills } from "@strands-agents/sdk/vended-plugins/skills";
import { dirname, join } from "node:path";
import { loadDataModel, parseEvidenceReview, parseGroundedAnswer } from "@lakehouse/shared";
import { buildEvidenceSystemPrompt, buildEvidenceUserPrompt, REVIEW_MARKER } from "./evidence-prompt.js";
import { answerWithRetries, invokeWithContract, type TextAgent } from "./output.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import type { InvokePayload, InvokeResponse, ReviewPayload, ReviewResponse } from "./types.js";

export interface BuildAgentOptions {
  modelId: string;
  region: string;
  tools: ToolList;
  /** `evidence` builds the reviewer instead of the analyst. */
  role?: "answer" | "evidence";
  /** Folder of SKILL.md skills; defaults to skills/ next to dist/ (or src/ under tsx). */
  skillsDir?: string;
}

const defaultSkillsDir = () => join(dirname(process.argv[1] ?? "."), "..", "skills");

/** One agent per invocation: the AgentCore session is the question, so no conversation state needs to survive. */
export function buildAgent(opts: BuildAgentOptions): Agent {
  return new Agent({
    // Adaptive retries: a throttled Bedrock call backs off and retries inside the invocation instead of failing the card.
    model: new BedrockModel({
      modelId: opts.modelId,
      region: opts.region,
      clientConfig: { maxAttempts: 10, retryMode: "adaptive" },
    }),
    systemPrompt:
      opts.role === "evidence" ? buildEvidenceSystemPrompt(loadDataModel()) : buildSystemPrompt(loadDataModel()),
    tools: opts.tools,
    plugins: [new AgentSkills({ skills: [join(opts.skillsDir ?? defaultSkillsDir(), "aws")] })],
    printer: false,
  });
}

/** Production path: prose + JSON in one final message, validated and retried by the harness. */
export function answerText(agent: Agent, payload: InvokePayload): Promise<InvokeResponse> {
  return answerWithRetries(agent, payload);
}

/** The evidence agent's path: same loop, its own contract, which must cover every verified claim of the answer. */
export async function reviewText(agent: TextAgent, payload: ReviewPayload): Promise<ReviewResponse> {
  const r = await invokeWithContract(
    agent,
    buildEvidenceUserPrompt(payload.question, payload.answer),
    (json) => {
      const parsed = parseEvidenceReview(json, payload.answer);
      return parsed.ok ? { ok: true, value: parsed.review } : parsed;
    },
    { marker: REVIEW_MARKER },
  );
  if (r.ok) return { review: r.value };
  return { refusal: "The evidence agent could not produce a review that satisfies its contract.", errors: r.errors };
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
    if (!parsed.ok)
      return {
        refusal: "The agent could not produce an answer that satisfies the evidence contract.",
        errors: parsed.errors,
      };
    return { answer: parsed.answer };
  } catch (err) {
    if (err instanceof StructuredOutputError) {
      return {
        refusal: "The agent could not produce an answer that satisfies the evidence contract.",
        errors: [err.message],
      };
    }
    throw err;
  }
}
