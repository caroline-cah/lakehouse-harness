import { SendTaskSuccessCommand, SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { createAdapter } from "./adapter.js";
import { listEvaluations } from "./evaluations.js";
import { createDynamoStore } from "./store.js";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const region = process.env.AWS_REGION ?? "eu-central-1";
const sfn = new SFNClient({ region });
const logs = new CloudWatchLogsClient({ region });

export const handler = createAdapter({
  store: createDynamoStore(env("QUESTIONS_TABLE")),
  boardToken: env("BOARD_TOKEN"),
  startWorkflow: async (id) => {
    await sfn.send(new StartExecutionCommand({ stateMachineArn: env("STATE_MACHINE_ARN"), name: id, input: JSON.stringify({ id }) }));
  },
  resume: async (taskToken, decision) => {
    await sfn.send(new SendTaskSuccessCommand({ taskToken, output: JSON.stringify(decision) }));
  },
  listEvaluations: (id) => listEvaluations({ logs, logGroup: process.env.EVAL_RESULTS_LOG_GROUP ?? "" }, id),
});
