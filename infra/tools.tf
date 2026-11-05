# The lakehouse tools Lambda: describe_model, explain_metric, query. Published to agents through AgentCore Gateway (gateway.tf).
data "aws_iam_policy_document" "tools" {
  statement {
    sid       = "AssumeReader"
    actions   = ["sts:AssumeRole"]
    resources = [aws_iam_role.lakehouse_reader.arn]
  }
}

module "tools" {
  source      = "./modules/lambda"
  name        = "${local.name}-tools"
  source_dir  = "${path.module}/../packages/tools/dist/tools"
  policy      = data.aws_iam_policy_document.tools.json
  policy_name = "tools"
  timeout     = 90
  memory_size = 512
  environment = {
    ATHENA_WORKGROUP   = aws_athena_workgroup.lakehouse.name
    GLUE_DATABASE      = aws_glue_catalog_database.lakehouse.name
    LAKEHOUSE_ROLE_ARN = aws_iam_role.lakehouse_reader.arn
  }
}

output "tools_function_name" {
  value = module.tools.function_name
}
