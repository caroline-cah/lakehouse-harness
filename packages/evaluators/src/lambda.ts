import { evaluateSqlGuard, type EvaluatorEvent, type EvaluatorOutput } from "./sql-guard-evaluator.js";

export async function handler(event: EvaluatorEvent): Promise<EvaluatorOutput> {
  try {
    return evaluateSqlGuard(event);
  } catch (err) {
    return { errorCode: "EVALUATOR_ERROR", errorMessage: err instanceof Error ? err.message : String(err) };
  }
}
