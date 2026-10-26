# Off the shelf: what AWS gives you for this talk's problem

Researched 25 October 2026 for the build-vs-buy slides. Regions: **FRA** = eu-central-1 (Frankfurt, where the demo
runs), **ARN** = eu-north-1 (Stockholm). Items marked ⚠ could not be fully confirmed: verify before quoting on stage.

## Summary

| Concern | Buy (off the shelf) | Build (only the harness does this) |
|---|---|---|
| Ask your data in plain language | Amazon Quick chat agents · SageMaker Data Agent · Bedrock KB structured data | Business answers from Athena/Iceberg with a contract per answer |
| Governed semantics | Quick enriched datasets + Topics · KB `generationContext` · Redshift generative SQL context · SageMaker Catalog glossary | Metric definitions as versioned Markdown, read by agent, guard, Terraform and evaluators |
| Agent sees gold only | Lake Formation grants on Iceberg materialized views | (buy) |
| Read-only SQL | awslabs MCP servers (read-only allowlists) · AWS MCP Server + Agent Toolkit | Refuse personal data by name, with a reason, in tested code |
| Grounded answers | Guardrails contextual grounding · Automated Reasoning checks | Evidence per claim: SQL, query id, rows |
| Verify each claim | — nothing — | Evidence agent re-runs every claim: VERIFIED or DENIED |
| Human approval | Strands HumanInTheLoop · AgentCore harness `inline_function` (both pause tool calls) | Approve on the final answer, blocked when a claim is DENIED |
| Evaluate the agent | AgentCore Evaluations (built-in, Lambda and LLM-judge evaluators) · Strands Evals | (buy: SqlGuard and DataModelCompliance already run on it) |
| Tool authorization | AgentCore Policy (Cedar on Gateway) · Strands CedarAuthorization | Next step for the SQL guard rules |
| Check before merge | AWS sample: GitHub Actions + AgentCore Evaluations, PR blocked below 0.8 | Golden set with exact expected numbers from the generator |

**Headline:** buy the platform (Quick, Lake Formation, Guardrails, AgentCore Evaluations and Policy). The new ground is
per-claim evidence, independent re-verification and an Approve gate on the answer; no AWS service or sample combines them.

## Ask your data

**Amazon Quick** (formerly QuickSight / Quick Suite). Chat agents and Spaces over datasets and Topics; Direct Query on
Athena, S3 Tables and Redshift. The "Explanation" shows the generated SQL. Row- and column-level security carry through
to chat. Metrics are calculated fields or custom instructions, not a metrics object. Multi-dataset Topics are in public
preview (Jul 2026); dataset enrichment (descriptions, synonyms) ⚠ GA status not stated. No per-claim evidence, no
approve gate, no test harness (AWS suggests hand-testing 10–20 questions). Pricing: Professional $20, Enterprise $40
per user/month, plus $250 per account/month. FRA: yes, agentic features since Mar 2026. ARN: Quick Sight only, no
agentic features.
- https://docs.aws.amazon.com/quick/latest/userguide/regions.html
- https://aws.amazon.com/about-aws/whats-new/2026/03/amazon-quick-now-available-in-the-aws-frankfurt-region
- https://aws.amazon.com/blogs/machine-learning/build-a-unified-semantic-layer-across-datasets-with-multi-dataset-topics-in-amazon-quick/
- https://aws.amazon.com/blogs/machine-learning/enrich-your-datasets-with-business-context-migrating-from-legacy-topics-to-semantic-datasets-in-amazon-quick/
- https://aws.amazon.com/quick/pricing

**SageMaker Data Agent** in the Unified Studio query editor (Mar 2026). Natural language to SQL for Athena and Redshift,
proposes a plan you approve, SQL lands in cells you accept, reject or run. The closest AWS has to an approval step, but
it is for analysts, not for answers business users act on. Unified Studio runs in FRA and ARN.
- https://aws.amazon.com/about-aws/whats-new/2026/03/amazon-sagemaker-data-agent-query-editor
- https://docs.aws.amazon.com/sagemaker-unified-studio/latest/adminguide/supported-regions.html

**Bedrock Knowledge Bases, structured data** (GA Dec 2024). NL to SQL with Redshift as the only query engine (Glue
catalog tables reachable through Redshift; not Athena). Table/column descriptions, include/exclude and curated queries
in `generationContext`; AWS calls it "best effort" and says exclusions "aren't a substitute for guardrails". ⚠ Guardrails
support for structured KBs not confirmed. FRA: yes. ARN: not listed.
- https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-structured-create.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-supported.md

**Redshift generative SQL** (Amazon Q in Query Editor v2). Custom context JSON with annotations, curated queries and
documents; cannot reference external schemas, so lakehouse tables via Spectrum are out. Athena has no built-in NL query.
FRA: yes. ARN: no.
- https://docs.aws.amazon.com/redshift/latest/mgmt/query-editor-v2-generative-ai.html

**SageMaker Catalog** (formerly DataZone): business glossary, column-level metadata forms, AI-generated descriptions
that a human accepts, subscriptions that grant Lake Formation access. Describes data; not wired into an NL→SQL engine.
- https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/autodoc.html

## Governed access

**Lake Formation on Iceberg materialized views.** Grant SELECT on the view (by name or LF-tags); consumers need no
access to the sources. The view runs as its definer role; refresh at least hourly, eventually consistent.
- https://docs.aws.amazon.com/lake-formation/latest/dg/materialized-views.md
- https://aws.amazon.com/blogs/big-data/building-medallion-architecture-with-iceberg-materialized-views-in-amazon-sagemaker/

**MCP servers.** The AWS MCP Server (GA May 2026, us-east-1 and FRA, not ARN) is part of the Agent Toolkit for AWS,
whose skills we vendor. awslabs open-source servers for Redshift (read-only transaction, 1000 rows max; "the database
user's privileges are the security boundary") and Athena/Glue (read-only allowlist; ⚠ docs say starting a query needs
`--allow-write`).
- https://aws.amazon.com/about-aws/whats-new/2026/05/aws-mcp-server/
- https://github.com/aws/agent-toolkit-for-aws
- https://awslabs.github.io/mcp/servers/redshift-mcp-server
- https://awslabs.github.io/mcp/servers/aws-dataprocessing-mcp-server

**AgentCore Policy** (GA 3 Mar 2026, FRA). Cedar rules, natural-language authoring, enforced at Gateway on every tool
call, default deny. Policy with Guardrails (GA Jun 2026) is not in FRA; ⚠ which Guardrails policies it applies is not
stated. Strands has a CedarAuthorization intervention for the same idea in-process.
- https://aws.amazon.com/about-aws/whats-new/2026/03/policy-amazon-bedrock-agentcore-generally-available/
- https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-bedrock-agentcore-policy-guardrails-generally-available/
- https://strandsagents.com/docs/user-guide/concepts/agents/interventions/cedar-authorization/

## Evidence and verification

**Guardrails contextual grounding** (GA). Grounding and relevance scores per response against sources you pass
(`ApplyGuardrail`, no model call needed); 0.7 is AWS's suggested starting threshold. Scores the whole response, not
claim by claim.
- https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html

**Automated Reasoning checks** (GA Aug 2025; FRA). Formal rules generated from a policy document, tested with
scenarios, attached to a guardrail; returns VALID / INVALID / TOO_COMPLEX and more. Report-only, English only, checks
against rules rather than data. Fits "does this answer follow our metric definitions", not "is this number right".
- https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-automated-reasoning-checks.html
- https://aws.amazon.com/about-aws/whats-new/2025/08/automated-reasoning-checks-amazon-bedrock-guardrails

**Human in the loop.** Strands interventions (HumanInTheLoop, Steering, CedarAuthorization) pause or deny tool calls;
the AgentCore harness (GA Jun 2026) has an `inline_function` tool to wait for a person. Nothing gates the final answer
on evidence.
- https://strandsagents.com/docs/integrations/interventions/overview/
- https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-harness-is-now-generally-available-go-from-idea-to-production-grade-agent-in-minutes/

**Verifying each claim against the data:** no AWS service or sample does it.

## Checking the agent's work

**AgentCore Evaluations** (GA 31 Mar 2026; FRA). Built-in LLM judges (GoalSuccessRate, Correctness, Faithfulness,
Helpfulness, Refusal, ToolSelectionAccuracy, ToolParameterAccuracy and more), custom LLM-judge and Lambda evaluators,
online, on-demand and batch; ground truth; dataset evaluations in preview. "Faithfulness" means consistent with the
conversation, not with Athena.
- https://aws.amazon.com/about-aws/whats-new/2026/03/agentcore-evaluations-generally-available
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/evaluators.html

**CI gate on agent behaviour — AWS sample** (ML Blog, 8 Sep 2026). GitHub Actions with OIDC: deploy with CDK, invoke,
wait for traces, evaluate (GoalSuccessRate, Correctness, ToolSelectionAccuracy, ToolParameterAccuracy), block the PR
below 0.8, comment the scores, tear down.
- https://aws.amazon.com/blogs/machine-learning/automated-agent-evaluation-with-amazon-bedrock-agentcore-and-github-actions/
- https://github.com/awslabs/agentcore-samples/tree/main/01-features/06-observe-evaluate-optimize-your-agent/02-evaluate

**Strands Evals** (`strands-agents-evals`, ⚠ version): trace-based LLM-judge evaluators and an ActorSimulator for
multi-turn tests.
- https://strandsagents.com/docs/user-guide/evals-sdk/evaluators/

**Amazon Q Developer for GitHub** reviews pull requests (preview); it reviews code, not agent behaviour.
- https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/github-code-reviews.html

## Samples close to this talk
- Athena text-to-SQL: https://github.com/aws-samples/text-to-sql-for-athena
- NL querying of S3 with Athena: https://github.com/aws-samples/natural-language-querying-of-data-in-s3-with-athena-and-generative-ai-text-to-sql
- AgentCore evaluation samples, including TypeScript agents and the CI gate: https://github.com/awslabs/agentcore-samples/tree/main/01-features/06-observe-evaluate-optimize-your-agent/02-evaluate
