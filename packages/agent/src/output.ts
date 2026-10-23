import { GroundedAnswerSchema, parseGroundedAnswer } from "@lakehouse/shared";
import { z } from "zod";
import { buildUserPrompt } from "./prompt.js";
import type { InvokePayload, InvokeResponse } from "./types.js";

/** The agent answers in prose for the reader, then this marker, then the GroundedAnswer JSON. One final message carries both. */
export const JSON_MARKER = "===GROUNDED_ANSWER_JSON===";

export const GROUNDED_ANSWER_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(GroundedAnswerSchema), null, 0);

export interface SplitResult {
  prose: string;
  json?: unknown;
  error?: string;
}

export function splitAnswerText(text: string): SplitResult {
  const i = text.indexOf(JSON_MARKER);
  if (i < 0) return { prose: text.trim(), error: `The response has no ${JSON_MARKER} marker followed by the JSON object.` };
  const prose = text.slice(0, i).trim();
  let raw = text.slice(i + JSON_MARKER.length).trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return { prose, json: JSON.parse(raw) as unknown };
  } catch (e) {
    return { prose, error: `The text after the marker is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Minimal surface of a Strands Agent we depend on; the result is read defensively. */
export interface TextAgent {
  invoke(prompt: string): Promise<unknown>;
}

function lastText(result: unknown): string {
  const msg = (result as { lastMessage?: { content?: unknown } } | undefined)?.lastMessage;
  const content = Array.isArray(msg?.content) ? (msg.content as { text?: unknown }[]) : [];
  return content.map((c) => (typeof c.text === "string" ? c.text : "")).join("\n");
}

/**
 * The harness's own structured-output loop: ask, validate at the boundary, feed the errors back, retry a bounded number
 * of times. The final assistant message always contains the prose answer, so judges and humans see the same thing.
 */
export async function answerWithRetries(agent: TextAgent, payload: InvokePayload, opts: { retries?: number } = {}): Promise<InvokeResponse> {
  const retries = opts.retries ?? 2;
  let prompt = buildUserPrompt(payload);
  let errors: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await agent.invoke(prompt);
    const split = splitAnswerText(lastText(result));
    if (split.error) {
      errors = [split.error];
    } else {
      const parsed = parseGroundedAnswer(split.json);
      if (parsed.ok) return { answer: parsed.answer };
      errors = parsed.errors;
    }
    prompt = [
      "Your previous answer did not satisfy the evidence contract:",
      ...errors.map((e) => `- ${e}`),
      "",
      "Answer again in full: the plain-text answer for the reader, then the marker line, then the complete corrected JSON object. Quote numbers exactly as the rows returned them, and only numbers that appear in the evidence rows.",
    ].join("\n");
  }
  return { refusal: "The agent could not produce an answer that satisfies the evidence contract.", errors };
}
