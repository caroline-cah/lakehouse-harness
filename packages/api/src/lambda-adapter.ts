import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { createAdapter } from "./adapter.js";
import { listEvaluations } from "./evaluations.js";
import { createGithubPublisher } from "./github.js";
import { createDynamoStore } from "./store.js";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const region = process.env.AWS_REGION ?? "eu-central-1";
const lambda = new LambdaClient({ region });
const logs = new CloudWatchLogsClient({ region });

export const handler = createAdapter({
  store: createDynamoStore(env("QUESTIONS_TABLE")),
  boardToken: env("BOARD_TOKEN"),
  invokeWorker: async (id) => {
    await lambda.send(new InvokeCommand({ FunctionName: env("WORKER_FUNCTION_NAME"), InvocationType: "Event", Payload: Buffer.from(JSON.stringify({ id })) }));
  },
  publish: createGithubPublisher({ issue: env("GITHUB_ISSUE"), patParam: env("GITHUB_PAT_PARAM"), region }),
  listEvaluations: (id) => listEvaluations({ logs, logGroup: process.env.EVAL_RESULTS_LOG_GROUP ?? "" }, id),
});
