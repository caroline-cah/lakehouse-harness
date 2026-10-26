#!/usr/bin/env bash
# The medallion, by hand:
#   scripts/medallion.sh build     load bronze from the CSV drop and create or rebuild the gold views (Glue job)
#   scripts/medallion.sh refresh   ask Glue to refresh gold.sales now instead of waiting for its schedule
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
REGION=${AWS_REGION:-eu-central-1}
tf() { terraform -chdir="$ROOT/infra" output -raw "$1"; }

case "${1:-}" in
  build)
    JOB=$(tf medallion_job)
    RUN=$(aws glue start-job-run --region "$REGION" --job-name "$JOB" --query JobRunId --output text)
    echo "job run $RUN"
    while :; do
      STATE=$(aws glue get-job-run --region "$REGION" --job-name "$JOB" --run-id "$RUN" --query JobRun.JobRunState --output text)
      echo "  $STATE"
      case "$STATE" in SUCCEEDED) break ;; FAILED|ERROR|TIMEOUT|STOPPED) exit 1 ;; esac
      sleep 20
    done
    ;;
  refresh)
    aws glue start-materialized-view-refresh-task-run --region "$REGION" \
      --catalog-id "$(aws sts get-caller-identity --query Account --output text)" \
      --database-name "$(tf glue_database)" --table-name sales
    ;;
  *)
    echo "usage: $0 build|refresh" >&2
    exit 2
    ;;
esac
