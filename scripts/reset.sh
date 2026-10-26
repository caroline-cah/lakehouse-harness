#!/usr/bin/env bash
# Empties the board: deletes every question item. Keep the board open; it just goes blank.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TABLE=$(terraform -chdir="$ROOT/infra" output -raw questions_table)
REGION=${AWS_REGION:-eu-central-1}
aws dynamodb query --region "$REGION" --table-name "$TABLE" --key-condition-expression 'pk = :pk' --expression-attribute-values '{":pk":{"S":"Q"}}' --projection-expression 'pk, sk' --output json \
  | python3 -I -c '
import json,sys
items=json.load(sys.stdin)["Items"]
for i in range(0,len(items),25):
    print(json.dumps({sys.argv[1]:[{"DeleteRequest":{"Key":it}} for it in items[i:i+25]]}))
' "$TABLE" | while read -r batch; do
  aws dynamodb batch-write-item --region "$REGION" --request-items "$batch" >/dev/null && echo "  deleted a batch"
done
echo "board is empty"
