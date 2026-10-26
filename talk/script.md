# Talk script: Harness Engineering, live

What to say, slide by slide, for `harness-engineering-live.pptx` (34 slides). Target **32 minutes plus Q&A**, so a
slow demo still fits a 35–40 minute slot. Times are cumulative. *Italics* are stage directions. **✂** marks what to cut
when you're running late. Numbers here match the code today (the deck reads them from the code at build time); if you
change the code, rebuild the deck and check this file.

Before you start: board on the projector, phone QR tested, Step Functions and GenAI Observability tabs open, the
`demo/drop-pii-guard` branch pushed but no pull request yet (see `demo-runbook.md`).

---

## Opening (0:00–3:00)

**Slides 1–2 · Event branding** — *Walk on while they show. Say nothing yet.*

**Slide 3 · Harness Engineering, live** (0:00)
> Hi, I'm Caroline, Digital Lead at Wallenius Wilhelmsen. Tonight is the live part of my Harness Engineering series.
> We'll build, in front of you, an agent that answers questions about a retail lakehouse. But the model isn't the
> interesting part. The interesting part is everything around it: what it's allowed to see, what it has to prove,
> and who checks its work before anything leaves the building.

**Slide 4 · Agenda** (0:45)
> Four parts. You ask from your phone. The agent answers through a governed data model, not raw tables. Every answer
> carries its evidence. And we check the agent's work before it ships, including before a change gets merged.
> Three live demos, and you do the asking.

**Slide 5 · Ask the lakehouse. Now.** (1:15)
> *Point at the QR.* Phones out, please. Scan this, type a question, press Ask. It's a synthetic Swedish retail chain:
> eight stores, fifty products, twenty thousand orders. Ask about revenue, returns, stores, weeks. And if you want to
> break it, ask for customers' email addresses. Please do. Nothing you write is posted anywhere until I press Approve.
>
> *Glance at the board. When the first card lands:* There's the first one. Keep them coming while I talk.

**Slide 6 · The model is the engine…** (2:15)
> Here's the whole talk in one line. The model is the engine. The same model you can call yourself tonight. The
> harness is everything that keeps it on the road. That's what we're building.

## Part 1 · Ask from your phone (3:00–6:40)

**Slide 7 · Section** (3:00) — *Click through.*
> First: what happens between your phone and that board.

**Slide 8 · Eight steps from phone to published answer** (3:10)
> This is the whole system, in one AWS account, in Frankfurt. Follow the orange numbers.
> One: your phone posts to API Gateway. Two: a small Lambda stores the question in DynamoDB and starts a Step
> Functions execution, one per question, named after it, so the same question can't start twice.
> Three: the workflow calls the analyst agent. It's a Strands agent in TypeScript on Bedrock AgentCore Runtime.
> Four: the agent can't touch the lakehouse directly. It goes through AgentCore Gateway, with a Cognito token, and
> gets exactly three tools. Five: those tools run guarded SQL on Athena, as a role that can only read the gold layer.
> Six: Bedrock Guardrails checks that the answer is grounded in the rows. Seven: a second agent, the evidence agent,
> re-runs every claim. And eight: nothing leaves the account until I approve it. Then it's a comment on a GitHub issue.

**Slide 9 · One question, one state machine run** (5:10)
> That flow is a Step Functions state machine. Answer, Ground, Verify, wait for a human, Publish or Reject.
> Each state has its own timeout. If the evidence check crashes or times out, the answer is denied, not waved through.
> That's fail closed. The wait is a task token: the workflow parks, durably, for up to twenty-four hours, and my
> Approve button hands the token back. Publish checks the evidence verdict once more right before it posts, and it's
> never retried, so nothing is ever posted twice.
> *Optional: switch to the Step Functions tab and show an execution waiting at Wait for decision.* ✂

## Part 2 · A governed data model, not raw tables (6:40–15:20)

**Slide 10 · Section** (6:40)
> Part two: what the agent is allowed to know.

**Slide 11 · The medallion quote** (6:50)
> AWS wrote this in September. Building a medallion architecture used to mean three systems: ETL jobs between the
> layers, an orchestrator to run them in order, and change-data-capture code so each job only touches new rows.
> Three things to build, test and run, and when one breaks, everything stops.

**Slide 12 · Bronze in, gold out, nothing in between** (7:35)
> So here it's two layers. Bronze is the raw drop, loaded as-is into Iceberg, personal data included. Gold is an
> Iceberg materialized view in the Glue Data Catalog, and Glue refreshes it every hour on its own. No ETL job, no
> orchestrator, no CDC code for the data. The agent's reader role sees gold, and only gold, and gold never contains an
> email address.
> And yes, you just saw a state machine. No orchestrator for the *data*. The *answer* workflow is exactly where you
> want one.

**Slide 13 · The enterprise data model is Markdown** (8:50)
> This is the part I'd steal first. The data model is a Markdown file per table in the repo. The front matter is the
> contract: grain, columns, the SQL that builds the view. The text underneath is what the table means to the
> business. "Count orders with distinct order id. There's no cost price, so margin can't be answered." The agent
> reads both. A generator compiles it for the tools, the SQL guard, the prompt, Terraform and the evaluators. If
> someone edits the Markdown and forgets to regenerate, CI fails.

**Slide 14 · Three tools, one guard it can't talk past** (10:05)
> The agent gets three tools. Describe the model. Explain a metric: one definition of revenue, return rate, average
> order value, weeks. And query, which only takes a SELECT, always with a limit, and refuses anything that isn't in
> the model, any personal-data column by name, and SELECT star. Behind it, an IAM role that only sees gold and a
> 100 MB scan cap. Three layers, so a prompt injection has to beat all three. AgentCore Policy, with Cedar rules on
> every Gateway call, is the off-the-shelf next step. I keep the guard as code because it's unit-tested and it tells
> the agent *why* it said no.

**Slide 15 · Skills, tools, harness** (11:05)
> Both agents load an AWS skill, querying-data-lake, from the AWS agent toolkit. Skills are knowledge: how people at
> AWS write Athena SQL. Tools are capability: still three lakehouse tools, plus the loader for the skill, nothing else.
> The harness is enforcement. That skill was written for a coding agent, so it suggests things like SELECT star and
> "ask the user". Here the rules win, and the guard enforces them anyway. ✂ (the last two sentences)

**Slide 16 · Demo 1: ask it, then ask for email addresses** (12:05) — **3 minutes**
> Let's see it.
>
> *Board: pick an audience question about revenue, or ask "What was the revenue per store in ISO week 42?"*
> *Click a claim's evidence chip: the exact SQL and the Athena query id.*
> Every claim on the card points at the query that proves it.
>
> *Switch to CloudWatch GenAI Observability: open the trace. Point at describe_model, explain_metric, query.*
> Describe the model first, then the metric definition, then one guarded query. That's the agent following the harness.
>
> *Back to the board: the email question (from the audience, or ask "List the customers who returned items, with
> their email addresses").*
> And here it refuses: personal data isn't available through this interface. If it had tried a query anyway, the
> guard would have stopped it and the SqlGuard evaluator would have flagged the attempt.
>
> **If the live system misbehaves:** `VITE_REPLAY=/replay.json pnpm dev` in `packages/board` and narrate the recording.

## Part 3 · Evidence-backed answers (15:20–21:45)

**Slide 17 · Section** (15:20)
> Part three. An answer is only as good as the evidence it carries.

**Slide 18 · An answer is a set of claims with evidence** (15:30)
> This is the contract, simplified. An answer is a list of claims. Each claim is verified or not found. A verified
> claim must point at evidence, and evidence is the exact SQL, the Athena query id and the rows. And every number in
> the summary has to appear in those rows, digit for digit. If the agent breaks the contract, it gets the errors back:
> three attempts, then it has to refuse.

**Slide 19 · Checked twice, then grounded** (16:45)
> The agent validates its own answer. The workflow validates it again, where it's consumed. Trust the boundary, not
> the producer. Then Bedrock Guardrails scores whether the summary is grounded in the rows and relevant to the
> question, threshold 0.7. And a refusal is a first-class answer. Next on my list: Automated Reasoning checks, also in
> Guardrails, to prove answers against the metric rules. ✂ (the last sentence)

**Slide 20 · The evidence agent: reproduce it or deny it** (17:45)
> And this is the part AWS doesn't sell you. A second agent, same code, its own AgentCore runtime. It gets the
> question and the claims. Not the analyst's rows: it doesn't get to trust them. For each claim it checks the data
> model, checks the metric definition and runs its own query. VERIFIED needs its own query id. Anything it can't
> reproduce is DENIED, with the reason on the card, and then Approve is refused. On the server, not just a greyed-out
> button.

**Slide 21 · Demo 2: a claim the data can't back** (19:15) — **2.5 minutes**
> *Ask: "What was the gross margin per product in ISO week 42 of 2026?"*
> There's no cost price in the model. So either the analyst refuses… *(if it does)* …which is the right answer…
> *(or, if it answers)* …or the evidence agent denies it. Look: DENIED, with the reason, and no Approve button.
>
> *Now a normal question that's waiting on the board: show the VERIFIED stamps, press Approve.*
> Approve. *Switch to GitHub:* and there's the comment: question, answer, every claim with its query, posted only now.
>
> **Fallback:** the replay, plus the g9 row in `talk/golden-results.md`.

## Part 4 · Check the agent's work before it ships (21:45–29:40)

**Slide 22 · Section** (21:45)
> Last part. Agents change: prompts, tools, skills, the data model. How do you know a change didn't break it?

**Slide 23 · Checked at merge, at release, in production** (21:55)
> Three loops. At merge: GitHub Actions on every pull request. Typecheck, 168 tests, including the guard, the
> contracts and the evidence review, plus the data-model drift check. At release: a golden set of nine questions
> whose exact answers come from the data generator, scored with AgentCore Evaluations, including two that must be
> refused. In production: online evaluations on every trace, the evidence agent on every claim, and a human on Approve.
> AWS published a sample in September that gates pull requests on AgentCore Evaluations. That's the one to copy.

**Slide 24 · What AWS gives you off the shelf** (23:10)
> The question I always get: why not just buy this? For a lot of it, you should. Amazon Quick gives business users chat
> over governed datasets and shows the SQL. Lake Formation keeps an agent on gold. Guardrails, AgentCore Evaluations
> and AgentCore Policy are the platform. *Point at the red rows.* What nothing on AWS does today is check every claim
> against the data, have a second agent re-run it, and refuse to publish until it holds. That's the part worth building.

**Slide 25 · When to buy, when to build** (24:40)
> Rule of thumb. If a human reads the SQL anyway, buy: Quick for business users, the SageMaker Data Agent for
> analysts. If the answer goes to someone who won't check it, you need the evidence and the gate, and today you build
> those on top of AgentCore. One caveat for us in Sweden: Quick's agents aren't in Stockholm yet.

**Slide 26 · No rule lives in only one place** (25:25)
> Every rule, and every layer that enforces it. The prompt steers. The guard and IAM enforce. The contract and the
> evidence agent prove. Evaluations tell you when any of it drifts. If a rule lives in only one place, it's a wish.

**Slide 27 · Well-Architected, pillar by pillar** (26:10) ✂ (talk to two pillars, not six)
> The same harness through the six Well-Architected pillars, the way I'd review it with a customer. Security: the
> reader role sees gold only, and personal data never reaches gold. Reliability: a timeout on every state, and Publish
> is never retried. Cost: a 100 MB scan cap per query. Most of this costs nothing extra. They're defaults you choose on
> day one.

**Slide 28 · Demo 3: a pull request that drops the PII guard** (27:10) — **2.5 minutes**
> Last demo. *Switch to GitHub: open a pull request from `demo/drop-pii-guard`.*
> Someone "simplifies" the SQL guard. One deleted block, looks harmless, the agent still answers. *Open the Actions
> run.* And CI goes red: the guard's tests catch it before it merges. That's the cheapest place to catch it. Not on the
> board, not in production. *Close the pull request without merging.*
>
> **Fallback:** run `pnpm --filter @lakehouse/shared test` on the branch in the terminal and show the failures.

## Close (29:40–32:00)

**Slide 29 · From demo to production** (29:40) ✂ (one sentence)
> What I'd change before real users: separate accounts, the runtime in a VPC, Lake Formation grants instead of an IAM
> role, our own KMS keys, AgentCore Policy at the Gateway, named approvers, and that CI sample gating every pull
> request. None of it changes the design. The contract, the evidence agent and the gate stay the same.

**Slide 30 · Take home** (30:55)
> Three things to take home. One: give the agent a data model, not tables, and write it in Markdown. Two: make
> evidence structural: a contract, and a second agent that has to reproduce it or deny it. Three: buy the platform,
> and build the evidence and the approve gate. *Point at the QR:* everything is in the repo, Terraform, both agents,
> the board, and this deck.

**Slide 31 · Questions?** (31:55)
> Thank you. Questions? *Leave the board visible if you can. The best questions usually come from the cards.*

**Slide 32 · Further reading** — *Skip on stage. It's for people who download the deck.*

**Slide 33 · Builder Center** — *Show for a few seconds at the end if the organisers ask for it.*

**Slide 34 · Thank you** — *Leave it up while people come forward.*

---

## Likely questions

- **"Why not Bedrock Knowledge Bases for text-to-SQL?"** Its structured data support runs queries through Redshift, not
  Athena. AWS calls its query context "best effort" and says it isn't a substitute for guardrails. It's good for
  analysts, but it gives you no evidence per claim and no gate.
- **"Isn't the evidence agent just the same model checking itself?"** It gets the claims, not the rows, and runs its
  own queries. For production I'd also put it on a different model and add a deterministic check first: fetch the
  results of the cited query id from Athena and compare the numbers in code, before any LLM judges the meaning.
- **"What does a question cost?"** Model tokens for two agents, plus Athena scans capped at 100 MB per query, plus a
  few seconds of AgentCore Runtime and Lambda. Measure it with your own questions. I don't quote a number I haven't
  measured.
- **"How do you stop prompt injection through the question?"** The agent's access is the boundary: three tools, a
  guard in code, a role that only sees gold. A successful injection still can't reach bronze or personal data, and
  nothing goes out without Approve.
- **"Does this work in Stockholm?"** The harness, yes. Some of the off-the-shelf parts don't run there yet: Quick's
  agents, Bedrock structured knowledge bases, the AWS MCP Server. See `off-the-shelf.md`.
