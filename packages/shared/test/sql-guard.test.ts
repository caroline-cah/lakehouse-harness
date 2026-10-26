import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { DataModel } from "../src/data-model.js";
import { guardSql } from "../src/sql-guard.js";

// The guard is tested against a frozen five-table model (with PII columns), independent of what data-model/ holds today.
const model = JSON.parse(readFileSync(new URL("./fixtures/five-table-model.json", import.meta.url), "utf8")) as DataModel;
const ok = (sql: string) => {
  const r = guardSql(sql, model);
  if (!r.ok) throw new Error(`expected ok, got ${r.rule}: ${r.message}`);
  return r.sql;
};
const rule = (sql: string) => {
  const r = guardSql(sql, model);
  return r.ok ? "ok" : r.rule;
};

describe("guardSql", () => {
  test("appends LIMIT 200 when absent", () => {
    expect(ok("SELECT store_id, count(*) c FROM orders GROUP BY 1")).toMatch(/LIMIT 200$/);
  });
  test("keeps an existing limit at or below 200", () => {
    expect(ok("SELECT * FROM stores LIMIT 10")).toMatch(/LIMIT 10$/);
  });
  test("rejects LIMIT 5000", () => {
    expect(rule("SELECT * FROM stores LIMIT 5000")).toBe("limit");
  });
  test("rejects two statements", () => {
    expect(rule("SELECT 1 FROM stores; SELECT 2 FROM stores")).toBe("single_statement");
  });
  test("rejects INSERT, DELETE and DROP", () => {
    expect(rule("INSERT INTO stores VALUES ('x')")).toBe("select_only");
    expect(rule("DELETE FROM stores")).toBe("select_only");
    expect(rule("DROP TABLE stores")).toBe("select_only");
  });
  test("rejects unknown table", () => {
    expect(rule("SELECT * FROM invoices")).toBe("unknown_table");
  });
  test("qualified table name lakehouse_demo.orders ok", () => {
    expect(rule("SELECT count(*) FROM lakehouse_demo.orders o JOIN lakehouse_demo.stores s ON o.store_id = s.store_id")).toBe("ok");
  });
  test("WITH cte ok", () => {
    expect(rule("WITH w AS (SELECT order_id FROM orders) SELECT count(*) FROM w")).toBe("ok");
  });
  test("rejects a pii column", () => {
    expect(rule("SELECT customer_id, email FROM customers")).toBe("pii_column");
  });
  test("pii token inside literal", () => {
    expect(rule("SELECT customer_id FROM customers WHERE city = 'email me'")).toBe("pii_column");
  });
  test("message names the rule and the offending name", () => {
    const r = guardSql("SELECT phone FROM customers", model);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/phone/);
  });
  test("comments are ignored", () => {
    expect(rule("-- weekly\nSELECT count(*) FROM orders /* all */")).toBe("ok");
  });
});

describe("guardSql hardening", () => {
  const rule = (sql: string) => {
    const r = guardSql(sql, model);
    return r.ok ? "ok" : r.rule;
  };
  test("star projection on a pii table is refused", () => {
    expect(rule("SELECT * FROM customers")).toBe("pii_column");
    expect(rule("SELECT c.* FROM customers c JOIN orders o ON o.customer_id = c.customer_id")).toBe("pii_column");
  });
  test("star projection on a table without pii is fine", () => {
    expect(rule("SELECT * FROM orders")).toBe("ok");
  });
  test("quoted identifiers are refused", () => {
    expect(rule('SELECT "email" FROM customers')).toBe("unsupported_syntax");
    expect(rule("SELECT `email` FROM customers")).toBe("unsupported_syntax");
  });
  test("unicode escapes and backslashes are refused", () => {
    expect(rule("SELECT U&\"\\0065mail\" FROM customers")).toBe("unsupported_syntax");
    expect(rule("SELECT customer_id FROM customers WHERE city = 'a\\nb'")).toBe("unsupported_syntax");
  });
});

describe("guardSql star rule precision", () => {
  const rule = (sql: string) => {
    const r = guardSql(sql, model);
    return r.ok ? "ok" : r.rule;
  };
  test("count(*) on a pii table is fine", () => {
    expect(rule("SELECT city, count(*) FROM customers GROUP BY 1")).toBe("ok");
  });
  test("multiplication next to a pii table is fine", () => {
    expect(rule("SELECT c.city, SUM(l.qty * l.unit_price) FROM order_lines l JOIN orders o ON l.order_id = o.order_id JOIN customers c ON o.customer_id = c.customer_id GROUP BY 1")).toBe("ok");
  });
  test("star variants on a pii table are refused", () => {
    expect(rule("SELECT customers.* FROM customers")).toBe("pii_column");
    expect(rule("SELECT *\nFROM customers")).toBe("pii_column");
    expect(rule("SELECT DISTINCT * FROM customers")).toBe("pii_column");
    expect(rule("SELECT customer_id FROM (SELECT * FROM customers)")).toBe("pii_column");
    expect(rule("SELECT *, 1 FROM customers")).toBe("pii_column");
  });
});

test("star with spaces around the dot is still refused", () => {
  const r = guardSql("SELECT c . * FROM customers c", model);
  expect(r.ok ? "ok" : r.rule).toBe("pii_column");
});

describe("guardSql comma joins", () => {
  const rule = (sql: string) => {
    const r = guardSql(sql, model);
    return r.ok ? "ok" : r.rule;
  };
  test("every table in a comma-separated FROM list is checked", () => {
    expect(rule("SELECT o.order_id FROM orders o, other_db.secret s WHERE o.order_id = s.id")).toBe("unknown_table");
    expect(rule("SELECT o.order_id FROM orders, invoices")).toBe("unknown_table");
  });
  test("comma join between contract tables with aliases is fine", () => {
    expect(rule("SELECT o.order_id FROM orders o, stores AS s WHERE o.store_id = s.store_id")).toBe("ok");
    expect(rule("SELECT count(*) FROM orders,\n  stores\nWHERE orders.store_id = stores.store_id")).toBe("ok");
  });
});

describe("guardSql set operators and nested FROM", () => {
  const rule = (sql: string) => {
    const r = guardSql(sql, model);
    return r.ok ? "ok" : r.rule;
  };
  test("tables after EXCEPT and INTERSECT are checked", () => {
    expect(rule("SELECT order_id FROM orders EXCEPT SELECT id FROM other_db.secret")).toBe("unknown_table");
    expect(rule("SELECT order_id FROM orders INTERSECT SELECT order_id FROM invoices")).toBe("unknown_table");
  });
  test("a second FROM in a subquery is checked", () => {
    expect(rule("SELECT * FROM orders WHERE customer_id IN (SELECT id FROM other_db.secret)")).toBe("unknown_table");
    expect(rule("SELECT o.order_id FROM orders o WHERE EXISTS (SELECT 1 FROM stores s WHERE s.store_id = o.store_id)")).toBe("ok");
  });
  test("lateral and tablesample keywords stop the list", () => {
    expect(rule("SELECT * FROM orders TABLESAMPLE BERNOULLI (10)")).toBe("ok");
  });
});

test("AS alias inside a comma list does not hide the next table", () => {
  const r = guardSql("SELECT o.order_id FROM orders AS o, other_db.secret AS s WHERE o.order_id = s.id", model);
  expect(r.ok ? "ok" : r.rule).toBe("unknown_table");
  const ok = guardSql("SELECT o.order_id FROM orders AS o, stores AS s WHERE o.store_id = s.store_id", model);
  expect(ok.ok).toBe(true);
});

test("a pii column name inside a comment is still refused", () => {
  const r = guardSql("SELECT city FROM customers -- email", model);
  expect(r.ok ? "ok" : r.rule).toBe("pii_column");
  const r2 = guardSql("SELECT city FROM customers /* phone */", model);
  expect(r2.ok ? "ok" : r2.rule).toBe("pii_column");
});
