// Copied shape of packages/api/src/types.ts: the board has no runtime dependency on the Lambda package.
export interface Evidence {
  id: string;
  kind: "query";
  sql: string;
  query_execution_id: string;
  row_count: number;
  columns: string[];
  sample: Record<string, unknown>[];
}
export interface Claim {
  statement: string;
  status: "verified" | "not_found";
  evidenceIds: string[];
}
export interface GroundedAnswer {
  question: string;
  claims: Claim[];
  evidence: Evidence[];
  summary: string;
  refusals: string[];
}
export type QuestionStatus = "asked" | "working" | "needs_you" | "published" | "rejected" | "failed";
export type ContractVerdict = { valid: true; answer: GroundedAnswer } | { valid: false; errors: string[] };
export interface GroundingVerdict {
  grounding: number;
  relevance: number;
  passed: boolean;
  action: "NONE" | "GUARDRAIL_INTERVENED" | "SKIPPED";
  automatedReasoning?: unknown;
}
export interface Verdict {
  claimIndex: number;
  verdict: "verified" | "denied";
  reason: string;
  query_execution_id?: string;
}
export interface EvidenceVerdict {
  verdicts: Verdict[];
  overall: "verified" | "denied";
  error?: string;
}
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
  evidence?: EvidenceVerdict;
  error?: string;
  publishedUrl?: string;
  rejectReason?: string;
  agentSeconds?: number;
}
export interface EvalResult {
  evaluator: string;
  label: string;
  value?: number;
  explanation?: string;
  at: string;
}
