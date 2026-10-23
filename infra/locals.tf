data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name       = "${var.project}-${var.stage}"
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  region     = var.aws_region
  tags = {
    Project   = "lakehouse-harness"
    Stage     = var.stage
    ManagedBy = "terraform"
    Event     = "aws-ug-2026-10-29"
  }
}
