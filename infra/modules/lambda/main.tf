# One Node.js Lambda function the way every function in this project is built: an esbuild bundle folder from
# tooling/bundle-lambda.mjs (index.mjs + source map), zipped here; its own log group with a retention; its own role with
# a logs policy and an optional function policy; nodejs24.x on arm64; structured JSON logs; source maps enabled.
data "archive_file" "this" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.root}/.build/${var.name}.zip"
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.name
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "logs" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }
}

resource "aws_iam_role_policy" "logs" {
  name   = "logs"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.logs.json
}

resource "aws_iam_role_policy" "function" {
  count  = var.policy == null ? 0 : 1
  name   = var.policy_name
  role   = aws_iam_role.this.id
  policy = var.policy
}

resource "aws_lambda_function" "this" {
  function_name    = var.name
  role             = aws_iam_role.this.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  timeout          = var.timeout
  memory_size      = var.memory_size
  filename         = data.archive_file.this.output_path
  source_code_hash = data.archive_file.this.output_base64sha256

  # Structured logs: console.* output lands in CloudWatch as JSON with level, request id and timestamp, queryable
  # without a parse step. Runtime chatter (START/END/REPORT) is kept to warnings.
  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "WARN"
  }

  environment {
    variables = merge({ NODE_OPTIONS = "--enable-source-maps" }, var.environment)
  }

  depends_on = [aws_cloudwatch_log_group.this, aws_iam_role_policy.logs, aws_iam_role_policy.function]
}
