import { useMemo, useState } from "react";
import { API_URL, decide } from "./api.js";
import { Card } from "./Card.js";
import { useQuestions } from "./useQuestions.js";
import type { Question, QuestionStatus } from "./types.js";

type ColumnKey = "asked" | "working" | "needs_you" | "published" | "failed";
const COLUMNS: Array<{ key: ColumnKey; title: string; statuses: QuestionStatus[]; empty: string }> = [
  { key: "asked", title: "Asked", statuses: ["asked"], empty: "Scan the code and ask the lakehouse something." },
  { key: "working", title: "Working", statuses: ["working"], empty: "The agent is idle." },
  { key: "needs_you", title: "Needs you", statuses: ["needs_you"], empty: "No answers waiting for approval." },
  { key: "published", title: "Published", statuses: ["published", "rejected"], empty: "Approved answers land here." },
  { key: "failed", title: "Failed", statuses: ["failed"], empty: "" },
];

export function App() {
  const state = useQuestions();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byColumn = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((c) => [c.key, [] as Question[]])) as Record<ColumnKey, Question[]>;
    for (const q of state.questions) {
      const col = COLUMNS.find((c) => c.statuses.includes(q.status));
      if (col) map[col.key].push(q);
    }
    for (const list of Object.values(map)) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return map;
  }, [state.questions]);

  const onDecide = async (q: Question, decision: "publish" | "reject", reason?: string) => {
    setBusy(q.id);
    setError(null);
    try {
      await decide(q.id, decision, reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const waiting = byColumn.needs_you.length;
  return (
    <div className="board">
      <header className="top">
        <div className="brand">
          <h1>Ask the lakehouse</h1>
          <p className="sub">
            {state.questions.length === 0 ? "Questions from your phone, answers from AgentCore, approval from Caroline." : `${state.questions.length} question${state.questions.length === 1 ? "" : "s"}`}
            {waiting > 0 ? ` · ${waiting} waiting for Caroline` : ""}
          </p>
          <p className={`status status-${state.connection}`}>
            <span className="dot" />
            {state.connection === "replay" ? "Replaying a recording" : state.connection === "live" ? "Live" : state.connection === "lost" ? "Reconnecting to the API" : "Connecting"}
          </p>
          {error ? <p className="toast">{error}</p> : null}
        </div>
        <div className="qr">
          <img alt="Scan to ask" src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(API_URL + "/")}`} />
          <span>Scan to ask</span>
        </div>
      </header>
      <main className="columns">
        {COLUMNS.map((col) => (
          <section key={col.key} className={`column column-${col.key}`}>
            <h2>
              {col.title} <span className="count">{byColumn[col.key].length}</span>
            </h2>
            {byColumn[col.key].length === 0 ? <p className="empty">{col.empty}</p> : null}
            {byColumn[col.key].map((q) => (
              <Card key={q.id} q={q} evaluations={state.evaluations[q.id] ?? []} busy={busy === q.id} onDecide={(d, r) => void onDecide(q, d, r)} />
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}
