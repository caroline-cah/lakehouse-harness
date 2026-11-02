# The agent on AgentCore Runtime: Node 22 direct code deploy (zip in S3), ADOT auto-instrumentation, public egress.
resource "aws_s3_bucket" "code" {
  bucket        = "${local.name}-agent-code-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "code" {
  bucket                  = aws_s3_bucket.code.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_object" "agent_zip" {
  bucket = aws_s3_bucket.code.id
  key    = "lakehouse_agent/agent.zip"
  source = "${path.module}/../packages/agent/.build/agent.zip"
  # source_hash, not etag: the zip is uploaded multipart, so its S3 ETag is never the md5 and etag would diff forever.
  source_hash = filemd5("${path.module}/../packages/agent/.build/agent.zip")
}

data "aws_iam_policy_document" "runtime_trust" {
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
  }
}

resource "aws_iam_role" "runtime" {
  name               = "${local.name}-agent-runtime"
  assume_role_policy = data.aws_iam_policy_document.runtime_trust.json
}

data "aws_iam_policy_document" "runtime" {
  statement {
    sid     = "Model"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:inference-profile/${var.agent_model_id}",
      "arn:${local.partition}:bedrock:*::foundation-model/*",
    ]
  }
  statement {
    sid       = "Code"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.code.arn}/*"]
  }
  statement {
    sid       = "LogsDescribe"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
  statement {
    sid     = "LogsWrite"
    actions = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams", "logs:PutResourcePolicy"]
    resources = [
      "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
      "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*",
    ]
  }
  statement {
    sid       = "Traces"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"]
    resources = ["*"]
  }
  statement {
    sid       = "Metrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["bedrock-agentcore"]
    }
  }
  statement {
    sid       = "GatewaySecret"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.gateway_client_secret.arn]
  }
  statement {
    sid       = "DirectTools"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.tools.arn]
  }
  statement {
    sid       = "WorkloadIdentity"
    actions   = ["bedrock-agentcore:GetWorkloadAccessToken", "bedrock-agentcore:GetWorkloadAccessTokenForJWT", "bedrock-agentcore:GetWorkloadAccessTokenForUserId"]
    resources = ["arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account_id}:workload-identity-directory/default", "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account_id}:workload-identity-directory/default/workload-identity/*"]
  }
}

resource "aws_iam_role_policy" "runtime" {
  name   = "runtime"
  role   = aws_iam_role.runtime.id
  policy = data.aws_iam_policy_document.runtime.json
}

locals {
  runtime_env = {
    MODEL_ID                           = var.agent_model_id
    TOOL_MODE                          = "gateway"
    GATEWAY_URL                        = aws_bedrockagentcore_gateway.lakehouse.gateway_url
    COGNITO_TOKEN_URL                  = local.cognito_token_url
    COGNITO_CLIENT_ID                  = aws_cognito_user_pool_client.agent.id
    COGNITO_SECRET_PARAM               = aws_ssm_parameter.gateway_client_secret.name
    TOOLS_FUNCTION_NAME                = aws_lambda_function.tools.function_name
    UNIFIED_TRACES_DESTINATION_ENABLED = "true"
    CODE_VERSION                       = filemd5("${path.module}/../packages/agent/.build/agent.zip")
  }
}

resource "aws_bedrockagentcore_agent_runtime" "lakehouse" {
  agent_runtime_name = "lakehouse_agent"
  description        = "Grounded lakehouse agent (Strands TS) for the Harness Engineering talks"
  role_arn           = aws_iam_role.runtime.arn

  agent_runtime_artifact {
    code_configuration {
      code {
        s3 {
          bucket = aws_s3_bucket.code.bucket
          prefix = aws_s3_object.agent_zip.key
        }
      }
      runtime     = "NODE_22"
      entry_point = ["opentelemetry-instrument", "dist/app.js"]
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  protocol_configuration {
    server_protocol = "HTTP"
  }

  lifecycle_configuration {
    idle_runtime_session_timeout = 300
    max_lifetime                 = 1800
  }

  environment_variables = local.runtime_env

  depends_on = [aws_iam_role_policy.runtime]
}

# Same code, other role: re-derives every verified claim from the data model, or denies it.
resource "aws_bedrockagentcore_agent_runtime" "evidence" {
  agent_runtime_name = "lakehouse_evidence_agent"
  description        = "Evidence agent: verifies or denies each claim of the lakehouse agent"
  role_arn           = aws_iam_role.runtime.arn

  agent_runtime_artifact {
    code_configuration {
      code {
        s3 {
          bucket = aws_s3_bucket.code.bucket
          prefix = aws_s3_object.agent_zip.key
        }
      }
      runtime     = "NODE_22"
      entry_point = ["opentelemetry-instrument", "dist/app.js"]
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  protocol_configuration {
    server_protocol = "HTTP"
  }

  lifecycle_configuration {
    idle_runtime_session_timeout = 300
    max_lifetime                 = 1800
  }

  environment_variables = merge(local.runtime_env, { AGENT_ROLE = "evidence" })

  depends_on = [aws_iam_role_policy.runtime]
}

# AgentCore creates a runtime's log group on its first invocation. Create it up front instead, so the online
# evaluation config (which must name an existing log group) can be created in the same apply, and retention is set.
resource "aws_cloudwatch_log_group" "runtime" {
  for_each          = { lakehouse = aws_bedrockagentcore_agent_runtime.lakehouse.agent_runtime_id, evidence = aws_bedrockagentcore_agent_runtime.evidence.agent_runtime_id }
  name              = "/aws/bedrock-agentcore/runtimes/${each.value}-DEFAULT"
  retention_in_days = 14
}

output "agent_runtime_arn" {
  value = aws_bedrockagentcore_agent_runtime.lakehouse.agent_runtime_arn
}

output "agent_runtime_id" {
  value = aws_bedrockagentcore_agent_runtime.lakehouse.agent_runtime_id
}

output "agent_log_group" {
  value = aws_cloudwatch_log_group.runtime["lakehouse"].name
}

output "evidence_runtime_arn" {
  value = aws_bedrockagentcore_agent_runtime.evidence.agent_runtime_arn
}

output "evidence_log_group" {
  value = aws_cloudwatch_log_group.runtime["evidence"].name
}
