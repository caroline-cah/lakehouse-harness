// Lambda entrypoint for the SqlGuard code-based evaluator (infra/evaluations.tf → `sql-guard.handler`).
// AgentCore Evaluations invokes it per tool-call span; an error is reported in the result, never thrown.
import { evaluateSqlGuard, type EvaluatorEvent, type EvaluatorOutput } from "../sql-guard-evaluator.js";

export async function handler(event: EvaluatorEvent): Promise<EvaluatorOutput> {
  try {
    return evaluateSqlGuard(event);
  } catch (err) {
    return { errorCode: "EVALUATOR_ERROR", errorMessage: err instanceof Error ? err.message : String(err) };
  }
}
