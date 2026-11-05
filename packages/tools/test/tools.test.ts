import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { DataModel } from "@lakehouse/shared";
import { handleTool, toolNameFromContext, type AthenaRunner } from "../src/tools.js";

const model = JSON.parse(
  readFileSync(new URL("../../shared/test/fixtures/five-table-model.json", import.meta.url), "utf8"),
) as DataModel;

function fakeAthena(): AthenaRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(sql: string) {
      calls.push(sql);
      return {
        columns: ["store_id", "c"],
        rows: Array.from({ length: 8 }, (_, i) => ({ store_id: `S0${i + 1}`, c: String(100 + i) })),
        bytes_scanned: 12345,
        query_execution_id: "qe-1",
      };
    },
  };
}

describe("handleTool", () => {
  test("describe_model returns markdown without email", async () => {
    const r = await handleTool("describe_model", {}, { athena: fakeAthena(), model });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(String(r.content)).toContain("# Lakehouse data model");
      expect(String(r.content)).not.toMatch(/\|\s*email\s*\|/);
    }
  });
  test("explain_metric unknown name errors", async () => {
    const r = await handleTool("explain_metric", { name: "profit" }, { athena: fakeAthena(), model });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/revenue/);
  });
  test("explain_metric returns definition and sql", async () => {
    const r = await handleTool("explain_metric", { name: "revenue" }, { athena: fakeAthena(), model });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toMatchObject({ name: "revenue", definition: expect.stringContaining("cancelled") });
  });
  test("query refuses pii with the rule in the message", async () => {
    const athena = fakeAthena();
    const r = await handleTool("query", { sql: "SELECT email FROM customers", purpose: "t" }, { athena, model });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pii_column/);
    expect(athena.calls).toHaveLength(0);
  });
  test("query appends limit and returns rows", async () => {
    const athena = fakeAthena();
    const r = await handleTool(
      "query",
      { sql: "SELECT store_id, count(*) c FROM orders GROUP BY 1", purpose: "smoke" },
      { athena, model },
    );
    expect(r.ok).toBe(true);
    expect(athena.calls[0]).toMatch(/LIMIT 200$/);
    if (r.ok)
      expect(r.content).toMatchObject({
        row_count: 8,
        query_execution_id: "qe-1",
        bytes_scanned: 12345,
        columns: ["store_id", "c"],
      });
  });
  test("query requires sql", async () => {
    const r = await handleTool("query", { purpose: "x" }, { athena: fakeAthena(), model });
    expect(r.ok).toBe(false);
  });
  test("unknown tool errors", async () => {
    const r = await handleTool("delete_everything" as never, {}, { athena: fakeAthena(), model });
    expect(r.ok).toBe(false);
  });
});

describe("toolNameFromContext", () => {
  test("handler strips the gateway prefix", () => {
    expect(toolNameFromContext({ clientContext: { custom: { bedrockAgentCoreToolName: "lakehouse___query" } } })).toBe(
      "query",
    );
  });
  test("name without prefix passes through", () => {
    expect(toolNameFromContext({ clientContext: { custom: { bedrockAgentCoreToolName: "describe_model" } } })).toBe(
      "describe_model",
    );
  });
  test("missing context yields undefined", () => {
    expect(toolNameFromContext({})).toBeUndefined();
  });
});

describe("normaliseCell", () => {
  test("athena scientific notation becomes a plain decimal string", async () => {
    const { normaliseCell } = await import("../src/athena.js");
    expect(normaliseCell("2.18061E7")).toBe("21806100");
    expect(normaliseCell("1.37077078E7")).toBe("13707707.8");
    expect(normaliseCell("6539.94")).toBe("6539.94");
    expect(normaliseCell("Göteborg")).toBe("Göteborg");
    expect(normaliseCell(null)).toBeNull();
  });
});
