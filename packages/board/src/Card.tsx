import { useState } from "react";
import { Badges } from "./Badges.js";
import type { EvalResult, Question } from "./types.js";

interface Props {
  q: Question;
  evaluations: EvalResult[];
  busy: boolean;
  onDecide: (decision: "publish" | "reject", reason?: string) => void;
}

export function Card({ q, evaluations, busy, onDecide }: Props) {
  const [showSql, setShowSql] = useState<string | null>(null);
  const a = q.answer;
  const canApprove = q.status === "needs_you" && !!a && a.summary.trim() !== "" && q.publish;
  return (
    <article className={`card status-${q.status} ${busy ? "busy" : ""}`}>
      <header className="card-head">
        <h3>{q.name}</h3>
        {q.agentSeconds ? <span className="secs">{q.agentSeconds.toFixed(0)} s</span> : null}
      </header>
      <p className="question">{q.question}</p>

      {q.status === "working" ? <p className="working">The agent is reading the data model and querying Athena…</p> : null}

      {a ? (
        <div className="answer">
          {a.summary ? <p className="summary">{a.summary}</p> : null}
          {a.refusals.map((r, i) => (
            <p key={i} className="refusal">🛑 {r}</p>
          ))}
          {a.claims.length > 0 ? (
            <ul className="claims">
              {a.claims.map((c, i) => (
                <li key={i} className={c.status}>
                  <span className="mark">{c.status === "verified" ? "✅" : "❔"}</span> {c.statement}
                  {c.evidenceIds.map((id) => {
                    const e = a.evidence.find((x) => x.id === id);
                    return (
                      <button key={id} className="chip" type="button" onClick={() => setShowSql(showSql === id ? null : id)} title={e?.query_execution_id}>
                        {id}{e ? ` · ${e.row_count} rows` : ""}
                      </button>
                    );
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          {showSql ? <pre className="sql">{a.evidence.find((e) => e.id === showSql)?.sql}</pre> : null}
        </div>
      ) : null}

      {q.status === "failed" ? <p className="error">{q.error}</p> : null}
      {q.status === "published" && q.publishedUrl ? (
        <a className="published" href={q.publishedUrl} target="_blank" rel="noreferrer">
          Posted on the issue ↗
        </a>
      ) : null}
      {q.status === "rejected" ? <p className="rejected">Rejected{q.rejectReason ? `: ${q.rejectReason}` : ""}</p> : null}

      <Badges q={q} evaluations={evaluations} />

      {q.status === "needs_you" ? (
        <div className="decisions">
          {canApprove ? (
            <button className="btn approve" disabled={busy} onClick={() => onDecide("publish")}>
              Approve
            </button>
          ) : null}
          <button className="btn reject" disabled={busy} onClick={() => onDecide("reject", "Not this one.")}>
            Reject
          </button>
          {!q.publish && a?.summary ? <span className="hint">Asker opted out of posting</span> : null}
        </div>
      ) : null}
    </article>
  );
}
