variable "aws_region" {
  type    = string
  default = "eu-central-1"
}

variable "project" {
  type    = string
  default = "lakehouse"
}

variable "stage" {
  type    = string
  default = "demo"
}

variable "agent_model_id" {
  description = "Bedrock inference profile the agent uses."
  type        = string
  default     = "eu.anthropic.claude-sonnet-4-6"
}

variable "judge_model_id" {
  description = "Bedrock inference profile the AgentCore Evaluations judges use."
  type        = string
  default     = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
}
