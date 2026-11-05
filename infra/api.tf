# Questions API: adapter (fast path) + worker (slow path) Lambdas, DynamoDB, HTTP API. Mirrors Harness Engineering Part 2.
resource "aws_dynamodb_table" "questions" {
  name         = "${local.name}-questions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "id"
    type = "S"
  }

  global_secondary_index {
    name            = "byId"
    hash_key        = "id"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

variable "github_pat" {
  description = "Fine-grained GitHub token that may comment on the demo issue. Set with scripts/set-github-pat.sh instead of Terraform if preferred."
  type        = string
  default     = "replace-me"
  ephemeral   = true
  sensitive   = true
}

variable "github_pat_version" {
  description = "Bump to rewrite the PAT parameter from var.github_pat."
  type        = number
  default     = 1
}

variable "grounding_threshold" {
  description = "Minimum Guardrails grounding and relevance score for the Grounding badge to show as passed (informative only)."
  type        = number
  default     = 0.7
}

variable "github_issue" {
  type    = string
  default = "caroline-cah/pizza-crew-demo#7"
}

resource "aws_ssm_parameter" "github_pat" {
  name             = "/${local.name}/github/pat"
  type             = "SecureString"
  value_wo         = var.github_pat
  value_wo_version = var.github_pat_version
  lifecycle {
    ignore_changes = [value_wo_version]
  }
}

resource "random_password" "board_token" {
  length  = 40
  special = false
}

data "aws_iam_policy_document" "adapter" {
  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.questions.arn, "${aws_dynamodb_table.questions.arn}/index/*"]
  }
  statement {
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.workflow.arn]
  }
  # Task-token callbacks have no resource to scope to; the token itself is the capability, and the board never sees it.
  statement {
    actions   = ["states:SendTaskSuccess"]
    resources = ["*"]
  }
  statement {
    actions   = ["logs:FilterLogEvents", "logs:StartQuery", "logs:GetQueryResults"]
    resources = ["arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/evaluations/*", "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/evaluations/*:*"]
  }
}

data "aws_iam_policy_document" "worker" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.questions.arn, "${aws_dynamodb_table.questions.arn}/index/*"]
  }
  statement {
    actions = ["bedrock-agentcore:InvokeAgentRuntime"]
    resources = [
      aws_bedrockagentcore_agent_runtime.lakehouse.agent_runtime_arn, "${aws_bedrockagentcore_agent_runtime.lakehouse.agent_runtime_arn}/*",
      aws_bedrockagentcore_agent_runtime.evidence.agent_runtime_arn, "${aws_bedrockagentcore_agent_runtime.evidence.agent_runtime_arn}/*",
    ]
  }
  statement {
    actions   = ["bedrock:ApplyGuardrail"]
    resources = [aws_bedrock_guardrail.grounding.guardrail_arn]
  }
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.github_pat.arn]
  }
}

# The fast path: form, intake, board reads, Approve / Reject (packages/api/src/handlers/adapter.ts).
module "adapter" {
  source      = "./modules/lambda"
  name        = "${local.name}-adapter"
  source_dir  = "${path.module}/../packages/api/dist/adapter"
  policy      = data.aws_iam_policy_document.adapter.json
  policy_name = "adapter"
  timeout     = 10
  memory_size = 256
  environment = {
    QUESTIONS_TABLE        = aws_dynamodb_table.questions.name
    STATE_MACHINE_ARN      = aws_sfn_state_machine.workflow.arn
    BOARD_TOKEN            = random_password.board_token.result
    EVAL_RESULTS_LOG_GROUP = "/aws/bedrock-agentcore/evaluations/results/${aws_bedrockagentcore_online_evaluation_config.online.online_evaluation_config_id}"
  }
}

# The slow path: one action per Step Functions state (packages/api/src/handlers/worker.ts, infra/workflow.tf).
module "worker" {
  source      = "./modules/lambda"
  name        = "${local.name}-worker"
  source_dir  = "${path.module}/../packages/api/dist/worker"
  policy      = data.aws_iam_policy_document.worker.json
  policy_name = "worker"
  timeout     = 300
  memory_size = 512
  environment = {
    QUESTIONS_TABLE      = aws_dynamodb_table.questions.name
    AGENT_RUNTIME_ARN    = aws_bedrockagentcore_agent_runtime.lakehouse.agent_runtime_arn
    EVIDENCE_RUNTIME_ARN = aws_bedrockagentcore_agent_runtime.evidence.agent_runtime_arn
    GUARDRAIL_ID         = aws_bedrock_guardrail.grounding.guardrail_id
    GUARDRAIL_VERSION    = aws_bedrock_guardrail_version.grounding.version
    GROUNDING_THRESHOLD  = tostring(var.grounding_threshold)
    GITHUB_ISSUE         = var.github_issue
    GITHUB_PAT_PARAM     = aws_ssm_parameter.github_pat.name
  }
}

resource "aws_apigatewayv2_api" "questions" {
  name          = "${local.name}-questions"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "adapter" {
  api_id                 = aws_apigatewayv2_api.questions.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.adapter.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "all" {
  api_id    = aws_apigatewayv2_api.questions.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.adapter.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.questions.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 20
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.adapter.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.questions.execution_arn}/*"
}

output "api_url" {
  value = aws_apigatewayv2_api.questions.api_endpoint
}

output "board_token" {
  value     = random_password.board_token.result
  sensitive = true
}

output "questions_table" {
  value = aws_dynamodb_table.questions.name
}
