#!/usr/bin/env bash
# Syncs the generated CSVs to the lakehouse bucket's data/ prefix. Run generate.py first.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BUCKET=${BUCKET:-$(cd "$ROOT/infra" && terraform output -raw lakehouse_bucket)}
REGION=${AWS_REGION:-eu-central-1}
aws s3 sync "$ROOT/data/" "s3://$BUCKET/data/" --delete --region "$REGION"
echo "synced $ROOT/data to s3://$BUCKET/data"
