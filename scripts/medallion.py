"""Glue 5.1 job: bronze (the CSV drop, as-is, as Iceberg) and gold (the materialized views in data-model/*.md).

Run it with scripts/medallion.sh build. After that there is nothing to orchestrate: Glue refreshes each view on the
schedule in its `materialization.refresh`, incrementally where it can.
"""
import json
import sys

import boto3
from awsglue.utils import getResolvedOptions
from pyspark.sql import SparkSession

args = getResolvedOptions(sys.argv, ["BUCKET", "DATA_MODEL_KEY"])
bucket = args["BUCKET"]
spark = SparkSession.builder.getOrCreate()

# Bronze: every column as the source wrote it, strings included. Personal data stays here.
for table in ("orders", "order_lines", "products", "customers", "stores"):
    df = spark.read.option("header", True).csv(f"s3://{bucket}/data/{table}/")
    df.writeTo(f"glue_catalog.lakehouse_bronze.{table}").using("iceberg").createOrReplace()
    print(f"bronze.{table}: {df.count()} rows")

# Gold: one materialized view per data-model table. Bronze was just replaced, so refresh in full once.
model = json.loads(boto3.client("s3").get_object(Bucket=bucket, Key=args["DATA_MODEL_KEY"])["Body"].read())
for name, table in model["tables"].items():
    m = table["materialization"]
    view = f"glue_catalog.{model['database']}.{name}"
    spark.sql(f"CREATE MATERIALIZED VIEW IF NOT EXISTS {view} SCHEDULE REFRESH EVERY {m['refresh']} AS {m['sql']}")
    spark.sql(f"REFRESH MATERIALIZED VIEW {view} FULL")
    print(f"gold.{name}: {spark.table(view).count()} rows")
