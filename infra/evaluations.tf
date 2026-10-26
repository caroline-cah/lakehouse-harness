# AgentCore Evaluations: a code-based evaluator (SqlGuard), two LLM judges, and an online config over the agent's traces.
data "archive_file" "evaluator" {
  type        = "zip"
  output_path = "${path.module}/.build/evaluator.zip"
  source_file = "${path.module}/../packages/evaluators/dist/index.mjs"
}

resource "aws_cloudwatch_log_group" "evaluator" {
  name              = "/aws/lambda/${local.name}-sqlguard-evaluator"
  retention_in_days = 14
}

resource "aws_iam_role" "evaluator" {
  name               = "${local.name}-sqlguard-evaluator"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "evaluator" {
  name = "logs"
  role = aws_iam_role.evaluator.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.evaluator.arn}:*" }]
  })
}

resource "aws_lambda_function" "evaluator" {
  function_name    = "${local.name}-sqlguard-evaluator"
  role             = aws_iam_role.evaluator.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.evaluator.output_path
  source_code_hash = data.archive_file.evaluator.output_base64sha256
  depends_on       = [aws_cloudwatch_log_group.evaluator, aws_iam_role_policy.evaluator]
}

# --- Execution role the Evaluations service assumes (trust and policy per the AgentCore prerequisites page) ---
data "aws_iam_policy_document" "evaluations_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values = [
        "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account_id}:evaluator/*",
        "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account_id}:online-evaluation-config/*",
      ]
    }
  }
}

resource "aws_iam_role" "evaluations" {
  name               = "AgentCoreEvaluationRole-${local.name}"
  assume_role_policy = data.aws_iam_policy_document.evaluations_trust.json
}

data "aws_iam_policy_document" "evaluations" {
  statement {
    sid       = "CloudWatchLogReadStatement"
    actions   = ["logs:DescribeLogGroups", "logs:GetQueryResults", "logs:StartQuery", "logs:FilterLogEvents"]
    resources = ["*"]
  }
  statement {
    sid       = "CloudWatchLogWriteStatement"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/evaluations/*"]
  }
  statement {
    sid     = "CloudWatchIndexPolicyStatement"
    actions = ["logs:DescribeIndexPolicies", "logs:PutIndexPolicy"]
    resources = [
      "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:aws/spans",
      "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:aws/spans:*",
      "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
    ]
  }
  statement {
    sid     = "BedrockInvokeStatement"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:${local.partition}:bedrock:*::foundation-model/*",
      "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:inference-profile/*",
    ]
  }
  statement {
    sid       = "LambdaInvokeStatement"
    actions   = ["lambda:InvokeFunction", "lambda:GetFunction"]
    resources = [aws_lambda_function.evaluator.arn]
  }
  statement {
    sid       = "Metrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "evaluations" {
  name   = "evaluations"
  role   = aws_iam_role.evaluations.id
  policy = data.aws_iam_policy_document.evaluations.json
}

resource "aws_lambda_permission" "evaluations_invoke" {
  statement_id   = "AllowAgentCoreEvaluations"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.evaluator.function_name
  principal      = "bedrock-agentcore.amazonaws.com"
  source_account = local.account_id
}

# --- Evaluators ---
resource "aws_bedrockagentcore_evaluator" "sql_guard" {
  evaluator_name = "SqlGuard"
  description    = "Every query the agent attempted must pass the data-model SQL guard (deterministic, Lambda)"
  level          = "TOOL_CALL"
  evaluator_config {
    code_based {
      lambda_config {
        lambda_arn                = aws_lambda_function.evaluator.arn
        lambda_timeout_in_seconds = 30
      }
    }
  }
}

locals {
  metric_definitions = join("\n", [for name, m in jsondecode(file("${path.module}/../data-model/data-model.json")).metrics : "- ${name}: ${m.definition}"])
}

resource "aws_bedrockagentcore_evaluator" "data_model_compliance" {
  evaluator_name = "DataModelCompliance"
  description    = "Did the answer use the agreed metric definitions and quote only numbers the tools returned?"
  level          = "TRACE"
  evaluator_config {
    llm_as_a_judge {
      instructions = <<-EOT
        You are a data-governance reviewer for a retail company. The agent may only answer from the lakehouse through its tools,
        and must use these metric definitions exactly:
        ${local.metric_definitions}

        Review the conversation and the final response. Check, in order:
        1. Every number in the response appears in a tool result in the context (allowing rounding), or is a simple difference,
           sum, ratio or percentage of two such numbers that the response shows alongside it.
        2. Any metric named in the question (revenue, return rate, average order value, week, last week) was computed as defined above.
        3. If the question asked for something the data model does not allow (for example personal data), the response refused
           clearly instead of working around it.

        Conversation context: {context}
        Final response: {assistant_turn}
      EOT
      rating_scale {
        numerical {
          value      = 1
          label      = "Compliant"
          definition = "All numbers trace to tool results and every metric follows its definition (or the response correctly refused)."
        }
        numerical {
          value      = 0.5
          label      = "Partly compliant"
          definition = "Numbers trace to tool results but a metric definition was bent, or a minor number cannot be traced."
        }
        numerical {
          value      = 0
          label      = "Non-compliant"
          definition = "A headline number is invented, a metric definition was ignored, or forbidden data was produced."
        }
      }
      model_config {
        bedrock_evaluator_model_config {
          model_id = var.judge_model_id
          inference_config {
            max_tokens  = 1024
            temperature = 0
          }
        }
      }
    }
  }
}

resource "aws_bedrockagentcore_evaluator" "response_similarity" {
  evaluator_name = "ResponseSimilarity"
  description    = "Golden set only: does the response match the expected answer? (uses expected_response, so never online)"
  level          = "TRACE"
  evaluator_config {
    llm_as_a_judge {
      instructions = <<-EOT
        Compare the agent's actual response to the expected response.

        Conversation context: {context}
        Agent's actual response: {assistant_turn}
        Expected response: {expected_response}

        Evaluate semantic similarity. The agent does not need to match word-for-word, but the key numbers, rankings and intent must align.
        Penalize missing critical information or contradictions.
      EOT
      rating_scale {
        numerical {
          value      = 0
          label      = "No Match"
          definition = "The response contradicts or is unrelated to the expected response"
        }
        numerical {
          value      = 0.33
          label      = "Low Similarity"
          definition = "Some overlap in topic but missing most key information"
        }
        numerical {
          value      = 0.67
          label      = "High Similarity"
          definition = "Covers most key points with minor omissions or differences"
        }
        numerical {
          value      = 1
          label      = "Exact Match"
          definition = "Semantically equivalent to the expected response"
        }
      }
      model_config {
        bedrock_evaluator_model_config {
          model_id = var.judge_model_id
          inference_config {
            max_tokens  = 512
            temperature = 0
          }
        }
      }
    }
  }
}

# --- Online evaluation over the agent's own log group, 100 % sampling (it is a demo) ---
resource "aws_bedrockagentcore_online_evaluation_config" "online" {
  online_evaluation_config_name = "lakehouse_demo_online"
  description                   = "Scores every lakehouse agent session"
  evaluation_execution_role_arn = aws_iam_role.evaluations.arn
  enable_on_create              = true

  rule {
    sampling_config {
      sampling_percentage = 100
    }
    # Each question is its own runtime session, so a session is complete one idle minute after the answer.
    session_config {
      session_timeout_minutes = 1
    }
  }

  data_source_config {
    cloudwatch_logs {
      log_group_names = [aws_cloudwatch_log_group.runtime["lakehouse"].name]
      service_names   = ["lakehouse_agent.DEFAULT"]
    }
  }

  dynamic "evaluator" {
    for_each = [
      "Builtin.Helpfulness",
      "Builtin.Correctness",
      "Builtin.ToolSelectionAccuracy",
      "Builtin.ToolParameterAccuracy",
      "Builtin.GoalSuccessRate",
      aws_bedrockagentcore_evaluator.sql_guard.evaluator_id,
      aws_bedrockagentcore_evaluator.data_model_compliance.evaluator_id,
    ]
    content {
      evaluator_id = evaluator.value
    }
  }

  depends_on = [aws_iam_role_policy.evaluations, aws_lambda_permission.evaluations_invoke]
}

output "evaluation_results_log_group" {
  value = try(aws_bedrockagentcore_online_evaluation_config.online.output_config[0].cloudwatch_config[0].log_group_name, "/aws/bedrock-agentcore/evaluations/results/${aws_bedrockagentcore_online_evaluation_config.online.online_evaluation_config_id}")
}

output "evaluator_ids" {
  value = {
    sql_guard             = aws_bedrockagentcore_evaluator.sql_guard.evaluator_id
    data_model_compliance = aws_bedrockagentcore_evaluator.data_model_compliance.evaluator_id
    response_similarity   = aws_bedrockagentcore_evaluator.response_similarity.evaluator_id
  }
}
