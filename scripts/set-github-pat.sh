#!/usr/bin/env bash
# Stores a GitHub token in the SSM parameter the adapter reads, without it touching Terraform state or the repo.
# Usage: echo "<token>" | scripts/set-github-pat.sh     (or: gh auth token | scripts/set-github-pat.sh)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NAME=$(cd "$ROOT/infra" && terraform output -raw questions_table >/dev/null && echo "/lakehouse-demo/github/pat")
read -r TOKEN
[ -n "$TOKEN" ] || { echo "no token on stdin" >&2; exit 1; }
aws ssm put-parameter --region "${AWS_REGION:-eu-central-1}" --name "$NAME" --type SecureString --value "$TOKEN" --overwrite >/dev/null
echo "stored in $NAME"
