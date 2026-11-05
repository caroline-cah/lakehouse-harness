import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { newQuestionId } from "../store.js";
import type { EvalResult, Question, QuestionStore } from "../types.js";
import { renderForm } from "./form.js";
import { html, isFormSubmission, json, noContent, parseBody, redirect, type HttpResult } from "./response.js";
import { validateQuestionInput } from "./sanitize.js";

export interface AdapterDeps {
  store: QuestionStore;
  boardToken: string;
  /** Starts the Step Functions workflow for a new question; the execution is named after the question id. */
  startWorkflow: (id: string) => Promise<void>;
  /** Hands a human decision back to the workflow waiting on this task token. */
  resume: (taskToken: string, decision: Decision) => Promise<void>;
  listEvaluations: (id: string) => Promise<EvalResult[]>;
  now?: () => string;
}

export type Decision = { decision: "publish" } | { decision: "reject"; reason: string };

const MAX_REASON_CHARS = 200;

/**
 * The fast path of the harness: the phone form, question intake, board reads, and Approve / Reject.
 * Everything slow (the agent, grounding, the review) is the workflow's job; this handler only starts or resumes it.
 *
 * Routes, in order:
 *   OPTIONS *                        CORS preflight
 *   GET  /                           the phone form                              public
 *   POST /questions                  ask a question (form or JSON)               public
 *   GET  /questions                  the board's list                            board token
 *   GET  /questions/:id              one question                                board token
 *   GET  /questions/:id/evaluations  AgentCore Evaluations results for the card  board token
 *   POST /questions/:id/publish      Approve                                     board token
 *   POST /questions/:id/reject       Reject, with an optional reason             board token
 */
export function createAdapter(deps: AdapterDeps) {
  const now = deps.now ?? (() => new Date().toISOString());

  async function ask(event: APIGatewayProxyEventV2): Promise<HttpResult> {
    const fromForm = isFormSubmission(event);
    const input = validateQuestionInput(parseBody(event));
    if (!input.ok)
      return fromForm ? redirect("/?error=" + encodeURIComponent(input.error)) : json(400, { error: input.error });

    const at = now();
    const question: Question = { id: newQuestionId(), ...input.value, status: "asked", createdAt: at, updatedAt: at };
    await deps.store.putQuestion(question);
    await deps.startWorkflow(question.id);
    return fromForm ? redirect(`/?asked=${question.id}`) : json(201, { id: question.id, status: question.status });
  }

  async function approve(question: Question): Promise<HttpResult> {
    if (question.status !== "needs_you")
      return json(409, { error: `cannot publish a question in status ${question.status}` });
    if (!question.publish) return json(409, { error: "the asker opted out of publishing" });
    if (question.evidence?.overall === "denied") return json(409, { error: "the evidence agent denied this answer" });
    if (!question.taskToken) return json(409, { error: "the workflow is not waiting for a decision" });
    await deps.resume(question.taskToken, { decision: "publish" });
    return json(202, publicView(question));
  }

  async function reject(question: Question, event: APIGatewayProxyEventV2): Promise<HttpResult> {
    if (question.status !== "needs_you")
      return json(409, { error: `cannot reject a question in status ${question.status}` });
    if (!question.taskToken) return json(409, { error: "the workflow is not waiting for a decision" });
    const body = parseBody(event);
    const reason = typeof body.reason === "string" ? body.reason.slice(0, MAX_REASON_CHARS) : "rejected";
    await deps.resume(question.taskToken, { decision: "reject", reason });
    return json(202, publicView(question));
  }

  async function questionRoutes(event: APIGatewayProxyEventV2, method: string, path: string): Promise<HttpResult> {
    if (method === "GET" && path === "/questions") return json(200, (await deps.store.listQuestions()).map(publicView));

    const match = /^\/questions\/([^/]+)(?:\/(publish|reject|evaluations))?$/.exec(path);
    if (!match) return json(404, { error: "not found" });
    const [, id, action] = match;
    const question = await deps.store.getQuestion(id!);
    if (!question) return json(404, { error: "not found" });

    if (method === "GET" && action === undefined) return json(200, publicView(question));
    if (method === "GET" && action === "evaluations") return json(200, await deps.listEvaluations(question.id));
    if (method === "POST" && action === "publish") return approve(question);
    if (method === "POST" && action === "reject") return reject(question, event);
    return json(404, { error: "not found" });
  }

  return async function handler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
    const method = event.requestContext.http.method.toUpperCase();
    const path = event.rawPath.replace(/\/+$/, "") || "/";

    if (method === "OPTIONS") return noContent();
    if (method === "GET" && path === "/") return html(renderForm(askedId(event)));
    if (method === "POST" && path === "/questions") return ask(event);

    if (event.headers?.["x-board-token"] !== deps.boardToken) return json(401, { error: "board token required" });
    return questionRoutes(event, method, path);
  };
}

/** The task token is a capability to resume the workflow: it stays on the server. */
function publicView(question: Question): Omit<Question, "taskToken"> {
  const { taskToken: _token, ...rest } = question;
  return rest;
}

/** `/?asked=<id>` after a form submission, so the form can confirm the question is on its way. */
function askedId(event: APIGatewayProxyEventV2): string | undefined {
  return /(?:^|&)asked=([^&]+)/.exec(event.rawQueryString ?? "")?.[1];
}
