import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import type { AthenaRunner, QueryOutput } from "./tools.js";

export interface AthenaOptions {
  region: string;
  workgroup: string;
  database: string;
  /** The least-privilege reader role; assumed so every query is attributable to it. */
  roleArn: string;
  pollMs?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Athena prints doubles ≥ 1e7 as "2.18061E7"; the model must never quote that, so cells become plain decimal strings. */
export function normaliseCell(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 10 }) : v;
  }
  return v;
}

export function createAthenaRunner(opts: AthenaOptions): AthenaRunner {
  const client = new AthenaClient({
    region: opts.region,
    credentials: fromTemporaryCredentials({
      params: { RoleArn: opts.roleArn, RoleSessionName: "lakehouse-tools" },
      clientConfig: { region: opts.region },
    }),
  });
  const pollMs = opts.pollMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  return {
    async run(sql: string): Promise<QueryOutput> {
      const start = await client.send(
        new StartQueryExecutionCommand({
          QueryString: sql,
          WorkGroup: opts.workgroup,
          QueryExecutionContext: { Database: opts.database },
        }),
      );
      const id = start.QueryExecutionId!;
      const deadline = Date.now() + timeoutMs;
      let bytes = 0;
      for (;;) {
        const ex = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
        const state = ex.QueryExecution?.Status?.State;
        if (state === "SUCCEEDED") {
          bytes = ex.QueryExecution?.Statistics?.DataScannedInBytes ?? 0;
          break;
        }
        if (state === "FAILED" || state === "CANCELLED") {
          throw new Error(`Athena ${state}: ${ex.QueryExecution?.Status?.StateChangeReason ?? "no reason"}`);
        }
        if (Date.now() > deadline) throw new Error("Athena query timed out after 60 s; narrow the query.");
        await sleep(pollMs);
      }
      const res = await client.send(new GetQueryResultsCommand({ QueryExecutionId: id, MaxResults: 201 }));
      const rowsRaw = res.ResultSet?.Rows ?? [];
      const columns = (res.ResultSet?.ResultSetMetadata?.ColumnInfo ?? []).map((c) => c.Name ?? "");
      const rows = rowsRaw.slice(1).map((r) => {
        const o: Record<string, unknown> = {};
        (r.Data ?? []).forEach((d, i) => (o[columns[i] ?? `c${i}`] = normaliseCell(d.VarCharValue)));
        return o;
      });
      return { columns, rows, bytes_scanned: bytes, query_execution_id: id };
    },
  };
}
