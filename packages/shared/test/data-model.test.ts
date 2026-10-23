import { describe, expect, test } from "vitest";
import { loadDataModel, piiColumns, renderModelMarkdown, tableNames } from "../src/data-model.js";

describe("data model contract", () => {
  test("loads five tables and five metrics", () => {
    const m = loadDataModel();
    expect(Object.keys(m.tables)).toEqual(["orders", "order_lines", "products", "customers", "stores"]);
    expect(Object.keys(m.metrics)).toContain("last_week");
    expect(m.examples).toHaveLength(5);
  });

  test("pii columns are email and phone", () => {
    expect(piiColumns(loadDataModel())).toEqual(["email", "phone"]);
  });

  test("table names include all five", () => {
    expect(tableNames(loadDataModel())).toContain("order_lines");
  });

  test("markdown hides pii", () => {
    const md = renderModelMarkdown(loadDataModel());
    expect(md).toContain("Not available through this interface");
    expect(md).not.toMatch(/\|\s*email\s*\|/);
    expect(md).toContain("revenue");
  });
});
