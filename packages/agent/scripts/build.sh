#!/usr/bin/env bash
# Builds the AgentCore Runtime deployment package: a CommonJS bundle (required for ADOT auto-instrumentation)
# plus the ADOT package vendored under node_modules, zipped as .build/agent.zip with 644/755 permissions.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"
rm -rf dist .build
mkdir -p dist .build/pkg
npx esbuild src/app.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/app.js \
  --external:@opentelemetry/api --define:process.env.NODE_ENV=\"production\" --log-level=warning
# The bundle is self-contained except for ADOT (must stay a real module so `opentelemetry-instrument` can patch require())
# and @opentelemetry/api, which must be the SAME module instance ADOT registered its global provider on.
cp -r dist .build/pkg/dist
cp -r skills .build/pkg/skills
cat > .build/pkg/package.json <<'JSON'
{ "name": "lakehouse-agent", "private": true, "version": "0.1.0", "engines": { "node": ">=22" } }
JSON
(cd .build/pkg && npm install --omit=dev --no-package-lock --ignore-scripts --arch=arm64 --platform=linux --silent @aws/aws-distro-opentelemetry-node-autoinstrumentation@0.13.0)
find .build/pkg -type d -exec chmod 755 {} + && find .build/pkg -type f -exec chmod 644 {} +
(cd .build/pkg && zip -qr ../agent.zip dist skills node_modules package.json)
ls -la .build/agent.zip
grep -c "require(" dist/app.js >/dev/null && echo "bundle is CommonJS"
