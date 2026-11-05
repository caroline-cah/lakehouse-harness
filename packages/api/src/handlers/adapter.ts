// Lambda entrypoint for the questions API (infra/api.tf → `adapter.handler`), behind the HTTP API.
// This file is the composition root: it reads the environment and builds the real AWS clients once per container,
// then hands them to the router. Nothing here is unit-tested; everything it wires is.
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { SendTaskSuccessCommand, SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { awsRegion, requireEnv } from "@lakehouse/shared";
import { listEvaluations } from "../evaluations.js";
import { createAdapter } from "../http/router.js";
import { createDynamoStore } from "../store.js";

const config = {
  questionsTable: requireEnv("QUESTIONS_TABLE"),
  boardToken: requireEnv("BOARD_TOKEN"),
  stateMachineArn: requireEnv("STATE_MACHINE_ARN"),
  evaluationResultsLogGroup: process.env.EVAL_RESULTS_LOG_GROUP ?? "",
};

const region = awsRegion();
const sfn = new SFNClient({ region });
const logs = new CloudWatchLogsClient({ region });

export const handler = createAdapter({
  store: createDynamoStore(config.questionsTable),
  boardToken: config.boardToken,
  startWorkflow: async (id) => {
    await sfn.send(
      new StartExecutionCommand({ stateMachineArn: config.stateMachineArn, name: id, input: JSON.stringify({ id }) }),
    );
  },
  resume: async (taskToken, decision) => {
    await sfn.send(new SendTaskSuccessCommand({ taskToken, output: JSON.stringify(decision) }));
  },
  listEvaluations: (id) => listEvaluations({ logs, logGroup: config.evaluationResultsLogGroup }, id),
});
