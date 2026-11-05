export const MAX_NAME_CHARS = 40;
export const MAX_QUESTION_CHARS = 300;

const OVERRIDE_PHRASES = [
  /ignore (all |any )?(previous|prior|above|earlier) (instructions|rules|prompts?)/gi,
  /disregard (all |any )?(previous|prior|above|earlier|the )?(instructions|rules|prompts?)/gi,
  /you are now/gi,
  /system prompt/gi,
  /developer message/gi,
];

/** Cheap hygiene for audience text: no markup, links, addresses or "ignore previous instructions" theatre. */
const RAW_CAP = 2000;

export function sanitizeFreeText(raw: string): string {
  // Cap before any regex runs so backtracking is bounded by a small constant, not by the request body size.
  let s = raw.slice(0, RAW_CAP).replace(/<[^>]*>/g, "");
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]");
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  s = s.replace(/(^|[^\w])\/\/[\w.-]+\.[a-z]{2,}\S*/gi, "$1[link]");
  s = s.replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|se|dev|app|example|xyz|info|co)(?:\/\S*)?\b/gi, "[link]");
  s = s.replace(/(^|[^\w])@([\w-]+)/g, "$1$2");
  s = s.replace(/<[^>]*$/g, "");
  for (const re of OVERRIDE_PHRASES) s = s.replace(re, "[removed]");
  return s.replace(/\s+/g, " ").trim();
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface QuestionInput {
  name: string;
  question: string;
  publish: boolean;
}

export function validateQuestionInput(raw: unknown): Validation<QuestionInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "body must be an object" };
  const b = raw as Record<string, unknown>;
  const name = sanitizeFreeText(typeof b.name === "string" ? b.name : "").slice(0, MAX_NAME_CHARS) || "Anonymous";
  const question = sanitizeFreeText(typeof b.question === "string" ? b.question : "").slice(0, MAX_QUESTION_CHARS);
  if (!question) return { ok: false, error: "question is required" };
  const publish = b.publish === true || b.publish === "on" || b.publish === "true";
  return { ok: true, value: { name, question, publish } };
}
