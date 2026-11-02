#!/usr/bin/env bash
# tools/list and one tools/call through the gateway, as an MCP client would.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
URL=$(cd "$ROOT/infra" && terraform output -raw gateway_url)
TOKEN=$("$ROOT/scripts/gateway-token.sh")
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")
echo "== tools/list"
curl -s "${H[@]}" "$URL" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print([t["name"] for t in d["result"]["tools"]])'
echo "== tools/call lakehouse___query"
curl -s "${H[@]}" "$URL" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"lakehouse___query","arguments":{"sql":"SELECT store_region, count(DISTINCT order_id) orders FROM sales GROUP BY 1","purpose":"smoke"}}}' | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d["result"])[:400])'
