import { parse } from "yaml";
import { DATA_MODEL_YAML } from "./data-model.generated.js";

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
}

export interface Metric {
  definition: string;
  sql: string;
}

export interface DataModel {
  database: string;
  tables: Record<string, Table>;
  metrics: Record<string, Metric>;
  examples: string[];
}

let cached: DataModel | undefined;

/** The enterprise data model, parsed once from the embedded YAML contract. */
export function loadDataModel(): DataModel {
  if (!cached) cached = parse(DATA_MODEL_YAML) as DataModel;
  return cached;
}

export function tableNames(model: DataModel): string[] {
  return Object.keys(model.tables);
}

/** Column names flagged `pii: true` anywhere in the model, deduplicated, in declaration order. */
export function piiColumns(model: DataModel): string[] {
  const out: string[] = [];
  for (const t of Object.values(model.tables)) {
    for (const c of t.columns) if (c.pii && !out.includes(c.name)) out.push(c.name);
  }
  return out;
}

/** What `describe_model` returns: the contract as Markdown, with PII columns named but not described as usable. */
export function renderModelMarkdown(model: DataModel): string {
  const lines: string[] = [];
  lines.push(`# Lakehouse data model (${model.database})`, "");
  lines.push("Query tables with plain Athena/Trino SQL. Qualify tables as `" + model.database + ".<table>` or use bare names.", "");
  for (const [name, t] of Object.entries(model.tables)) {
    lines.push(`## ${name}`, t.description, `Grain: ${t.grain}`, "", "| column | type | description |", "|---|---|---|");
    for (const c of t.columns) if (!c.pii) lines.push(`| ${c.name} | ${c.type} | ${c.description} |`);
    const hidden = t.columns.filter((c) => c.pii).map((c) => c.name);
    if (hidden.length) lines.push("", `Not available through this interface (personal data): ${hidden.join(", ")}. Queries that mention them are refused.`);
    if (t.joins.length) lines.push("", "Joins: " + t.joins.map((j) => `${j.to} on ${j.on}`).join("; "));
    lines.push("");
  }
  lines.push("## Metrics (use these definitions, do not invent your own)", "");
  for (const [name, m] of Object.entries(model.metrics)) lines.push(`- **${name}**: ${m.definition} SQL: \`${m.sql}\``);
  lines.push("", "## Example questions", "");
  for (const e of model.examples) lines.push(`- ${e}`);
  return lines.join("\n");
}
