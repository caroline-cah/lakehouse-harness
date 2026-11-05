import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export type HttpResult = APIGatewayProxyStructuredResultV2;

/** The board runs on another origin (Vite locally, a static host on stage), so every answer carries CORS headers. */
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-board-token",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

export function json(statusCode: number, body: unknown): HttpResult {
  return { statusCode, headers: { ...CORS_HEADERS, "content-type": "application/json" }, body: JSON.stringify(body) };
}

export function html(body: string): HttpResult {
  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    body,
  };
}

export function redirect(location: string): HttpResult {
  return { statusCode: 303, headers: { location } };
}

export function noContent(): HttpResult {
  return { statusCode: 204, headers: CORS_HEADERS };
}

export function isFormSubmission(event: APIGatewayProxyEventV2): boolean {
  return contentType(event).includes("application/x-www-form-urlencoded");
}

/** The body as a plain object, whether it came from the phone form or a JSON client. Garbage becomes `{}`. */
export function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  const raw =
    event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf8") : (event.body ?? "");
  if (isFormSubmission(event)) return Object.fromEntries(new URLSearchParams(raw).entries());
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function contentType(event: APIGatewayProxyEventV2): string {
  return (event.headers?.["content-type"] ?? "").toLowerCase();
}
