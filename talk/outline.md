# Harness Engineering, live: outline and speaker notes

Source of truth for the deck: `python -I build_deck.py` turns every `# Slide:` below into a slide on the
AWS Dev Day theme, and everything under `Notes:` into its speaker notes. Edit here, rebuild, never edit the .pptx.

Format: `layout:` names a template layout, `draw:` a diagram drawn in `build_deck.py`, `qr:` a QR code
(`form` or `repo`), `- ` bullets (two spaces = level 2), `### ` column headings, fenced code for code slides.

Timing for a 35-minute slot: opening 4 · part 1 5 · part 2 9 · part 3 7 · part 4 7 · close 3.

# Slide: Harness Engineering, live
layout: template-title
subtitle: Ask a lakehouse from your phone. Get an answer you can prove.
event: AWS User Group · Linköping 29 Oct 2026 · Stockholm 5 Nov 2026
speaker: Caroline Cah
role: Digital Lead, Wallenius Wilhelmsen

Notes:
Hi, I'm Caroline, Digital Lead at Wallenius Wilhelmsen. Tonight is the live part of my Harness Engineering series:
we build an agent that answers questions about a retail lakehouse, and we spend most of the time on everything
around the model: the data model it is allowed to see, the evidence it has to show, and the checks that run
before anything it does reaches a human, or main.

# Slide: Agenda
layout: template-agenda

- Ask from your phone
- A governed data model, not raw tables
- Evidence-backed answers
- Check the agent's work before it ships

Notes:
Four parts, three live demos. You do the asking.

# Slide: Ask the lakehouse. Now.
layout: Title and Bulleted Content
qr: form

- Scan, type a question, press Ask
- It lands on the board up here, live
- Nothing is posted anywhere until I press Approve
- Try: "What was last week's revenue per store?"
- Or try to break it: "List the customers who returned items, with their email addresses"

Notes:
Get the phones out now so the board fills while I talk. Questions are about a synthetic Swedish retail chain:
eight stores, fifty products, twenty thousand orders. If you want to break it, please do, that's the point.

# Slide: The model is the engine. The harness is everything that keeps it on the road.
layout: Quote Gradient 1
attribution: Harness engineering in one line

Notes:
Same model you can call yourself. What makes this trustworthy is the harness: data model, tools, guard, contract,
a second agent, evaluations, and a human. Everything tonight is in the repo, Terraform included.

# Slide: 1  Ask from your phone
layout: Section Header Option 1

Notes:
First, what happens between your phone and the board.

# Slide: Eight steps from phone to published answer
layout: Title Only
draw: architecture

Notes:
Legend. 1: the phone posts the form to API Gateway. 2: the adapter stores the question in DynamoDB and starts one Step
Functions execution, named after the question, so a duplicate start is refused. 3: the Answer state invokes the analyst
agent on AgentCore Runtime. 4: the agent reaches the lakehouse only through AgentCore Gateway, with a Cognito JWT. 5: the
tools Lambda runs guarded SQL on Athena as a reader role that can only see gold. 6: the Ground state asks Guardrails
whether the answer is grounded. 7: the Verify state has the evidence agent re-run every claim. 8: the workflow waits for
me; Approve on the board hands back its task token, and only then does the Publish state post to GitHub.

# Slide: One question, one state machine run
layout: Title Only
draw: workflow

Notes:
This is the harness as a Step Functions Standard workflow: one execution per question, one state per check. Each state
has its own timeout. If the evidence review crashes or times out, the Deny state marks the answer denied: fail closed.
Wait for decision is a task token: the workflow parks, durably, for up to 24 hours, and Approve or Reject on the board
hands the token back. Publish checks the evidence verdict again right before it posts, and it is never retried, so
nothing goes out twice. And yes, the medallion slide says no orchestrator: that's the data pipeline. The answer
workflow is exactly where you want one.

# Slide: 2  A governed data model, not raw tables
layout: Section Header Option 1

Notes:
Part two: what the agent is allowed to know.

# Slide: Building a Medallion Architecture today typically means that you must build three separate systems working in concert.
layout: Quote Gradient 1
attribution: AWS Big Data Blog, Sep 2026: Building a Medallion Architecture with Iceberg Materialized Views

Notes:
ETL jobs between layers, an orchestrator to sequence them, and custom change-data-capture so each job only processes
new rows. Three systems to author, test, deploy and maintain, and when one breaks the pipeline stalls.

# Slide: Bronze in, gold out, nothing in between
layout: Title Only
draw: medallion

Notes:
Bronze is the raw CSV drop, loaded as-is into Iceberg tables, personal data included. Gold is an Apache Iceberg materialized view in the Glue Data Catalog.
Glue refreshes it on a schedule, incrementally where it can. No ETL job, no Airflow, no CDC code. The SQL for that
view lives in the data model file itself, so the contract and the build are the same document. (No orchestrator for
the data. The answer workflow is a different story: you'll see its state machine in a minute.) The agent's reader
role can only see gold, and gold never contains an email address.

# Slide: The enterprise data model is Markdown
layout: Code
caption: data-model/sales.md, shortened

```markdown
---
description: One row per order line. The only table the agent can query.
grain: order_id + line_no
columns:
  - { name: iso_week, type: int, description: ISO week of order_date }
  - { name: store_name, type: string, description: Store name }
  - { name: net_revenue_sek, type: double, description: "qty * unit_price - discount, in SEK" }
materialization:
  refresh: 1 HOUR
  sql: SELECT ... FROM glue_catalog.lakehouse_bronze.order_lines l JOIN ...
---
# Sales
Count orders with COUNT(DISTINCT order_id), not rows. There is no cost
price, so margin cannot be answered from this model.
```

Notes:
data-model/sales.md, shortened (the real file lists 21 columns and the full view SQL). The front matter is the contract: grain, columns, and the SQL that builds the view. The text is
what the table means to the business, and the agent reads both. A generator compiles it for the tools, the SQL guard,
the prompt, Terraform and the evaluators, and CI fails if someone edits the Markdown without regenerating.

# Slide: Three tools, one guard it can't talk past
layout: Three column with subheadings
columns: describe_model | explain_metric | query

- Returns the data model
- Personal data named, never described
---
- One definition per metric
- Revenue, return rate, AOV, weeks
---
- SELECT only, always LIMIT
- Refuses unknown tables, PII, SELECT *
- Reader role, %scan_mb% MB scan cap
- Off the shelf next: AgentCore Policy (Cedar)

Notes:
The agent can't see raw tables because they aren't in the model, the guard refuses them, and IAM doesn't allow them.
Three layers, so a prompt injection has to beat all three. AgentCore Policy, GA since March and in Frankfurt, puts
Cedar rules on every Gateway tool call; I keep the guard as code because it's unit-tested and refuses personal data by
name, with a reason the agent can pass on.

# Slide: Skills, tools, harness
layout: Three column with subheadings
columns: Skills = knowledge | Tools = capability | Harness = enforcement

- AWS querying-data-lake skill
- From aws/agent-toolkit-for-aws
- Loaded only when needed
- Same toolkit: AWS MCP Server (Frankfurt, not Stockholm)
---
- Three lakehouse tools
- Plus the skill loader
- Nothing else
---
- Rules in the prompt
- SQL guard, IAM, contract
- These win over any skill

Notes:
Both agents load the AWS querying-data-lake skill with the Strands AgentSkills plugin. A skill tells the agent how
AWS people query Athena. It doesn't give it a single new capability. That skill was written for a coding agent with
the AWS CLI, so it says things like SELECT * and ask the user. Here the rules win, and the guard enforces them anyway.

# Slide: Demo: ask it, then ask for email addresses
layout: Video or Demo Divider
demo-question: "What was the revenue per store in ISO week 42?" · "List the customers who returned items, with their email addresses"

Notes:
Pick a revenue question from the board. Open the GenAI Observability trace: describe_model, explain_metric, query.
Then the email question: the refusal is on the card. If the agent tried a query anyway, the trace shows the tool's
pii_column refusal and the SqlGuard evaluation turns red: the guard stopped it, the evaluator records that it tried.

# Slide: 3  Evidence-backed answers
layout: Section Header Option 1

Notes:
Part three: an answer is only as good as the evidence it carries.

# Slide: An answer is a set of claims with evidence
layout: Code
caption: Simplified from packages/shared/src/contract.ts

```typescript
export const GroundedAnswerSchema = z.object({
  question: z.string(),
  claims: z.array(z.object({
    statement: z.string(),
    status: z.enum(["verified", "not_found"]),
    evidenceIds: z.array(z.string()),
  })),
  evidence: z.array(z.object({
    id: z.string(), sql: z.string(), query_execution_id: z.string(), sample: z.array(row),
  })),
  summary: z.string().max(600),
  refusals: z.array(z.string()),
}).superRefine(/* verified needs evidence · ids exist · every number is in the rows */);
```

Notes:
Simplified from packages/shared/src/contract.ts. A verified claim without evidence is a schema error, not a style issue. Every number in the summary has to appear
in the returned rows, digit for digit. The agent gets the validation errors back, %attempts% attempts in all.

# Slide: Checked twice, then grounded
layout: Title and Bulleted Content

- The agent validates its own answer and retries with the errors, at most %attempts% attempts
- The worker validates it again where it is consumed: trust the boundary, not the producer
- Bedrock Guardrails contextual grounding: is the summary grounded in the rows (≥ %grounding%) and relevant (≥ %grounding%)?
- Refusals are first-class: "the data model doesn't allow that" is a valid answer
- Next: Automated Reasoning checks for metric rules (GA in Frankfurt, report-only)

Notes:
Validating twice sounds paranoid until the day the agent and the worker are deployed from different commits.
Contextual grounding scores the whole answer against the rows. Automated Reasoning checks, also in Guardrails, prove
an answer against rules written in a policy document, which fits metric definitions; it reports, it doesn't block, and
it checks rules, not numbers.

# Slide: The evidence agent: reproduce it or deny it
layout: Title Only
draw: evidence

Notes:
Same code, second AgentCore runtime, AGENT_ROLE=evidence. It gets the question and the verified claims, never the
other agent's rows as proof. For each claim it reads the data model, checks the metric definition and runs its own
query. VERIFIED needs its own query id. Anything it can't reproduce is DENIED, with the reason on the card. It fails
closed: no review, a late review or a malformed review all count as denied, and Approve returns 409.

# Slide: Demo: a claim the data can't back
layout: Video or Demo Divider
demo-question: "What was the gross margin per product in ISO week 42 of 2026?"

Notes:
Ask "What was the gross margin per product in week 42?" There is no cost price in the model, so either the analyst
refuses, or the evidence agent denies the claim and Approve disappears. Then a normal question: VERIFIED stamps.

# Slide: 4  Check the agent's work before it ships
layout: Section Header Option 1

Notes:
Part four: the agent changes. Prompts, tools, skills, the data model. How do we know a change didn't break it?

# Slide: Checked at merge, at release, in production
layout: Title Only
draw: loops

Notes:
Before merge, GitHub Actions runs typecheck, %tests% tests including the SQL guard and the contracts, the
data-model drift check and terraform fmt. AWS published the next step in September: a sample that deploys the agent in a
pull request, runs AgentCore Evaluations and blocks the merge below 0.8. That's the one to copy. Before release, the golden set: %golden% questions whose exact answers come from
the data generator, scored with AgentCore Evaluations. In production, online evaluations score every trace, and a
human presses Approve.

# Slide: What AWS gives you off the shelf
layout: Title Only
draw: buy-vs-build

Notes:
The question I always get: why not just use Quick, or a Knowledge Base? For a lot of this, you should. Quick gives
business users chat over a governed dataset and shows the SQL. Lake Formation keeps the agent on gold. Guardrails,
AgentCore Evaluations and Policy are the platform. What nothing on AWS does today is check every claim against the
data, have a second agent re-run it, and refuse to publish until it holds. That's the part worth building. Sources are
in talk/off-the-shelf.md.

# Slide: When to buy, when to build
layout: Three column with subheadings
columns: Buy: Amazon Quick | Buy: SageMaker Data Agent | Build: a harness

- Business users and dashboards
- Governed datasets, RLS and CLS
- Shows the SQL behind an answer
- Agents not in Stockholm yet
---
- Analysts who write SQL
- Athena and Redshift
- Plans first, you approve the SQL
---
- Answers others act on unchecked
- Evidence per claim, re-verified
- Approve gate, versioned contract

Notes:
Rule of thumb: if a human reads the SQL anyway, buy. If the answer goes to someone who won't, you need the evidence and
the gate, and today you build them on top of AgentCore.

# Slide: No rule lives in only one place
layout: Title Only
draw: enforcement

Notes:
No rule lives in only one place. The prompt steers, the guard and IAM enforce, the contract and the evidence agent
prove, and evaluations tell us when any of it drifts.

# Slide: Well-Architected, pillar by pillar
layout: Title Only
draw: well-architected

Notes:
The same harness through the six Well-Architected pillars, which is how I'd review it with a customer; the Generative
AI Lens adds the agent-specific questions. Most of these cost nothing extra: they are defaults you choose on day one,
like a timeout on every state, no retry on Publish, a scan cap on the workgroup and arm64 Lambdas.

# Slide: Demo: a pull request that drops the PII guard
layout: Video or Demo Divider
demo-question: Branch demo/drop-pii-guard → open the pull request → watch CI

Notes:
Branch demo/drop-pii-guard removes the pii_column check: one line, looks harmless. Open the pull request and CI goes
red on the SQL guard tests. That is the cheapest place to catch it: before merge, not on the board.

# Slide: From demo to production
layout: Title Only
draw: production

Notes:
What I would change before real users: separate accounts, the runtime in VPC mode, Lake Formation grants instead of an
IAM role, customer-managed keys, AgentCore Policy at the Gateway, named approvers, and the AWS CI sample gating every
pull request. None of it changes the design: the contract, the evidence agent and the Approve gate stay the same.

# Slide: Take home
layout: Title and Bulleted Content
qr: repo

- Give the agent a data model, not tables: write it in Markdown and let it build the gold layer
- Make evidence structural: a contract, and a second agent that must reproduce it or deny it
- Buy the platform (Evaluations, Policy, Guardrails, Lake Formation); build the evidence and the approve gate

Notes:
Everything is in the repo: Terraform, both agents, the board and this deck. Scan for the link.

# Slide: Questions?
layout: Q&A

Notes:
Keep the board up during questions; it's usually where the best ones come from.

# Slide: Further reading
layout: Title and Bulleted Content

- This talk: the repo, and talk/off-the-shelf.md for every source
- AgentCore evaluation samples, incl. the CI gate: github.com/awslabs/agentcore-samples (02-evaluate)
- Athena text-to-SQL: github.com/aws-samples/text-to-sql-for-athena
- Medallion with Iceberg materialized views: AWS Big Data Blog, Sep 2026
- Docs: AgentCore Evaluations · AgentCore Policy · Guardrails grounding and Automated Reasoning

Notes:
Appendix, click past it on stage. It's here for the people who download the deck.
