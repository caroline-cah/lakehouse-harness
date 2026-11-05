import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import type { InvokePayload, InvokeResponse } from "../src/types.js";

const good: InvokeResponse = {
  answer: {
    question: "Q",
    claims: [],
    evidence: [],
    summary: "",
    refusals: ["Only for the test."],
  },
};

let server: Server;
let base: string;
let lastPayload: InvokePayload | undefined;

beforeAll(async () => {
  const app = createApp({
    answer: async (payload) => {
      lastPayload = payload;
      if (payload.question === "boom") throw new Error("model exploded");
      return good;
    },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => server.close());

describe("agent http contract", () => {
  test("ping healthy", async () => {
    const r = await fetch(`${base}/ping`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "Healthy" });
  });
  test("invocations returns the answer and passes hints through", async () => {
    const r = await fetch(`${base}/invocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Q", hints: [{ question: "a", answer: "b" }] }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(good);
    expect(lastPayload?.hints).toHaveLength(1);
  });
  test("invocations rejects a missing question", async () => {
    const r = await fetch(`${base}/invocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "legacy" }),
    });
    expect(r.status).toBe(400);
  });
  test("invocations returns a refusal when the agent throws", async () => {
    const r = await fetch(`${base}/invocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "boom" }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as InvokeResponse;
    expect("refusal" in body && body.errors[0]).toMatch(/model exploded/);
  });
});

describe("failure shape", () => {
  test("an agent crash is reported as failed, not as a refusal", async () => {
    const r = await fetch(`${base}/invocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "boom" }),
    });
    const body = (await r.json()) as { refusal?: string; failed?: boolean; errors?: string[] };
    expect(body.failed).toBe(true);
  });
});
