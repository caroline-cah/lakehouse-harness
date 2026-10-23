import type { EvalResult, Question } from "./types.js";

function short(name: string): string {
  return name.replace(/^Builtin\./, "").replace(/-[A-Za-z0-9]{10}$/, "");
}

/** Tool-level judges emit one record per tool call; the card shows one chip per evaluator: the worst record and how many passed. */
export function groupByEvaluator(evaluations: EvalResult[]): { evaluator: string; worst: EvalResult; count: number; passing: number }[] {
  const groups = new Map<string, EvalResult[]>();
  for (const e of evaluations) groups.set(e.evaluator, [...(groups.get(e.evaluator) ?? []), e]);
  return [...groups.entries()].map(([evaluator, list]) => {
    const worst = [...list].sort((a, b) => (a.value ?? 1) - (b.value ?? 1))[0]!;
    return { evaluator, worst, count: list.length, passing: list.filter((e) => (e.value ?? 1) >= 0.7).length };
  });
}

/** The three validators, in the order they ran: contract, grounding, evaluations. */
export function Badges({ q, evaluations }: { q: Question; evaluations: EvalResult[] }) {
  const c = q.contract;
  const g = q.grounding;
  const judged = evaluations.length > 0;
  return (
    <div className="badges">
      {c ? (
        <span className={`badge badge-contract ${c.valid ? "ok" : "bad"}`} title={c.valid ? "GroundedAnswer contract satisfied" : c.errors.join("\n")}>
          Contract {c.valid ? "✓" : `✗ ${c.errors.length}`}
        </span>
      ) : null}
      {g && g.action !== "SKIPPED" ? (
        <span className={`badge badge-grounding ${g.passed ? "ok" : "bad"}`} title="Bedrock Guardrails contextual grounding: grounding / relevance">
          Grounding G {g.grounding.toFixed(2)} · R {g.relevance.toFixed(2)}
        </span>
      ) : g ? (
        <span className="badge badge-grounding muted" title="Nothing to ground: the answer is a refusal">Grounding n/a</span>
      ) : null}
      {q.status === "asked" || q.status === "working" ? null : judged ? (
        groupByEvaluator(evaluations).map((g) => (
          <span key={g.evaluator} className={`badge badge-eval ${g.worst.value === undefined ? "" : g.worst.value >= 0.7 ? "ok" : g.worst.value >= 0.4 ? "warn" : "bad"}`} title={g.worst.explanation ?? ""}>
            {short(g.evaluator)} {g.worst.label}{g.worst.value !== undefined ? ` ${g.worst.value.toFixed(2)}` : ""}{g.count > 1 ? ` · ${g.passing}/${g.count}` : ""}
          </span>
        ))
      ) : (
        <span className="badge badge-eval muted">AgentCore Evaluations: judging…</span>
      )}
    </div>
  );
}
