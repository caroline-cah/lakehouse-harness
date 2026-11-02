import type { Context } from "aws-lambda";
import { loadDataModel } from "@lakehouse/shared";
import { createAthenaRunner } from "./athena.js";
import { handleTool, TOOL_NAMES, toolNameFromContext, type ToolName } from "./tools.js";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

const deps = {
  model: loadDataModel(),
  athena: createAthenaRunner({
    region: process.env.AWS_REGION ?? "eu-central-1",
    workgroup: env("ATHENA_WORKGROUP"),
    database: env("GLUE_DATABASE"),
    roleArn: env("LAKEHOUSE_ROLE_ARN"),
  }),
};

/**
 * Gateway Lambda target: event = tool args, tool name in the client context. A refusal is returned as content, not thrown:
 * the gateway replaces a thrown error with "An internal error occurred", and the model must read why the guard said no.
 */
export async function handler(event: Record<string, unknown>, context: Context): Promise<unknown> {
  const name = toolNameFromContext(context as unknown as { clientContext?: { custom?: Record<string, unknown> } }) ?? (event.tool as string | undefined);
  if (!name || !(TOOL_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown tool "${name ?? ""}". Available: ${TOOL_NAMES.join(", ")}.`);
  }
  const result = await handleTool(name as ToolName, event, deps);
  return result.ok ? result.content : { error: result.error };
}
