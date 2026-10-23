import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { tool } from "@strands-agents/sdk";
import { z } from "zod";

/** Fallback tool source: the same Lambda the gateway fronts, invoked directly with the gateway's client-context convention. */
export function directTools(functionName: string, region: string) {
  const lambda = new LambdaClient({ region });
  const call = async (name: string, args: Record<string, unknown>) => {
    const ctx = Buffer.from(JSON.stringify({ custom: { bedrockAgentCoreToolName: `lakehouse___${name}` } })).toString("base64");
    const r = await lambda.send(new InvokeCommand({ FunctionName: functionName, ClientContext: ctx, Payload: Buffer.from(JSON.stringify(args)) }));
    const text = Buffer.from(r.Payload ?? new Uint8Array()).toString("utf8");
    if (r.FunctionError) {
      const e = JSON.parse(text) as { errorMessage?: string };
      throw new Error(e.errorMessage ?? text);
    }
    return JSON.parse(text) as unknown;
  };
  return [
    tool({
      name: "lakehouse___describe_model",
      description: "Returns the enterprise data model: tables, allowed columns, joins, metric definitions and example questions. Always call this first.",
      inputSchema: z.object({}),
      callback: () => call("describe_model", {}),
    }),
    tool({
      name: "lakehouse___explain_metric",
      description: "Returns the agreed definition and SQL fragment of a business metric.",
      inputSchema: z.object({ name: z.string() }),
      callback: (input) => call("explain_metric", input),
    }),
    tool({
      name: "lakehouse___query",
      description: "Runs one read-only Athena SQL statement against the data model and returns up to 200 rows. Queries naming personal-data columns are refused.",
      inputSchema: z.object({ sql: z.string(), purpose: z.string() }),
      callback: (input) => call("query", input),
    }),
  ];
}
