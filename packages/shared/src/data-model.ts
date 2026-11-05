import { DATA_MODEL } from "./data-model.generated.js";

export interface Column {
  name: string;
  type: string;
  description: string;
  pii?: boolean;
}

export interface Join {
  to: string;
  on: string;
}

export interface Table {
  description: string;
  grain: string;
  columns: Column[];
  joins: Join[];
  /** The table's meaning in prose, from the body of its Markdown file. */
  doc: string;
  /** How the gold view is built from bronze (scripts/medallion.py). Never shown to the agent. */
  materialization?: { refresh: string; sql: string };
}

export interface Metric {
  definition: string;
  sql: string;
}

export interface DataModel {
  database: string;
  /** Personal-data column names refused everywhere, whether or not a table still has them. */
  forbidden_columns?: string[];
  tables: Record<string, Table>;
  metrics: Record<string, Metric>;
  examples: string[];
}

/** The enterprise data model, compiled from data-model/*.md. */
export function loadDataModel(): DataModel {
  return DATA_MODEL;
}

export function tableNames(model: DataModel): string[] {
  return Object.keys(model.tables);
}

/** `forbidden_columns` plus column names flagged `pii: true` anywhere in the model, deduplicated, in declaration order. */
export function piiColumns(model: DataModel): string[] {
  const out: string[] = [...(model.forbidden_columns ?? [])];
  for (const t of Object.values(model.tables)) {
    for (const c of t.columns) if (c.pii && !out.includes(c.name)) out.push(c.name);
  }
  return out;
}

/** What `describe_model` returns: the contract as Markdown, with PII columns named but not described as usable. */
export function renderModelMarkdown(model: DataModel): string {
  const lines: string[] = [];
  lines.push(`# Lakehouse data model (${model.database})`, "");
  lines.push(
    "Query tables with plain Athena/Trino SQL. Qualify tables as `" + model.database + ".<table>` or use bare names.",
    "",
  );
  for (const [name, t] of Object.entries(model.tables)) {
    lines.push(
      `## ${name}`,
      t.description,
      `Grain: ${t.grain}`,
      "",
      t.doc,
      "",
      "| column | type | description |",
      "|---|---|---|",
    );
    for (const c of t.columns) if (!c.pii) lines.push(`| ${c.name} | ${c.type} | ${c.description} |`);
    const hidden = t.columns.filter((c) => c.pii).map((c) => c.name);
    if (hidden.length)
      lines.push(
        "",
        `Not available through this interface (personal data): ${hidden.join(", ")}. Queries that mention them are refused.`,
      );
    if (t.joins.length) lines.push("", "Joins: " + t.joins.map((j) => `${j.to} on ${j.on}`).join("; "));
    lines.push("");
  }
  if (model.forbidden_columns?.length)
    lines.push(
      `Personal data (${model.forbidden_columns.join(", ")}) is not available through this interface. Queries that mention it are refused.`,
      "",
    );
  lines.push("## Metrics (use these definitions, do not invent your own)", "");
  for (const [name, m] of Object.entries(model.metrics)) lines.push(`- **${name}**: ${m.definition} SQL: \`${m.sql}\``);
  lines.push("", "## Example questions", "");
  for (const e of model.examples) lines.push(`- ${e}`);
  return lines.join("\n");
}
