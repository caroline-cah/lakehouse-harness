# Lakehouse Harness

**Harness Engineering, live: a grounded lakehouse agent on Amazon Bedrock AgentCore.**

Ask the company lakehouse a question from your phone. An agent answers through a governed data model, never the raw
tables. Every number it quotes has to come from the rows it cites. A second agent re-runs every claim and denies what it
cannot reproduce. Bedrock Guardrails checks the answer, and nothing is published until a human presses Approve.

Companion code for two AWS user-group talks (Linköping 29 Oct 2026, Stockholm 5 Nov 2026) and Part 3 of the
[Harness Engineering](https://builder.aws.com/content/3HfiXvfzDCTk6OT5ryfygmpJu6W/harness-engineering-building-an-ops-agent-with-agentcore-and-strands)
series. Slides, speaker notes and the demo runbook are in [`talk/`](talk/README.md).

## The solution

![Architecture](diagrams/architecture.svg)

Edit the picture in [Excalidraw](https://excalidraw.com): open [`diagrams/architecture.excalidraw`](diagrams/architecture.excalidraw).

## How a question flows

1. **Ask.** The phone form posts to an HTTP API. The adapter Lambda stores the question in DynamoDB and starts one
   Step Functions execution, named after the question, so it can never run twice.
2. **Answer.** The analyst agent (Strands TypeScript on AgentCore Runtime) gets three tools through AgentCore Gateway:
   `describe_model`, `explain_metric` and `query`. A SQL guard refuses anything outside the data model, any personal-data
   column by name, and `SELECT *`. Queries run on Athena as a role that can only see the gold layer.
3. **Check.** The answer must satisfy the evidence contract: claims, each pointing at the SQL, the Athena query id and
   the rows, with every number in the summary traceable to those rows. Guardrails scores grounding. Then the evidence
   agent, a second runtime, re-runs every verified claim with its own queries and marks it VERIFIED or DENIED.
4. **Act.** The card waits on the board for up to 24 hours. Approve resumes the workflow and posts a GitHub comment.
   A DENIED claim blocks Approve on the server. Publish is never retried, so nothing is posted twice.

The data path is the simple part: a CSV drop in S3, loaded once by a Glue job into bronze Iceberg tables, and one gold
Iceberg materialized view that Glue refreshes hourly. No orchestrator, no ETL between layers, no CDC code.

## Where things live

| Part | Path |
|---|---|
| The data model, in Markdown | [`data-model/`](data-model/README.md): one file per table, front matter is the contract, the text is the meaning |
| Contract, SQL guard, number tracing | `packages/shared/src/` |
| Tools Lambda behind the Gateway | `packages/tools/src/` |
| Analyst and evidence agent (same code, `AGENT_ROLE` picks) | `packages/agent/src/` |
| Adapter and worker Lambdas | `packages/api/src/`: `adapter.ts` for the fast path, `worker.ts` for one action per state |
| The state machine | `infra/workflow.tf` |
| SqlGuard evaluator for AgentCore Evaluations | `packages/evaluators/src/` |
| The board (Vite + React, with replay mode) | `packages/board/` |
| Everything deployed | `infra/`: Terraform for the lakehouse, Gateway and Cognito, both runtimes, Guardrail, API, Evaluations |
| Scripts | `scripts/`: data generator, observability setup, invoke, seed, reset, replay recorder, golden-set evaluation |
| Golden questions and exact expected numbers | `golden/` |

## Run it

Once:

```bash
nvm use 24 && pnpm install
python3 scripts/lakehouse/generate.py                     # data/ and golden/expected.json
scripts/observability-enable.sh                            # CloudWatch Transaction Search (account, once)
pnpm -r build && packages/agent/scripts/build.sh           # Lambda bundles and the AgentCore zip
(cd infra && terraform init && terraform apply)            # eu-central-1
scripts/lakehouse/upload.sh                                # CSVs to S3
scripts/medallion.sh build                                 # Glue job: bronze tables + the gold view
gh auth token | scripts/set-github-pat.sh                  # lets Approve post the comment
```

Then:

```bash
pnpm tsx scripts/invoke.ts "What was last week's revenue per store?"      # both runtimes, directly
scripts/seed.sh 20                                                        # five questions through the API, 20 s apart
cd packages/board && VITE_API_URL=$(terraform -chdir=../../infra output -raw api_url) \
  VITE_BOARD_TOKEN=$(terraform -chdir=../../infra output -raw board_token) pnpm dev    # http://localhost:5174
pnpm tsx scripts/eval-golden.ts                                           # golden set, writes talk/golden-results.md
```

After changing agent code: `packages/agent/scripts/build.sh && terraform -chdir=infra apply`.

Tests: `pnpm test` runs Vitest in every package, and `cd scripts/lakehouse && python3 -m unittest test_generate` checks
the generator. CI runs both on every pull request, plus a check that the compiled data model still matches
`data-model/*.md`.

## Every rule, twice

No rule lives in only one place.

| Rule | Prompt | Tool / guard | Catalog + IAM | Contract | Guardrails | Evidence agent | Evaluations |
|---|---|---|---|---|---|---|---|
| Only contract tables | ✓ | `unknown_table` | reader role scoped to gold | | | denies | SqlGuard |
| No personal data | ✓ | `pii_column` (names, `*`) | gold never holds `email`, `phone`; reader sees gold only | | | | SqlGuard |
| Read-only, bounded | ✓ | `select_only`, `limit` | workgroup scan cap | | | | SqlGuard |
| Numbers come from rows | ✓ | | | `superRefine` (twice) | contextual grounding | re-runs the query | DataModelCompliance |
| Metric definitions | ✓ | `explain_metric` | | | | checks the definition | DataModelCompliance |
| Refuse instead of work around | ✓ | | | `refusals[]` | | | Builtin judges |
| Nothing leaves without a human | | | | | | DENIED blocks Approve (409) | board Approve → GitHub |
| Tool authorization | ✓ | three tools via Gateway | Cognito JWT, reader role | | | | next: AgentCore Policy |
