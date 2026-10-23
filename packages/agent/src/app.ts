import express, { type Express, type Request, type Response } from "express";
import { answerText, buildAgent } from "./agent.js";
import { directTools } from "./direct-tools.js";
import { gatewayTools } from "./gateway.js";
import type { InvokePayload, InvokeResponse } from "./types.js";

export interface AppDeps {
  answer: (payload: InvokePayload) => Promise<InvokeResponse>;
}

/** The AgentCore Runtime HTTP contract: GET /ping and POST /invocations on 8080. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/ping", (_req: Request, res: Response) => {
    res.json({ status: "Healthy" });
  });

  app.post("/invocations", async (req: Request, res: Response) => {
    const body = req.body as Partial<InvokePayload> | undefined;
    if (!body || typeof body.question !== "string" || body.question.trim() === "") {
      res.status(400).json({ error: "Body must be { question: string, hints?: [{question, answer}] }" });
      return;
    }
    const payload: InvokePayload = { question: body.question.trim(), ...(Array.isArray(body.hints) ? { hints: body.hints } : {}) };
    try {
      res.json(await deps.answer(payload));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("invocation failed", message);
      res.json({ refusal: "The agent failed before producing an answer.", errors: [message], failed: true } satisfies InvokeResponse);
    }
  });

  return app;
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`${name} is required`);
  return v;
}

/** Production wiring: tools from the gateway (default) or straight from the Lambda (TOOL_MODE=direct). */
export async function answerFromEnv(payload: InvokePayload): Promise<InvokeResponse> {
  const region = env("AWS_REGION", "eu-central-1");
  const modelId = env("MODEL_ID", "eu.anthropic.claude-sonnet-4-6");
  if ((process.env.TOOL_MODE ?? "gateway") === "direct") {
    return answerText(buildAgent({ modelId, region, tools: directTools(env("TOOLS_FUNCTION_NAME"), region) }), payload);
  }
  const client = await gatewayTools({
    gatewayUrl: env("GATEWAY_URL"),
    tokenUrl: env("COGNITO_TOKEN_URL"),
    clientId: env("COGNITO_CLIENT_ID"),
    secretParam: env("COGNITO_SECRET_PARAM"),
    region,
  });
  try {
    return await answerText(buildAgent({ modelId, region, tools: [client] }), payload);
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

const isMain = process.argv[1]?.endsWith("app.ts") || process.argv[1]?.endsWith("app.js");
if (isMain) {
  const port = Number(process.env.PORT ?? 8080);
  createApp({ answer: answerFromEnv }).listen(port, "0.0.0.0", () => console.log(`lakehouse agent listening on ${port}`));
}
