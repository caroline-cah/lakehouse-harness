# Bedrock Guardrails contextual grounding: is the summary grounded in the rows it cites, and relevant to the question?
# Detect mode: the worker reads the scores and shows them; nothing is blocked silently.
resource "aws_bedrock_guardrail" "grounding" {
  name                      = "${local.name}-grounding"
  description               = "Contextual grounding check for lakehouse answers"
  blocked_input_messaging   = "Answer withheld: not grounded in the lakehouse evidence."
  blocked_outputs_messaging = "Answer withheld: not grounded in the lakehouse evidence."

  contextual_grounding_policy_config {
    filters_config {
      type      = "GROUNDING"
      threshold = 0.7
    }
    filters_config {
      type      = "RELEVANCE"
      threshold = 0.7
    }
  }
}

resource "aws_bedrock_guardrail_version" "grounding" {
  guardrail_arn = aws_bedrock_guardrail.grounding.guardrail_arn
  description   = "v1"
}

output "guardrail_id" {
  value = aws_bedrock_guardrail.grounding.guardrail_id
}

output "guardrail_version" {
  value = aws_bedrock_guardrail_version.grounding.version
}
