// Lambda entrypoint for the lakehouse tools (infra/tools.tf → `tools.handler`): describe_model, explain_metric, query.
// AgentCore Gateway (infra/gateway.tf) fronts it as MCP tools; the agent can also invoke it directly (TOOL_MODE=direct).
import type { Context } from "aws-lambda";
import { awsRegion, loadDataModel, requireEnv } from "@lakehouse/shared";
import { createAthenaRunner } from "../athena.js";
import { handleTool, TOOL_NAMES, toolNameFromContext, type ToolName } from "../tools.js";

const deps = {
  model: loadDataModel(),
  athena: createAthenaRunner({
    region: awsRegion(),
    workgroup: requireEnv("ATHENA_WORKGROUP"),
    database: requireEnv("GLUE_DATABASE"),
    roleArn: requireEnv("LAKEHOUSE_ROLE_ARN"),
  }),
};

/**
 * Gateway Lambda target: event = tool args, tool name in the client context. A refusal is returned as content, not thrown:
 * the gateway replaces a thrown error with "An internal error occurred", and the model must read why the guard said no.
 */
export async function handler(event: Record<string, unknown>, context: Context): Promise<unknown> {
  // The runtime sets `clientContext.custom`; the aws-lambda types spell it `Custom`, hence the cast.
  const name =
    toolNameFromContext(context as unknown as { clientContext?: { custom?: Record<string, unknown> } }) ??
    (event.tool as string | undefined);
  if (!name || !(TOOL_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown tool "${name ?? ""}". Available: ${TOOL_NAMES.join(", ")}.`);
  }
  const result = await handleTool(name as ToolName, event, deps);
  return result.ok ? result.content : { error: result.error };
}
