# The lakehouse tools Lambda: describe_model, explain_metric, query. Published to agents through AgentCore Gateway (gateway.tf).
data "archive_file" "tools" {
  type        = "zip"
  output_path = "${path.module}/.build/tools.zip"
  source_file = "${path.module}/../packages/tools/dist/index.mjs"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "tools" {
  name               = "${local.name}-tools"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "tools" {
  statement {
    sid       = "AssumeReader"
    actions   = ["sts:AssumeRole"]
    resources = [aws_iam_role.lakehouse_reader.arn]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.tools.arn}:*"]
  }
}

resource "aws_iam_role_policy" "tools" {
  name   = "tools"
  role   = aws_iam_role.tools.id
  policy = data.aws_iam_policy_document.tools.json
}

resource "aws_cloudwatch_log_group" "tools" {
  name              = "/aws/lambda/${local.name}-tools"
  retention_in_days = 14
}

resource "aws_lambda_function" "tools" {
  function_name    = "${local.name}-tools"
  role             = aws_iam_role.tools.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  timeout          = 90
  memory_size      = 512
  filename         = data.archive_file.tools.output_path
  source_code_hash = data.archive_file.tools.output_base64sha256

  environment {
    variables = {
      ATHENA_WORKGROUP   = aws_athena_workgroup.lakehouse.name
      GLUE_DATABASE      = aws_glue_catalog_database.lakehouse.name
      LAKEHOUSE_ROLE_ARN = aws_iam_role.lakehouse_reader.arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.tools, aws_iam_role_policy.tools]
}

output "tools_function_name" {
  value = aws_lambda_function.tools.function_name
}
