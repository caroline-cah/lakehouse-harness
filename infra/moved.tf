# The four functions were written out by hand before modules/lambda existed. These keep their state (and so the live
# functions, roles and log groups) when the definitions moved into the module.
moved {
  from = aws_lambda_function.adapter
  to   = module.adapter.aws_lambda_function.this
}
moved {
  from = aws_cloudwatch_log_group.adapter
  to   = module.adapter.aws_cloudwatch_log_group.this
}
moved {
  from = aws_iam_role.adapter
  to   = module.adapter.aws_iam_role.this
}
moved {
  from = aws_iam_role_policy.adapter
  to   = module.adapter.aws_iam_role_policy.function[0]
}

moved {
  from = aws_lambda_function.worker
  to   = module.worker.aws_lambda_function.this
}
moved {
  from = aws_cloudwatch_log_group.worker
  to   = module.worker.aws_cloudwatch_log_group.this
}
moved {
  from = aws_iam_role.worker
  to   = module.worker.aws_iam_role.this
}
moved {
  from = aws_iam_role_policy.worker
  to   = module.worker.aws_iam_role_policy.function[0]
}

moved {
  from = aws_lambda_function.tools
  to   = module.tools.aws_lambda_function.this
}
moved {
  from = aws_cloudwatch_log_group.tools
  to   = module.tools.aws_cloudwatch_log_group.this
}
moved {
  from = aws_iam_role.tools
  to   = module.tools.aws_iam_role.this
}
moved {
  from = aws_iam_role_policy.tools
  to   = module.tools.aws_iam_role_policy.function[0]
}

moved {
  from = aws_lambda_function.evaluator
  to   = module.evaluator.aws_lambda_function.this
}
moved {
  from = aws_cloudwatch_log_group.evaluator
  to   = module.evaluator.aws_cloudwatch_log_group.this
}
moved {
  from = aws_iam_role.evaluator
  to   = module.evaluator.aws_iam_role.this
}
moved {
  from = aws_iam_role_policy.evaluator
  to   = module.evaluator.aws_iam_role_policy.logs
}
