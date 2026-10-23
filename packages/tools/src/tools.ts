import { guardSql, renderModelMarkdown, type DataModel } from "@lakehouse/shared";

export type ToolName = "describe_model" | "explain_metric" | "query";
export const TOOL_NAMES: readonly ToolName[] = ["describe_model", "explain_metric", "query"];

export interface QueryOutput {
  columns: string[];
  rows: Record<string, unknown>[];
  bytes_scanned: number;
  query_execution_id: string;
}

export interface AthenaRunner {
  run(sql: string): Promise<QueryOutput>;
}

export type ToolResult = { ok: true; content: unknown } | { ok: false; error: string };

export interface ToolDeps {
  athena: AthenaRunner;
  model: DataModel;
}

const MAX_ROWS = 200;

/** One function per tool, dispatched by name. Errors are sentences the model can act on. */
export async function handleTool(name: ToolName, args: Record<string, unknown>, deps: ToolDeps): Promise<ToolResult> {
  switch (name) {
    case "describe_model":
      return { ok: true, content: renderModelMarkdown(deps.model) };

    case "explain_metric": {
      const metricName = typeof args.name === "string" ? args.name.trim().toLowerCase() : "";
      const metric = deps.model.metrics[metricName];
      if (!metric) {
        return { ok: false, error: `Unknown metric "${metricName}". Defined metrics: ${Object.keys(deps.model.metrics).join(", ")}.` };
      }
      return { ok: true, content: { name: metricName, definition: metric.definition, sql: metric.sql } };
    }

    case "query": {
      if (typeof args.sql !== "string" || args.sql.trim() === "") return { ok: false, error: "query needs a non-empty `sql` string." };
      const guard = guardSql(args.sql, deps.model);
      if (!guard.ok) return { ok: false, error: `Query refused (${guard.rule}): ${guard.message}` };
      const out = await deps.athena.run(guard.sql);
      const rows = out.rows.slice(0, MAX_ROWS);
      return {
        ok: true,
        content: {
          columns: out.columns,
          rows,
          row_count: rows.length,
          bytes_scanned: out.bytes_scanned,
          query_execution_id: out.query_execution_id,
          sql: guard.sql,
        },
      };
    }

    default:
      return { ok: false, error: `Unknown tool "${String(name)}". Available: ${TOOL_NAMES.join(", ")}.` };
  }
}

/** AgentCore Gateway passes `${target}___${tool}` in the Lambda client context; strip the target prefix. */
export function toolNameFromContext(context: { clientContext?: { custom?: Record<string, unknown> } }): string | undefined {
  const raw = context.clientContext?.custom?.bedrockAgentCoreToolName;
  if (typeof raw !== "string" || raw === "") return undefined;
  const i = raw.indexOf("___");
  return i >= 0 ? raw.slice(i + 3) : raw;
}
