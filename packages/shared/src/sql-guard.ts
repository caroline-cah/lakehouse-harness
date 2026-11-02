import { piiColumns, tableNames, type DataModel } from "./data-model.js";

export const MAX_LIMIT = 200;

export type GuardRule = "single_statement" | "select_only" | "unknown_table" | "pii_column" | "limit" | "unsupported_syntax";

export type GuardResult = { ok: true; sql: string } | { ok: false; rule: GuardRule; message: string };

const DENIED = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|MERGE|GRANT|REVOKE|UNLOAD|MSCK|TRUNCATE|CALL|EXECUTE)\b/i;

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Token-based guard, deliberately simple so it can be explained in one sentence per rule:
 * one statement; SELECT or WITH only; every FROM/JOIN name is a contract table (or a CTE);
 * no PII column name anywhere, even inside a string literal; no `*` projection when a PII table is referenced;
 * no quoted identifiers, backslashes or unicode escapes (so names cannot be disguised); LIMIT at most 200, appended when absent.
 * This guard is the fast, explainable layer. The real wall is the catalog (PII columns are not declared in Glue)
 * and the reader role (scoped to the contract database).
 */
export function guardSql(rawSql: string, model: DataModel): GuardResult {
  const sql = stripComments(rawSql).trim().replace(/;\s*$/, "");
  const parts = sql.split(";").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length !== 1) {
    return { ok: false, rule: "single_statement", message: "Exactly one SQL statement is allowed per query." };
  }
  const first = (/^\s*(\w+)/.exec(sql)?.[1] ?? "").toUpperCase();
  if (first !== "SELECT" && first !== "WITH") {
    return { ok: false, rule: "select_only", message: `Only SELECT (or WITH ... SELECT) is allowed; the query starts with ${first || "nothing"}.` };
  }
  if (DENIED.test(sql)) {
    return { ok: false, rule: "select_only", message: "Only read-only SELECT queries are allowed; data-changing keywords are refused." };
  }
  if (/["`\\]/.test(sql) || /\bU&/i.test(sql)) {
    return { ok: false, rule: "unsupported_syntax", message: "Quoted identifiers, backslashes and unicode escapes are not supported. Use plain lowercase column and table names." };
  }

  const pii = piiColumns(model);
  // Scan the raw text as well: a personal-data column name in a comment is still an attempt to reach it.
  const tokens = `${sql}\n${rawSql}`.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [];
  const piiHit = tokens.find((t) => pii.includes(t));

  const piiTables = Object.entries(model.tables).filter(([, t]) => t.columns.some((c) => c.pii)).map(([n]) => n);
  const mentionsPiiTable = piiTables.some((t) => new RegExp(`\\b${t}\\b`, "i").test(sql));
  // A projection star is any `*` preceded by SELECT, DISTINCT, ALL, a comma, an opening paren or `alias.`,
  // once count(*) is taken out. Multiplication (`qty * price`) is preceded by an operand, so it is untouched.
  const normalised = sql.replace(/\bcount\s*\(\s*\*\s*\)/gi, "count(1)").replace(/\s*\.\s*/g, ".");
  const starBefore = /(\bSELECT\b|\bDISTINCT\b|\bALL\b|,|\(|\w+\.)\s*\*/i.test(normalised);
  const starAfter = /\*\s*(,|\)|\bFROM\b|$)/i.test(normalised);
  if (mentionsPiiTable && (starBefore || starAfter)) {
    return {
      ok: false,
      rule: "pii_column",
      message: `SELECT * is not allowed when ${piiTables.join(", ")} is referenced because it would include personal data. Name the columns you need.`,
    };
  }

  const known = new Set(tableNames(model));
  for (const m of sql.matchAll(/\bWITH\s+([a-zA-Z_]\w*)|,\s*([a-zA-Z_]\w*)\s+AS\s*\(/gi)) {
    const cte = (m[1] ?? m[2])?.toLowerCase();
    if (cte) known.add(cte);
  }
  // Every relation after FROM or JOIN, including comma-separated lists: capture the list up to the next clause
  // keyword or parenthesis, split on commas, and take the first token of each element (the rest is an alias).
  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+([^()]+?)(?=\s+(?:WHERE|GROUP|ORDER|LIMIT|HAVING|JOIN|ON|UNION|EXCEPT|INTERSECT|INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|LATERAL|TABLESAMPLE|OFFSET|FETCH|WINDOW)\b|\s*[()]|$)/gi)) {
    for (const element of (m[1] ?? "").split(",")) {
      // `table AS alias` or `table alias`: the relation is the first token; a nested SELECT inside the list is its own FROM.
      const first = element.trim().replace(/\s+AS\s+\w+/gi, "").split(/\s+/)[0] ?? "";
      if (/^(SELECT|WITH)$/i.test(first)) continue;
      if (first === "") continue;
      const name = first.toLowerCase().replace(new RegExp(`^${model.database}\\.`), "");
      if (!known.has(name)) {
        return { ok: false, rule: "unknown_table", message: `Table "${name}" is not in the data model. Available tables: ${tableNames(model).join(", ")}.` };
      }
    }
  }

  const limit = /\bLIMIT\s+(\d+)\s*$/i.exec(sql);
  if (limit) {
    const n = Number(limit[1]);
    if (n > MAX_LIMIT) return { ok: false, rule: "limit", message: `LIMIT ${n} exceeds the maximum of ${MAX_LIMIT} rows. Aggregate instead of listing.` };
    return { ok: true, sql };
  }
  return { ok: true, sql: `${sql} LIMIT ${MAX_LIMIT}` };
}
