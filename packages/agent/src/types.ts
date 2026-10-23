import type { GroundedAnswer } from "@lakehouse/shared";

/** POST /invocations body. `hints` are verified answers to similar questions (the cache's partial matches). */
export interface InvokePayload {
  question: string;
  hints?: { question: string; answer: string }[];
}

/** POST /invocations response. Either a contract-valid answer or an honest refusal with the reasons. */
export type InvokeResponse = { answer: GroundedAnswer } | { refusal: string; errors: string[]; failed?: boolean };
