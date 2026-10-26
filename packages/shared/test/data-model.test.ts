import { describe, expect, test } from "vitest";
import { loadDataModel, piiColumns, renderModelMarkdown, tableNames } from "../src/data-model.js";
import { guardSql } from "../src/sql-guard.js";

describe("data model contract", () => {
  const m = loadDataModel();

  test("the agent sees the gold layer only", () => {
    expect(m.database).toBe("lakehouse_gold");
    expect(tableNames(m)).toEqual(["sales"]);
    expect(Object.keys(m.metrics)).toEqual(["revenue", "return_rate", "average_order_value", "week", "last_week"]);
    expect(m.examples).toHaveLength(5);
  });

  test("every gold table is built from bronze by its own materialized view", () => {
    for (const t of Object.values(m.tables)) {
      expect(t.materialization?.sql).toMatch(/FROM glue_catalog\.lakehouse_bronze\./);
      for (const c of t.columns) expect(t.materialization?.sql).toMatch(new RegExp(`\\b${c.name}\\b`));
    }
  });

  test("personal data is forbidden by name and never materialized", () => {
    expect(piiColumns(m)).toEqual(["email", "phone"]);
    for (const t of Object.values(m.tables)) expect(t.materialization?.sql).not.toMatch(/\b(email|phone)\b/);
    expect(guardSql("SELECT email FROM sales", m)).toMatchObject({ ok: false, rule: "pii_column" });
  });

  test("bronze is not part of the model", () => {
    expect(guardSql("SELECT order_id FROM lakehouse_bronze.orders", m)).toMatchObject({ ok: false, rule: "unknown_table" });
    expect(guardSql("SELECT store_name, SUM(net_revenue_sek) FROM lakehouse_gold.sales GROUP BY 1", m)).toMatchObject({ ok: true });
  });

  test("markdown carries the meaning, names personal data, and never shows the build SQL", () => {
    const md = renderModelMarkdown(m);
    expect(md).toContain("There is no cost price");
    expect(md).toContain("Personal data (email, phone) is not available");
    expect(md).not.toContain("lakehouse_bronze");
  });
});
