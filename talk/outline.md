# Harness Engineering, live: outline and speaker notes

Source of truth for the deck: `python -I build_deck.py` turns every `# Slide:` below into a slide on the
AWS Dev Day theme, and everything under `Notes:` into its speaker notes. Edit here, rebuild, never edit the .pptx.
The words to say are in `script.md`; the notes here are the short version.

Format: `layout:` names a template layout, `draw:` a diagram drawn in `build_deck.py`, `qr:` a QR code
(`form` or `repo`), `demo-question:` and `watch-for:` for demo slides, `- ` bullets, `---` between columns,
fenced code for code slides. Numbers written as `%name%` are read from the code and data at build time.

The spine: one control loop - produce, check, act - drawn at three scales (answer, claim, change). The three demos are
the three scales. The principle is named "every rule, twice".

# Slide: Harness Engineering, live
layout: template-title
subtitle: Ask a lakehouse from your phone. Get an answer you can prove.
event: AWS User Group · Linköping 29 Oct 2026 · Stockholm 5 Nov 2026
speaker: Caroline Cah
role: Digital Lead, Wallenius Wilhelmsen

Notes:
Cold open, story one. Monday morning, a dashboard someone asked an agent to build: orders in week 42.

# Slide: The number nobody questioned
layout: Title Only
draw: story-rows

Notes:
%w42_rows% orders. Who reads it: the CFO, in the Monday meeting. The twist: no error, no warning, a plausible number.
Every order has about three lines; the agent counted lines. The right answer is %w42_orders%.

# Slide: Ask the lakehouse. Now.
layout: Title and Bulleted Content
qr: form

- Scan, type a question, press Ask
- It lands on the board up here, live
- Nothing is posted anywhere until I press Approve
- Try: "What was last week's revenue per store?"
- Or try to break it: "List the customers who returned items, with their email addresses"

Notes:
Eight stores, fifty products, twenty thousand orders. Remember your question: at the end you'll hear what happened to it.

# Slide: Don't trust the agent. Trust the checks around it - never just one.
layout: Quote Gradient 1
attribution: The principle: every rule, twice

Notes:
The frame, stated once and named. Every rule the agent has to follow is enforced in at least two places, and nothing
reaches a person until it has proved itself. We'll call it "every rule, twice".

# Slide: Agenda
layout: template-agenda

- Refused: the question it must not answer
- Denied: the answer it cannot prove
- Blocked: the change that would remove a check

Notes:
Three scenes, three demos, each one scale bigger than the last.

# Slide: Where does your question go?
layout: Section Header Option 1

Notes:
You just pressed Ask. Four stops.

# Slide: What happens to your question
layout: Title Only
draw: journey-1

Notes:
Stop one: API Gateway, a small Lambda, and one Step Functions run named after your question, so it can't start twice.

# Slide: What happens to your question
layout: Title Only
draw: journey-2

Notes:
Stop two: the analyst agent on AgentCore Runtime reaches the lakehouse only through AgentCore Gateway, with a Cognito
token, three tools, and guarded SQL on Athena as a role that can only read gold.

# Slide: What happens to your question
layout: Title Only
draw: journey-3

Notes:
Stop three: two checks the agent didn't write. Guardrails grounding against the rows, then a second agent re-runs
every claim.

# Slide: What happens to your question
layout: Title Only
draw: journey-4

Notes:
Stop four: it waits for me, up to 24 hours. Nothing has left this account. (Full architecture: appendix.)

# Slide: One loop: produce, check, act
layout: Title Only
draw: loop-answer

Notes:
The answer path is a control loop. Produce: the analyst answers. Check: contract, grounding, evidence agent. Act: a
human approves or rejects. Karpathy's autonomy slider: this harness sets it to "a human approves every publish"; the
design question is where you set it, not whether. Every state has a timeout; a failed check denies, it never waves
through. Publish is never retried. (State machine: appendix.)

# Slide: Why can't the agent just read the tables?
layout: Section Header Option 1

Notes:
Remember %w42_rows%. That's what reading raw tables does.

# Slide: A medallion architecture: three layers, each one more trustworthy than the last
layout: Three column with subheadings
columns: Bronze · as it landed | Silver · cleaned and conformed | Gold · ready for a question

- Every record exactly as the source wrote it, strings and all
- Append-only history: nothing corrected, nothing dropped
- On AWS: files in S3 as Iceberg tables, registered in the Glue Data Catalog
---
- Typed, deduplicated, joined on keys
- Business rules applied once, in one place
- Personal data masked here or left behind in bronze
---
- Metrics in business terms: revenue, return rate, week
- One table per shape of question, no joins left to guess
- Queried by Athena; the only layer a reader role, or an agent, needs to see

Notes:
What it is, in one breath: raw data lands in bronze, gets cleaned into silver, and is served from gold, with trust
rising one layer at a time. The name is from Databricks; on AWS the layers are S3 plus Iceberg, catalogued in Glue,
queried by Athena, with Lake Formation for who may read which layer. Why it matters tonight: %w42_rows% came from
reading a raw table. Gold is where "an order" means one row. The AWS Big Data Blog (Sep 2026) adds the cost: building it
has usually meant three systems in concert, ETL jobs, an orchestrator and change-data-capture code, and when one breaks
the pipeline stalls. Next slide: how this build collapses it to two layers.

# Slide: Bronze in, gold out, nothing in between
layout: Title Only
draw: medallion

Notes:
Bronze: the raw drop as Iceberg, personal data included. Gold: an Iceberg materialized view Glue refreshes hourly. In
Barry Zhang's terms: the data path is a workflow, the answer path is an agent inside a workflow, and consequence decides
which. No orchestrator for the data; an orchestrator for the answer. Honest limit: gold can be an hour behind.

# Slide: What the agent actually reads
layout: Title Only
draw: agent-view

Notes:
The part to take, number one. This is the data model as the agent receives it from describe_model, compiled from one
Markdown file in the repo. "Count orders with COUNT(DISTINCT order_id), not rows" is the line between %w42_orders% and
%w42_rows%. The same file feeds the tools, the guard, the prompt, Terraform and the evaluators; CI fails on drift.

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
Three layers, so a prompt injection has to beat all three. The guard stays code: unit-tested, refuses by name, says why.

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
Cut candidate. The skill suggests SELECT * and asking the user; here the rules win and the guard enforces them.

# Slide: Demo 1 · Refused
layout: Video or Demo Divider
demo-question: "What was the revenue per store in ISO week 42?" · "List the customers who returned items, with their email addresses"
watch-for: three tool calls, in order, in the trace

Notes:
Stakes: email addresses in a public GitHub comment. Watch for describe_model, explain_metric, query in the trace. Then
the email question: refused. Raises: what if it's confident and wrong?

# Slide: What if it's confident and wrong?
layout: Section Header Option 1

Notes:
%w42_rows% wasn't a refusal. It was an answer.

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
The part to take, number two. Every number in the summary must appear in the rows; %attempts% attempts, then refuse.

# Slide: The one the fix wouldn't catch
layout: Title Only
draw: story-cancelled

Notes:
Story two. %gbg_rev_cancelled% instead of %gbg_rev%: cancelled orders counted, off by %gbg_diff% kr. The data model
rule that fixed %w42_rows% doesn't help here, and if the query itself was wrong, the rows agree with the answer:
validated twice, grounded at %grounding%, still wrong. Grounding scores the whole answer, not each claim.

# Slide: The evidence agent: reproduce it or deny it
layout: Title Only
draw: loop-claim

Notes:
The part to take, number three. The same loop at claim scale. Think like the evidence agent: it gets the question and
the claims with their SQL, never the analyst's rows. It runs its own query; VERIFIED needs its own query id; anything
else is DENIED and Approve returns 409. Why a second agent and not just Guardrails: in application security, 99% is a
failing grade (Simon Willison). Unsolved: same model as the analyst; next is a plain-code check of the cited query id.

# Slide: Demo 2 · Denied
layout: Video or Demo Divider
demo-question: "What was the gross margin per product in ISO week 42 of 2026?" · then Approve a verified answer
watch-for: the GitHub comment appearing after Approve

Notes:
Stakes: a margin number in front of the CFO with no cost data behind it. Refused or DENIED. Then Approve a verified
card and watch the comment appear. Raises: every check is code - what if someone deletes one?

# Slide: What stops a well-meaning change from removing a check?
layout: Section Header Option 1

Notes:
Agents change: prompts, tools, skills, the data model. Mostly by people trying to help.

# Slide: Checked at merge, at release, in production
layout: Title Only
draw: loop-change

Notes:
The same loop at change scale. At merge: %tests% tests, the guard, the contracts, the drift check. At release: %golden%
golden questions with exact answers, two that must be refused. AWS's September sample gates pull requests on
AgentCore Evaluations, below 0.8. Honest limit: my golden set runs by hand. Confession: my slides drifted from my code;
now the deck reads its numbers from the code.

# Slide: What AWS gives you off the shelf
layout: Title Only
draw: buy-vs-build

Notes:
Buy most of it. What nothing on AWS does today is check every claim against the data, re-run it with a second agent,
and refuse to publish until it holds.

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
If a human reads the SQL anyway, buy. If the answer goes to someone who won't, build the evidence and the gate.

# Slide: Every rule, twice
layout: Title Only
draw: enforcement

Notes:
The principle, named. Point at one row: no personal data lives in the prompt, the guard, IAM, gold and the evaluator.

# Slide: Demo 3 · Blocked
layout: Video or Demo Divider
demo-question: Branch demo/drop-pii-guard → open the pull request → watch CI
watch-for: the diff on one screen, then the red check

Notes:
Stakes: one deleted block, every future question can reach a personal-data column. CI is the fastest verification
there is - Karpathy's point that the human's job is to make verification fast.

# Slide: From demo to production
layout: Title Only
draw: production

Notes:
What I can't promise yet. None of it changes the design.

# Slide: What happened to your question
layout: Title Only
draw: three-scales

Notes:
Your question went round the loop at every scale: per answer, per claim, and through code that went round it per
change. It's waiting for me now.

# Slide: Take home
layout: Title and Bulleted Content
qr: repo

- Write your data model in Markdown: one file everything reads
- Make every answer a set of claims that point at evidence
- Put a second agent between the answer and the person who trusts it

Notes:
Three things to steal tomorrow morning. Everything is in the repo.

# Slide: Every rule, twice
layout: Title Only
draw: enforcement

Notes:
Shown the second time, nothing new on it. Last line: if a rule lives in only one place, it's a wish.

# Slide: Questions?
layout: Q&A

Notes:
Keep the board up during questions.

# Slide: Appendix · The full architecture
layout: Title Only
draw: architecture

Notes:
Appendix. Legend: 1 API Gateway, 2 Step Functions run, 3 analyst agent, 4 Gateway and Cognito, 5 guarded SQL on gold,
6 Guardrails, 7 evidence agent, 8 waits for Approve, then GitHub.

# Slide: Appendix · The state machine
layout: Title Only
draw: workflow

Notes:
Appendix. Answer, Ground, Verify, Wait for decision (task token, 24 hours), Publish or Reject; Deny when Verify fails.

# Slide: Appendix · Well-Architected, pillar by pillar
layout: Title Only
draw: well-architected

Notes:
Appendix. The six pillars, for the people who download the deck.

# Slide: Further reading
layout: Title and Bulleted Content

- This talk: the repo, and talk/off-the-shelf.md for every source
- AgentCore evaluation samples, incl. the CI gate: github.com/awslabs/agentcore-samples (02-evaluate)
- Athena text-to-SQL: github.com/aws-samples/text-to-sql-for-athena
- Medallion with Iceberg materialized views: AWS Big Data Blog, Sep 2026
- The four talks this one borrows from: Willison, Karpathy, Zhang, MacCárthaigh (see talk/reference-map.md)

Notes:
Appendix, click past it on stage.
