# The lakehouse: CSV files in S3, a Glue catalog that declares ONLY the columns the data model allows,
# an Athena workgroup with a bytes-scanned cap, and a least-privilege reader role.

resource "aws_s3_bucket" "lakehouse" {
  bucket        = "${local.name}-lakehouse-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "lakehouse" {
  bucket                  = aws_s3_bucket.lakehouse.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "lakehouse" {
  bucket = aws_s3_bucket.lakehouse.id
  rule {
    id     = "expire-athena-results"
    status = "Enabled"
    filter {
      prefix = "athena-results/"
    }
    expiration {
      days = 7
    }
  }
}

resource "aws_glue_catalog_database" "lakehouse" {
  name        = "lakehouse_demo"
  description = "Synthetic retail lakehouse for the Harness Engineering demo"
}

# Column lists mirror packages/shared/src/data-model.yaml. customers deliberately omits email and phone:
# they are the last two CSV columns and OpenCSVSerde maps by position, so Athena never reads them.
locals {
  glue_tables = {
    orders = [
      { name = "order_id", type = "string" }, { name = "customer_id", type = "string" }, { name = "store_id", type = "string" },
      { name = "order_ts", type = "string" }, { name = "status", type = "string" }, { name = "channel", type = "string" },
    ]
    order_lines = [
      { name = "order_id", type = "string" }, { name = "line_no", type = "int" }, { name = "product_id", type = "string" },
      { name = "qty", type = "int" }, { name = "unit_price", type = "double" }, { name = "discount", type = "double" },
    ]
    products = [
      { name = "product_id", type = "string" }, { name = "name", type = "string" }, { name = "category", type = "string" },
      { name = "brand", type = "string" }, { name = "list_price", type = "double" },
    ]
    customers = [
      { name = "customer_id", type = "string" }, { name = "city", type = "string" }, { name = "signup_date", type = "string" },
    ]
    stores = [
      { name = "store_id", type = "string" }, { name = "name", type = "string" }, { name = "city", type = "string" }, { name = "region", type = "string" },
    ]
  }
}

resource "aws_glue_catalog_table" "tables" {
  for_each      = local.glue_tables
  name          = each.key
  database_name = aws_glue_catalog_database.lakehouse.name
  table_type    = "EXTERNAL_TABLE"
  parameters = {
    classification          = "csv"
    "skip.header.line.count" = "1"
  }
  storage_descriptor {
    location      = "s3://${aws_s3_bucket.lakehouse.bucket}/data/${each.key}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"
    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.serde2.OpenCSVSerde"
      parameters = {
        separatorChar = ","
        quoteChar     = "\""
        escapeChar    = "\\"
      }
    }
    dynamic "columns" {
      for_each = each.value
      content {
        name = columns.value.name
        type = columns.value.type
      }
    }
  }
}

resource "aws_athena_workgroup" "lakehouse" {
  name          = local.name
  force_destroy = true
  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true
    bytes_scanned_cutoff_per_query     = 104857600
    result_configuration {
      output_location = "s3://${aws_s3_bucket.lakehouse.bucket}/athena-results/"
    }
  }
}

data "aws_iam_policy_document" "reader_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }
}

resource "aws_iam_role" "lakehouse_reader" {
  name               = "${local.name}-lakehouse-reader"
  assume_role_policy = data.aws_iam_policy_document.reader_trust.json
}

data "aws_iam_policy_document" "reader" {
  statement {
    sid       = "AthenaWorkgroup"
    actions   = ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults", "athena:StopQueryExecution", "athena:GetWorkGroup"]
    resources = [aws_athena_workgroup.lakehouse.arn]
  }
  statement {
    sid     = "GlueRead"
    actions = ["glue:GetDatabase", "glue:GetDatabases", "glue:GetTable", "glue:GetTables", "glue:GetPartition", "glue:GetPartitions"]
    resources = [
      "arn:${local.partition}:glue:${local.region}:${local.account_id}:catalog",
      aws_glue_catalog_database.lakehouse.arn,
      "arn:${local.partition}:glue:${local.region}:${local.account_id}:table/${aws_glue_catalog_database.lakehouse.name}/*",
    ]
  }
  statement {
    sid       = "DataRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.lakehouse.arn}/data/*"]
  }
  statement {
    sid       = "BucketList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.lakehouse.arn]
  }
  statement {
    sid       = "ResultsWrite"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
    resources = ["${aws_s3_bucket.lakehouse.arn}/athena-results/*"]
  }
}

resource "aws_iam_role_policy" "reader" {
  name   = "lakehouse-read"
  role   = aws_iam_role.lakehouse_reader.id
  policy = data.aws_iam_policy_document.reader.json
}
