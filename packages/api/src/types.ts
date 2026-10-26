import type { EvidenceReview, GroundedAnswer } from "@lakehouse/shared";
import type { ContractVerdict, GroundingVerdict } from "./validate.js";

export type QuestionStatus = "asked" | "working" | "needs_you" | "published" | "rejected" | "failed";

/** One audience question, from the phone to the board. */
export interface Question {
  id: string;
  name: string;
  question: string;
  publish: boolean;
  status: QuestionStatus;
  createdAt: string;
  updatedAt: string;
  answer?: GroundedAnswer;
  contract?: ContractVerdict;
  grounding?: GroundingVerdict;
  /** The evidence agent's review. `denied` blocks Approve. */
  evidence?: EvidenceVerdict;
  /** Step Functions task token while the workflow waits for Approve or Reject. Never sent to the board. */
  taskToken?: string;
  error?: string;
  publishedUrl?: string;
  rejectReason?: string;
  agentSeconds?: number;
}

/** The evidence agent's review as stored; `error` when it could not review, which counts as denied. */
export type EvidenceVerdict = EvidenceReview & { error?: string };

export interface QuestionStore {
  putQuestion(q: Question): Promise<void>;
  getQuestion(id: string): Promise<Question | undefined>;
  listQuestions(limit?: number): Promise<Question[]>;
  updateQuestion(id: string, patch: Partial<Question>): Promise<Question>;
}

/** One AgentCore Evaluations result for a session, as the board shows it. */
export interface EvalResult {
  evaluator: string;
  label: string;
  value?: number;
  explanation?: string;
  at: string;
}

export type { ContractVerdict, GroundingVerdict } from "./validate.js";
