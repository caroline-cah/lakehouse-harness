#!/usr/bin/env bash
# Prints a client-credentials access token for the gateway (Cognito). Secret read from SSM.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT/infra"
TOKEN_URL=$(terraform output -raw cognito_token_url)
CLIENT_ID=$(terraform output -raw cognito_client_id)
SECRET=$(aws ssm get-parameter --region "${AWS_REGION:-eu-central-1}" --name "$(terraform output -raw cognito_secret_param)" --with-decryption --query Parameter.Value --output text)
curl -s -u "$CLIENT_ID:$SECRET" -d "grant_type=client_credentials&scope=lakehouse-gateway/invoke" "$TOKEN_URL" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
