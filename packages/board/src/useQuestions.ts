import { useEffect, useRef, useState } from "react";
import { fetchEvaluations, fetchQuestions, REPLAY } from "./api.js";
import { loadReplay, playReplay } from "./replay.js";
import type { EvalResult, Question } from "./types.js";

export interface BoardState {
  questions: Question[];
  evaluations: Record<string, EvalResult[]>;
  connection: "connecting" | "live" | "lost" | "replay";
}

const QUESTIONS_MS = 2000;
const EVALS_MS = 15000;
const EVALS_WANTED = 5;

/** Polls the API (or plays a recording). Evaluations are polled per card until enough have landed. */
export function useQuestions(): BoardState {
  const [state, setState] = useState<BoardState>({ questions: [], evaluations: {}, connection: "connecting" });
  const evalsRef = useRef<Record<string, EvalResult[]>>({});

  useEffect(() => {
    if (REPLAY) {
      let stop = () => {};
      void loadReplay(REPLAY).then((frames) => {
        stop = playReplay(frames, (f) => setState({ questions: f.questions, evaluations: f.evaluations, connection: "replay" }));
      });
      return () => stop();
    }
    let alive = true;
    const pollQuestions = async () => {
      try {
        const questions = await fetchQuestions();
        if (alive) setState((s) => ({ ...s, questions, connection: "live" }));
      } catch {
        if (alive) setState((s) => ({ ...s, connection: "lost" }));
      }
    };
    const pollEvals = async () => {
      let questions: Question[] = [];
      setState((s) => {
        questions = s.questions;
        return s;
      });
      const targets = questions.filter((q) => ["needs_you", "published", "rejected"].includes(q.status) && (evalsRef.current[q.id]?.length ?? 0) < EVALS_WANTED).slice(0, 8);
      for (const q of targets) {
        const results = await fetchEvaluations(q.id);
        if (results.length > 0) evalsRef.current = { ...evalsRef.current, [q.id]: results };
      }
      if (alive) setState((s) => ({ ...s, evaluations: evalsRef.current }));
    };
    void pollQuestions();
    const t1 = setInterval(() => void pollQuestions(), QUESTIONS_MS);
    const t2 = setInterval(() => void pollEvals(), EVALS_MS);
    return () => {
      alive = false;
      clearInterval(t1);
      clearInterval(t2);
    };
  }, []);

  return state;
}
