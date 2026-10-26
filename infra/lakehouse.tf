# The lakehouse: a CSV drop in S3, a bronze and a gold Glue database, an Athena workgroup with a bytes-scanned cap,
# and a least-privilege reader role that can only see gold.

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

# Medallion in two layers. Bronze: the CSV drop under data/, loaded as-is into Iceberg (personal data included).
# Gold: Iceberg materialized views defined in data-model/*.md, refreshed by Glue on their own schedule.
# The agent's reader role can read gold and nothing else.
resource "aws_glue_catalog_database" "bronze" {
  name         = "lakehouse_bronze"
  description  = "Raw retail data as Iceberg tables. Contains personal data; no agent can read it."
  location_uri = "s3://${aws_s3_bucket.lakehouse.bucket}/warehouse/lakehouse_bronze/"
}

resource "aws_glue_catalog_database" "lakehouse" {
  name         = "lakehouse_gold"
  description  = "Gold layer: materialized views described by data-model/*.md, the only data the agent can query"
  location_uri = "s3://${aws_s3_bucket.lakehouse.bucket}/warehouse/lakehouse_gold/"
}

resource "aws_s3_object" "medallion_script" {
  bucket = aws_s3_bucket.lakehouse.bucket
  key    = "jobs/medallion.py"
  source = "${path.module}/../scripts/medallion.py"
  etag   = filemd5("${path.module}/../scripts/medallion.py")
}

resource "aws_s3_object" "data_model" {
  bucket = aws_s3_bucket.lakehouse.bucket
  key    = "jobs/data-model.json"
  source = "${path.module}/../data-model/data-model.json"
  etag   = filemd5("${path.module}/../data-model/data-model.json")
}

# The definer role: runs the job and, stored in each view, every scheduled refresh after it.
data "aws_iam_policy_document" "glue_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["glue.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "medallion" {
  name               = "${local.name}-medallion"
  assume_role_policy = data.aws_iam_policy_document.glue_trust.json
}

resource "aws_iam_role_policy_attachment" "medallion_glue" {
  role       = aws_iam_role.medallion.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSGlueServiceRole"
}

data "aws_iam_policy_document" "medallion" {
  statement {
    sid       = "Lakehouse"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.lakehouse.arn, "${aws_s3_bucket.lakehouse.arn}/*"]
  }
  statement {
    sid     = "Catalog"
    actions = ["glue:GetDatabase", "glue:GetTable", "glue:GetTables", "glue:CreateTable", "glue:UpdateTable", "glue:DeleteTable", "glue:GetPartitions"]
    resources = [
      "arn:${local.partition}:glue:${local.region}:${local.account_id}:catalog",
      aws_glue_catalog_database.bronze.arn,
      aws_glue_catalog_database.lakehouse.arn,
      "arn:${local.partition}:glue:${local.region}:${local.account_id}:table/${aws_glue_catalog_database.bronze.name}/*",
      "arn:${local.partition}:glue:${local.region}:${local.account_id}:table/${aws_glue_catalog_database.lakehouse.name}/*",
    ]
  }
  statement {
    sid       = "PassSelfForRefresh"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.medallion.arn]
  }
}

resource "aws_iam_role_policy" "medallion" {
  name   = "medallion"
  role   = aws_iam_role.medallion.id
  policy = data.aws_iam_policy_document.medallion.json
}

resource "aws_glue_job" "medallion" {
  name              = "${local.name}-medallion"
  role_arn          = aws_iam_role.medallion.arn
  glue_version      = "5.1"
  worker_type       = "G.1X"
  number_of_workers = 2
  timeout           = 30

  command {
    name            = "glueetl"
    python_version  = "3"
    script_location = "s3://${aws_s3_bucket.lakehouse.bucket}/${aws_s3_object.medallion_script.key}"
  }

  default_arguments = {
    "--datalake-formats"        = "iceberg"
    "--enable-glue-datacatalog" = "true"
    "--BUCKET"                  = aws_s3_bucket.lakehouse.bucket
    "--DATA_MODEL_KEY"          = aws_s3_object.data_model.key
    # As in the Glue materialized views guide: without glue.region / glue.id / glue.account-id the view's source-table
    # references are stored with an empty region and catalog, and CREATE MATERIALIZED VIEW fails.
    "--conf" = join(" --conf ", [
      "spark.sql.extensions=org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions",
      "spark.sql.catalog.glue_catalog=org.apache.iceberg.spark.SparkCatalog",
      "spark.sql.catalog.glue_catalog.type=glue",
      "spark.sql.catalog.glue_catalog.warehouse=s3://${aws_s3_bucket.lakehouse.bucket}/warehouse/",
      "spark.sql.catalog.glue_catalog.glue.region=${local.region}",
      "spark.sql.catalog.glue_catalog.glue.id=${local.account_id}",
      "spark.sql.catalog.glue_catalog.glue.account-id=${local.account_id}",
      "spark.sql.defaultCatalog=glue_catalog",
      "spark.sql.optimizer.incrementalMVRefresh.enabled=true",
    ])
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
    sid       = "GoldRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.lakehouse.arn}/warehouse/lakehouse_gold/*"]
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
