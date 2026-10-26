import type { EvidenceReview, GroundedAnswer } from "@lakehouse/shared";

/** POST /invocations body. `hints` are verified answers to similar questions (the cache's partial matches). */
export interface InvokePayload {
  question: string;
  hints?: { question: string; answer: string }[];
}

/** POST /invocations response. Either a contract-valid answer or an honest refusal with the reasons. */
export type InvokeResponse = { answer: GroundedAnswer } | { refusal: string; errors: string[]; failed?: boolean };

/** POST /invocations body on the evidence runtime: the answer to review. */
export interface ReviewPayload {
  question: string;
  answer: GroundedAnswer;
}

/** POST /invocations response on the evidence runtime. */
export type ReviewResponse = { review: EvidenceReview } | { refusal: string; errors: string[]; failed?: boolean };
