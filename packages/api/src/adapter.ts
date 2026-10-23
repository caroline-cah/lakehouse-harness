import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 as Result } from "aws-lambda";
import { renderForm } from "./form.js";
import { validateQuestionInput } from "./sanitize.js";
import { newQuestionId } from "./store.js";
import type { EvalResult, Question, QuestionStore } from "./types.js";

export interface AdapterDeps {
  store: QuestionStore;
  boardToken: string;
  /** Fire-and-forget: Lambda Event invocation of the worker. */
  invokeWorker: (id: string) => Promise<void>;
  publish: (q: Question) => Promise<string>;
  listEvaluations: (id: string) => Promise<EvalResult[]>;
  now?: () => string;
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-board-token", "access-control-allow-methods": "GET,POST,OPTIONS" };

function json(statusCode: number, body: unknown): Result {
  return { statusCode, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) };
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf8") : (event.body ?? "");
  const ct = (event.headers?.["content-type"] ?? "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw).entries());
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The fast path: form, intake, board reads, Approve / Reject. Everything slow is the worker's job. */
export function createAdapter(deps: AdapterDeps) {
  const now = deps.now ?? (() => new Date().toISOString());
  return async function handler(event: APIGatewayProxyEventV2): Promise<Result> {
    const method = event.requestContext.http.method.toUpperCase();
    const path = event.rawPath.replace(/\/+$/, "") || "/";
    if (method === "OPTIONS") return { statusCode: 204, headers: CORS };

    if (method === "GET" && path === "/") {
      const asked = /(?:^|&)asked=([^&]+)/.exec(event.rawQueryString ?? "")?.[1];
      return { statusCode: 200, headers: { ...CORS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, body: renderForm(asked) };
    }

    if (method === "POST" && path === "/questions") {
      const isForm = (event.headers?.["content-type"] ?? "").includes("application/x-www-form-urlencoded");
      const v = validateQuestionInput(parseBody(event));
      if (!v.ok) return isForm ? { statusCode: 303, headers: { location: "/?error=" + encodeURIComponent(v.error) } } : json(400, { error: v.error });
      const at = now();
      const q: Question = { id: newQuestionId(), ...v.value, status: "asked", createdAt: at, updatedAt: at };
      await deps.store.putQuestion(q);
      await deps.invokeWorker(q.id);
      return isForm ? { statusCode: 303, headers: { location: `/?asked=${q.id}` } } : json(201, { id: q.id, status: q.status });
    }

    if (event.headers?.["x-board-token"] !== deps.boardToken) return json(401, { error: "board token required" });

    if (method === "GET" && path === "/questions") return json(200, await deps.store.listQuestions());

    const m = /^\/questions\/([^/]+)(?:\/(publish|reject|evaluations))?$/.exec(path);
    if (m) {
      const [, id, action] = m;
      const q = await deps.store.getQuestion(id!);
      if (!q) return json(404, { error: "not found" });
      if (method === "GET" && !action) return json(200, q);
      if (method === "GET" && action === "evaluations") return json(200, await deps.listEvaluations(q.id));
      if (method === "POST" && action === "publish") {
        if (q.status !== "needs_you") return json(409, { error: `cannot publish a question in status ${q.status}` });
        if (!q.publish) return json(409, { error: "the asker opted out of publishing" });
        const publishedUrl = await deps.publish(q);
        return json(200, await deps.store.updateQuestion(q.id, { status: "published", publishedUrl }));
      }
      if (method === "POST" && action === "reject") {
        if (q.status !== "needs_you") return json(409, { error: `cannot reject a question in status ${q.status}` });
        const body = parseBody(event);
        return json(200, await deps.store.updateQuestion(q.id, { status: "rejected", rejectReason: typeof body.reason === "string" ? body.reason.slice(0, 200) : "rejected" }));
      }
    }
    return json(404, { error: "not found" });
  };
}
