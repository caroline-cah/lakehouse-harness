# The answer workflow as a Step Functions state machine: one state per harness step, explicit timeouts, fail-closed
# catches, and a durable wait for the human (task token). Every state runs the steps Lambda (packages/api/src/worker.ts)
# with one action; only the question id travels between states, everything else lives in DynamoDB.
locals {
  # Retry only when Lambda itself was unavailable, never on our own errors: a retried answer costs, a retried publish posts twice.
  lambda_retry = [{
    ErrorEquals     = ["Lambda.ServiceException", "Lambda.AWSLambdaException", "Lambda.SdkClientException", "Lambda.TooManyRequestsException"]
    IntervalSeconds = 2
    MaxAttempts     = 2
    BackoffRate     = 2
  }]
  to_failure = [{ ErrorEquals = ["States.ALL"], ResultPath = "$.error", Next = "RecordFailure" }]

  step = { for action in ["answer", "ground", "verify", "publish"] : action => {
    Type       = "Task"
    Resource   = "arn:${local.partition}:states:::lambda:invoke"
    Parameters = { FunctionName = aws_lambda_function.worker.arn, Payload = { action = action, "id.$" = "$.id" } }
  } }

  workflow = {
    Comment = "Harness: answer, ground, verify, wait for a human, publish or reject"
    StartAt = "Answer"
    States = {
      Answer = merge(local.step.answer, {
        TimeoutSeconds = 240
        ResultSelector = { "next.$" = "$.Payload.next" }
        ResultPath     = "$.answer"
        Retry          = local.lambda_retry
        Catch          = local.to_failure
        Next           = "Route"
      })
      Route = {
        Type = "Choice"
        Choices = [
          { Variable = "$.answer.next", StringEquals = "ground", Next = "Ground" },
          { Variable = "$.answer.next", StringEquals = "decide", Next = "WaitForDecision" },
        ]
        Default = "Done"
      }
      Ground = merge(local.step.ground, {
        TimeoutSeconds = 60
        ResultPath     = null
        Retry          = local.lambda_retry
        Catch          = local.to_failure
        Next           = "Verify"
      })
      Verify = merge(local.step.verify, {
        TimeoutSeconds = 240
        ResultPath     = null
        Retry          = local.lambda_retry
        Catch          = [{ ErrorEquals = ["States.ALL"], ResultPath = "$.error", Next = "DenyUnverified" }]
        Next           = "WaitForDecision"
      })
      DenyUnverified = {
        Type       = "Task"
        Resource   = "arn:${local.partition}:states:::lambda:invoke"
        Parameters = { FunctionName = aws_lambda_function.worker.arn, Payload = { action = "deny", "id.$" = "$.id", "error.$" = "$.error.Cause" } }
        ResultPath = null
        Catch      = local.to_failure
        Next       = "WaitForDecision"
      }
      WaitForDecision = {
        Type           = "Task"
        Resource       = "arn:${local.partition}:states:::lambda:invoke.waitForTaskToken"
        Parameters     = { FunctionName = aws_lambda_function.worker.arn, Payload = { action = "await", "id.$" = "$.id", "token.$" = "$$.Task.Token" } }
        TimeoutSeconds = 86400
        ResultPath     = "$.decision"
        Catch = [
          { ErrorEquals = ["States.Timeout"], ResultPath = "$.error", Next = "Expire" },
          { ErrorEquals = ["States.ALL"], ResultPath = "$.error", Next = "RecordFailure" },
        ]
        Next = "Decide"
      }
      Decide = {
        Type    = "Choice"
        Choices = [{ Variable = "$.decision.decision", StringEquals = "publish", Next = "Publish" }]
        Default = "Reject"
      }
      Publish = merge(local.step.publish, {
        TimeoutSeconds = 60
        ResultPath     = null
        Catch          = local.to_failure
        Next           = "Done"
      })
      Reject = {
        Type       = "Task"
        Resource   = "arn:${local.partition}:states:::lambda:invoke"
        Parameters = { FunctionName = aws_lambda_function.worker.arn, Payload = { action = "reject", "id.$" = "$.id", "reason.$" = "$.decision.reason" } }
        ResultPath = null
        Catch      = local.to_failure
        Next       = "Done"
      }
      Expire = {
        Type       = "Task"
        Resource   = "arn:${local.partition}:states:::lambda:invoke"
        Parameters = { FunctionName = aws_lambda_function.worker.arn, Payload = { action = "reject", "id.$" = "$.id", reason = "No decision within 24 hours." } }
        ResultPath = null
        Catch      = local.to_failure
        Next       = "Done"
      }
      RecordFailure = {
        Type       = "Task"
        Resource   = "arn:${local.partition}:states:::lambda:invoke"
        Parameters = { FunctionName = aws_lambda_function.worker.arn, Payload = { action = "fail", "id.$" = "$.id", "error.$" = "$.error.Cause" } }
        ResultPath = null
        Next       = "Failed"
      }
      Failed = { Type = "Fail", Error = "HarnessStepFailed", Cause = "A step failed; the question is marked failed with the reason." }
      Done   = { Type = "Succeed" }
    }
  }
}

data "aws_iam_policy_document" "states_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "workflow" {
  name               = "${local.name}-workflow"
  assume_role_policy = data.aws_iam_policy_document.states_assume.json
}

data "aws_iam_policy_document" "workflow" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.worker.arn, "${aws_lambda_function.worker.arn}:*"]
  }
  statement {
    actions   = ["logs:CreateLogDelivery", "logs:GetLogDelivery", "logs:UpdateLogDelivery", "logs:DeleteLogDelivery", "logs:ListLogDeliveries", "logs:PutResourcePolicy", "logs:DescribeResourcePolicies", "logs:DescribeLogGroups"]
    resources = ["*"]
  }
  statement {
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "workflow" {
  name   = "workflow"
  role   = aws_iam_role.workflow.id
  policy = data.aws_iam_policy_document.workflow.json
}

resource "aws_cloudwatch_log_group" "workflow" {
  name              = "/aws/vendedlogs/states/${local.name}-workflow"
  retention_in_days = 14
}

resource "aws_sfn_state_machine" "workflow" {
  name       = "${local.name}-workflow"
  role_arn   = aws_iam_role.workflow.arn
  type       = "STANDARD"
  definition = jsonencode(local.workflow)

  # Errors only, without execution data: questions and answers stay in DynamoDB, not in the logs.
  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.workflow.arn}:*"
    include_execution_data = false
    level                  = "ERROR"
  }
  tracing_configuration {
    enabled = true
  }

  depends_on = [aws_iam_role_policy.workflow]
}

output "state_machine_arn" {
  value = aws_sfn_state_machine.workflow.arn
}
