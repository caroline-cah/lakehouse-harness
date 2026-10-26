output "lakehouse_bucket" {
  value = aws_s3_bucket.lakehouse.bucket
}

output "athena_workgroup" {
  value = aws_athena_workgroup.lakehouse.name
}

output "glue_database" {
  value = aws_glue_catalog_database.lakehouse.name
}

output "lakehouse_reader_role_arn" {
  value = aws_iam_role.lakehouse_reader.arn
}

output "medallion_job" {
  value = aws_glue_job.medallion.name
}
