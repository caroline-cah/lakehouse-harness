# AgentCore Gateway: the one door between agents and the lakehouse tools. JWT in, Lambda out.
data "aws_iam_policy_document" "gateway_trust" {
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

resource "aws_iam_role" "gateway" {
  name               = "${local.name}-gateway"
  assume_role_policy = data.aws_iam_policy_document.gateway_trust.json
}

data "aws_iam_policy_document" "gateway" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [module.tools.arn]
  }
}

resource "aws_iam_role_policy" "gateway" {
  name   = "invoke-tools"
  role   = aws_iam_role.gateway.id
  policy = data.aws_iam_policy_document.gateway.json
}

resource "aws_bedrockagentcore_gateway" "lakehouse" {
  name            = local.name
  description     = "Lakehouse tools behind a data-model contract"
  role_arn        = aws_iam_role.gateway.arn
  protocol_type   = "MCP"
  authorizer_type = "CUSTOM_JWT"

  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = local.cognito_discovery_url
      allowed_clients = [aws_cognito_user_pool_client.agent.id]
    }
  }

  protocol_configuration {
    mcp {
      instructions       = "Tools for answering questions from the retail lakehouse. Call describe_model first."
      supported_versions = ["2025-03-26", "2025-06-18"]
    }
  }

  depends_on = [aws_iam_role_policy.gateway]
}

resource "aws_lambda_permission" "gateway_tools" {
  statement_id  = "AllowAgentCoreGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.tools.function_name
  principal     = "bedrock-agentcore.amazonaws.com"
  source_arn    = aws_bedrockagentcore_gateway.lakehouse.gateway_arn
}

resource "aws_bedrockagentcore_gateway_target" "lakehouse" {
  name               = "lakehouse"
  description        = "describe_model, explain_metric and query against the governed lakehouse"
  gateway_identifier = aws_bedrockagentcore_gateway.lakehouse.gateway_id

  credential_provider_configuration {
    gateway_iam_role {}
  }

  target_configuration {
    mcp {
      lambda {
        lambda_arn = module.tools.arn

        tool_schema {
          inline_payload {
            name        = "describe_model"
            description = "Returns the enterprise data model: tables, allowed columns, joins, metric definitions and example questions. Always call this first."
            input_schema {
              type = "object"
            }
          }
          inline_payload {
            name        = "explain_metric"
            description = "Returns the agreed definition and SQL fragment of a business metric (revenue, return_rate, average_order_value, week, last_week)."
            input_schema {
              type = "object"
              property {
                name        = "name"
                type        = "string"
                description = "Metric name"
                required    = true
              }
            }
          }
          inline_payload {
            name        = "query"
            description = "Runs one read-only Athena SQL statement against the data model and returns up to 200 rows. Queries naming personal-data columns are refused."
            input_schema {
              type = "object"
              property {
                name        = "sql"
                type        = "string"
                description = "One SELECT or WITH statement using plain lowercase table and column names"
                required    = true
              }
              property {
                name        = "purpose"
                type        = "string"
                description = "One sentence on what the query is for"
                required    = true
              }
            }
          }
        }
      }
    }
  }
}

output "gateway_url" {
  value = aws_bedrockagentcore_gateway.lakehouse.gateway_url
}

output "gateway_id" {
  value = aws_bedrockagentcore_gateway.lakehouse.gateway_id
}
