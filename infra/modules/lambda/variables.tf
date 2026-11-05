variable "name" {
  description = "Function name; also the role name and the log group suffix."
  type        = string
}

variable "source_dir" {
  description = "Bundle folder from tooling/bundle-lambda.mjs: packages/<pkg>/dist/<handler>."
  type        = string
}

variable "policy" {
  description = "IAM policy JSON for what the function may do, besides writing its own logs. Null for a function that needs nothing else."
  type        = string
  default     = null
}

variable "policy_name" {
  description = "Name of the inline role policy that holds `policy`."
  type        = string
  default     = "function"
}

variable "timeout" {
  type    = number
  default = 30
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "log_retention_days" {
  type    = number
  default = 14
}
