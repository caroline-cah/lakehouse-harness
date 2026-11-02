# Demo runbook

Three demos, each with a fallback. Region `eu-central-1`. Run everything from the repo root.

## The day before

- [ ] Bedrock quota. This account has 10 requests per minute for Claude Sonnet 4.6 (`aws service-quotas get-service-quota
      --service-code bedrock --quota-code L-00FF3314`). One question is about ten model calls across both agents, so a room
      asking at once throttles; the workflow retries a throttled step three times (20, 40, 80 s) before it fails or denies.
      Request an account-level increase in the Service Quotas console well before the talk.
- [ ] `pnpm install && pnpm test`: green.
- [ ] `pnpm -r build && packages/agent/scripts/build.sh && terraform -chdir=infra apply`. This deploys both runtimes:
      `lakehouse_agent` and `lakehouse_evidence_agent`.
- [ ] `scripts/lakehouse/upload.sh && scripts/medallion.sh build`. The job loads bronze and builds
      `lakehouse_gold.sales`. Check in Athena that `SELECT COUNT(*) FROM lakehouse_gold.sales` returns rows.
- [ ] The five seed questions through the API (`scripts/seed.sh 20`, the argument is the gap in seconds; shorter gaps
      throttle the runtime): each Step Functions execution reaches Wait for decision, and Approve on the board moves one
      through Publish to Succeeded.
- [ ] The smoke test:
      `pnpm tsx scripts/invoke.ts "What was the revenue per store in ISO week 42 of 2026?"`. It must print an answer,
      then a review with VERIFIED verdicts.
- [ ] `pnpm tsx scripts/eval-golden.ts`: g1–g7 match `golden/expected.json`, g8 (email) is refused, g9 (margin) is
      refused or denied. Keep `talk/golden-results.md` open in a tab as the fallback for demo 3.
- [ ] Rebuild the deck with the real form URL and repo URL (see [README](README.md)) and test the QR on mobile data.
- [ ] Record a replay as the fallback for demos 1 and 2: `scripts/seed.sh 20`, then
      `pnpm tsx scripts/record-replay.ts 12`, and copy `fixtures/replay.json` to `packages/board/public/replay.json`.
- [ ] Prepare the demo 3 branch (below) and push it, **without** opening the pull request.

### Demo 3 branch: `demo/drop-pii-guard`

```bash
git switch -c demo/drop-pii-guard
```

In `packages/shared/src/sql-guard.ts`, delete the `if (piiHit) { ... }` block, so a query that names `email` is no
longer refused. Commit as "Simplify the SQL guard" and push. Locally, `pnpm --filter @lakehouse/shared test` should
fail on the `pii_column` tests. That's the red you show on stage.

## One hour before

- [ ] `scripts/reset.sh`: an empty board.
- [ ] Board on the projector:
      `cd packages/board && VITE_API_URL=$(terraform -chdir=../../infra output -raw api_url) VITE_BOARD_TOKEN=$(terraform -chdir=../../infra output -raw board_token) pnpm dev`
- [ ] Tabs open: CloudWatch → GenAI Observability → Bedrock AgentCore (both agents), Step Functions → the
      `lakehouse-harness-workflow` executions (graph view shows each question waiting at Wait for decision), the repo on
      GitHub, the Actions tab.
- [ ] Ask one warm-up question from your own phone, so both runtimes are warm.

## On stage

| When | Demo | Show | If it fails |
|---|---|---|---|
| Part 2 | **Ask it, then ask for email** | A revenue card → claim chip → SQL. Trace: `describe_model`, `explain_metric`, `query`. Then the email question: refusal on the card, `pii_column` in the trace. | Replay: `VITE_REPLAY=/replay.json pnpm dev` in `packages/board` |
| Part 3 | **A claim the data can't back** | "What was the gross margin per product in ISO week 42 of 2026?" Either a refusal, or a DENIED stamp and no Approve button. Then a normal card: VERIFIED stamps, Approve, the GitHub comment. | Replay, plus the g9 row in `talk/golden-results.md` |
| Part 4 | **A PR that drops the PII guard** | Open the pull request from `demo/drop-pii-guard`. CI goes red on the SQL guard tests. Close it, don't merge. | Run `pnpm --filter @lakehouse/shared test` on the branch in the terminal |

## After

- [ ] Close the demo pull request and delete the branch.
- [ ] `scripts/reset.sh`.
