#!/usr/bin/env bash
# Posts the seeded questions with a gap so cards arrive staggered. Usage: scripts/seed.sh [gap-seconds]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
API=$(terraform -chdir="$ROOT/infra" output -raw api_url)
GAP=${1:-20}
python3 -I -c 'import json,sys; [print(json.dumps(q)) for q in json.load(open(sys.argv[1]))]' "$ROOT/fixtures/questions-seed.json" | while read -r q; do
  curl -s -X POST "$API/questions" -H 'content-type: application/json' -d "$q"; echo
  sleep "$GAP"
done
