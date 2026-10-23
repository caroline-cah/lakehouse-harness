# Lakehouse Harness

**Harness Engineering, live: a grounded lakehouse agent on Amazon Bedrock AgentCore.**
Companion code for two AWS user-group talks (Linköping 29 Oct 2026, Stockholm 5 Nov 2026) and Part 3 of the
[Harness Engineering](https://builder.aws.com/content/3HfiXvfzDCTk6OT5ryfygmpJu6W/harness-engineering-building-an-ops-agent-with-agentcore-and-strands) series.

You ask the company lakehouse a question from your phone. An agent on AgentCore Runtime answers through a governed
data model (never the raw tables), every claim carries evidence, Bedrock checks the answer before a human sees it,
and nothing is published until someone presses Approve.

```
phone ──QR──▶ API Gateway ─▶ adapter Lambda ─▶ DynamoDB questions ─▶ worker Lambda (async, no retries)
                                                                          │ InvokeAgentRuntime (session = question id)
                                                                          ▼
                                  AgentCore Runtime (NODE_22, Strands TS, ADOT)  ──traces──▶ CloudWatch GenAI Observability
                                     │ MCP + Cognito JWT                                        │
                                     ▼                                                          ▼
                          AgentCore Gateway ─▶ tools Lambda ─▶ sql guard ─▶ reader role ─▶ Athena   AgentCore Evaluations (online)
                            describe_model / explain_metric / query                                 Builtin.* + SqlGuard + DataModelCompliance
worker: GroundedAnswer (Zod, validated twice) ─▶ Guardrails contextual grounding ─▶ verdicts on the card
board (React): Asked / Working / Needs you / Published / Failed ─▶ Approve ─▶ GitHub comment on the demo issue
```

## Packages

| Path | What |
|---|---|
| `packages/shared` | The data-model contract (`data-model.yaml`), the SQL guard, number tracing, the `GroundedAnswer` schema |
| `packages/tools` | Lambda behind the Gateway: `describe_model`, `explain_metric`, `query` (Athena via the reader role) |
| `packages/agent` | Strands TypeScript agent for AgentCore Runtime (`/invocations`, `/ping`), gateway or direct tools |
| `packages/api` | Adapter (form, intake, board API, Approve/Reject) and worker (runtime, contract, grounding) Lambdas |
| `packages/evaluators` | Code-based `SqlGuard` evaluator Lambda for AgentCore Evaluations |
| `packages/board` | The projector board (Vite + React), with replay mode |
| `infra/` | Terraform: lakehouse, Gateway + Cognito, Runtime, Guardrail, API, Evaluations |
| `scripts/` | Data generator, observability setup, invoke, seed, reset, replay recorder, golden-set evaluation |
| `golden/` | Golden questions and the generator's exact expected numbers |

## Setup (once)

```bash
nvm use 24 && pnpm install
python3 scripts/lakehouse/generate.py                     # data/ and golden/expected.json
scripts/observability-enable.sh                            # CloudWatch Transaction Search (account, once)
pnpm -r build && packages/agent/scripts/build.sh           # Lambda bundles and the AgentCore zip
(cd infra && terraform init && terraform apply)            # eu-central-1
scripts/lakehouse/upload.sh                                # CSVs to S3
gh auth token | scripts/set-github-pat.sh                  # or a fine-grained PAT; lets Approve post the comment
```

## Run

```bash
pnpm tsx scripts/invoke.ts "What was last week's revenue per store?"      # the runtime directly
scripts/seed.sh 20                                                        # five questions through the API
cd packages/board && VITE_API_URL=$(terraform -chdir=../../infra output -raw api_url) \
  VITE_BOARD_TOKEN=$(terraform -chdir=../../infra output -raw board_token) pnpm dev    # http://localhost:5174
pnpm tsx scripts/eval-golden.ts                                           # golden set → talk/golden-results.md
```

Every push of agent code: `packages/agent/scripts/build.sh && terraform -chdir=infra apply`.

## Tests

`pnpm test` (Vitest in every package) and `cd scripts/lakehouse && python3 -m unittest test_generate`.

## What is enforced where

| Rule | Prompt | Tool / guard | Catalog + IAM | Contract | Guardrails | Evaluations |
|---|---|---|---|---|---|---|
| Only contract tables | ✓ | `unknown_table` | reader role scoped to the database | | | SqlGuard |
| No personal data | ✓ | `pii_column` (names, `*`) | `email`, `phone` not declared in Glue | | | SqlGuard |
| Read-only, bounded | ✓ | `select_only`, `limit` | workgroup scan cap | | | SqlGuard |
| Numbers come from rows | ✓ | | | `superRefine` (twice) | contextual grounding | DataModelCompliance |
| Metric definitions | ✓ | `explain_metric` | | | | DataModelCompliance |
| Refuse instead of work around | ✓ | | | `refusals[]` | | Builtin judges |
| Nothing leaves without a human | | | | | | board Approve → GitHub |

