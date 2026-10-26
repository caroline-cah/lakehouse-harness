# Lakehouse Harness

**Harness Engineering, live: a grounded lakehouse agent on Amazon Bedrock AgentCore.**
Companion code for two AWS user-group talks (Linköping 29 Oct 2026, Stockholm 5 Nov 2026) and Part 3 of the
[Harness Engineering](https://builder.aws.com/content/3HfiXvfzDCTk6OT5ryfygmpJu6W/harness-engineering-building-an-ops-agent-with-agentcore-and-strands) series.

You ask the company lakehouse a question from your phone. An agent on AgentCore Runtime answers through a governed
data model (never the raw tables), every claim carries evidence, a second agent has to reproduce each claim or deny
it, Bedrock checks the answer before a human sees it, and nothing is published until someone presses Approve.

## The talk

Caroline Cah, Digital Lead at Wallenius Wilhelmsen. Slides, speaker notes and the demo runbook are in
[`talk/`](talk/README.md).

| Part of the talk | Where it lives |
|---|---|
| Ask from your phone | `packages/api` (form, workflow steps), `infra/workflow.tf` (Step Functions), `packages/board` |
| A governed data model, not raw tables | [`data-model/`](data-model/README.md), `packages/tools`, `packages/shared/src/sql-guard.ts`, `packages/agent/skills` |
| Evidence-backed answers | `packages/shared/src/contract.ts`, `infra/guardrail.tf`, the evidence agent (`packages/agent/src/evidence-prompt.ts`) |
| Check the agent's work before it ships | `.github/workflows/ci.yml`, `golden/`, `infra/evaluations.tf`, Approve in `packages/api/src/adapter.ts` |

```
phone ──QR──▶ API Gateway ─▶ adapter Lambda ─▶ DynamoDB questions ─▶ Step Functions workflow (one execution per question)
                                                                          │ InvokeAgentRuntime (session = question id)
                                                                          ▼
                                  AgentCore Runtime (NODE_22, Strands TS, ADOT)  ──traces──▶ CloudWatch GenAI Observability
                                     │ MCP + Cognito JWT                                        │
                                     ▼                                                          ▼
                          AgentCore Gateway ─▶ tools Lambda ─▶ sql guard ─▶ reader role ─▶ Athena   AgentCore Evaluations (online)
                            describe_model / explain_metric / query                                 Builtin.* + SqlGuard + DataModelCompliance
workflow: Answer ─▶ GroundedAnswer (Zod, validated twice) ─▶ Guardrails contextual grounding ─▶ evidence agent (second runtime,
        same code, AGENT_ROLE=evidence: re-runs every verified claim, VERIFIED or DENIED) ─▶ verdicts on the card
board (React): Asked / Working / Needs you / Published / Failed ─▶ Approve (task token, waits up to 24 h) ─▶ Publish state ─▶ GitHub comment
```

## Packages

| Path | What |
|---|---|
| `data-model/` | The enterprise data model in Markdown: one file per table, front matter is the contract, the text is the meaning |
| `packages/shared` | The compiled data model, the SQL guard, number tracing, the `GroundedAnswer` schema |
| `packages/tools` | Lambda behind the Gateway: `describe_model`, `explain_metric`, `query` (Athena via the reader role) |
| `packages/agent` | Strands TypeScript agents for AgentCore Runtime (`/invocations`, `/ping`): the analyst and, with `AGENT_ROLE=evidence`, the evidence agent; AWS skills in `skills/` |
| `packages/api` | Adapter Lambda (form, intake, board API; Approve/Reject resume the workflow by task token) and the steps Lambda behind every workflow state (answer, ground, verify, wait, publish, reject) |
| `packages/evaluators` | Code-based `SqlGuard` evaluator Lambda for AgentCore Evaluations |
| `packages/board` | The projector board (Vite + React), with replay mode |
| `infra/` | Terraform: lakehouse (bronze, gold, the medallion Glue job), Gateway + Cognito, both Runtimes, Guardrail, API, Evaluations |
| `scripts/` | Data generator, observability setup, invoke, seed, reset, replay recorder, golden-set evaluation |
| `golden/` | Golden questions and the generator's exact expected numbers |

## Setup (once)

```bash
nvm use 24 && pnpm install
python3 scripts/lakehouse/generate.py                     # data/ and golden/expected.json
scripts/observability-enable.sh                            # CloudWatch Transaction Search (account, once)
pnpm -r build && packages/agent/scripts/build.sh           # Lambda bundles and the AgentCore zip
(cd infra && terraform init && terraform apply)            # eu-central-1
scripts/lakehouse/upload.sh                                # CSVs to S3 (the bronze drop)
scripts/medallion.sh build                                 # Glue job: bronze Iceberg tables + gold materialized views
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

`pnpm test` (Vitest in every package) and `cd scripts/lakehouse && python3 -m unittest test_generate`. CI runs both on
every pull request, plus a check that the compiled data model matches `data-model/*.md`.

## What is enforced where

| Rule | Prompt | Tool / guard | Catalog + IAM | Contract | Guardrails | Evidence agent | Evaluations |
|---|---|---|---|---|---|---|---|
| Only contract tables | ✓ | `unknown_table` | reader role scoped to the gold database | | | denies | SqlGuard |
| No personal data | ✓ | `pii_column` (names, `*`) | gold never selects `email`, `phone`; reader role sees gold only | | | | SqlGuard |
| Read-only, bounded | ✓ | `select_only`, `limit` | workgroup scan cap | | | | SqlGuard |
| Numbers come from rows | ✓ | | | `superRefine` (twice) | contextual grounding | re-runs the query | DataModelCompliance |
| Metric definitions | ✓ | `explain_metric` | | | | checks the definition | DataModelCompliance |
| Refuse instead of work around | ✓ | | | `refusals[]` | | | Builtin judges |
| Nothing leaves without a human | | | | | | DENIED blocks Approve (409) | board Approve → GitHub |
| Tool authorization | ✓ | three tools via Gateway | Cognito JWT, reader role | | | | next: AgentCore Policy |

