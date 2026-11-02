# Talk script: Harness Engineering, live

What to say, slide by slide, for `harness-engineering-live.pptx` (42 slides, 36 on stage). Target **32 minutes plus
Q&A**. Times are cumulative. *Italics* are stage directions. **✂** marks what to cut when running late.
**[CAROLINE: …]** marks a place only you can fill. Numbers on slides are read from the code and data at build time; the
numbers in this script match them today (rebuild the deck and re-check if the code changes).

**Who this is for.** Row six: a senior engineer asked to "put an agent on our data", quietly scared of the day it is
wrong in front of the CFO.

**The spine.** One control loop - produce, check, act - drawn once and redrawn at three scales: per answer (slide 13),
per claim (slide 24), per change (slide 27). The three demos are the three scales: refused, denied, blocked.

**The principle, named.** "Don't trust the agent. Trust the checks around it - never just one." Candidate names:
1. **Every rule, twice** - chosen. It states the minimum (two places), fits every rule, and sets up the last line.
2. No lone checks - accurate, but a negative is harder to repeat.
3. The five places - vivid, but only the personal-data rule has five; the others have two or three.

**The last sentence:** "If a rule lives in only one place, it's a wish."

## Edit log (one line per change, with the reference talk it borrows from)

| # | Change | Borrowed from |
|---|---|---|
| 1 | Cold open is a failure story with a victim (the CFO on Monday) and a twist (no error, plausible), on its own slide (4) | Willison |
| 2 | 1728 kr held back to slide 23 as the second story: the failure the first fix doesn't catch | Willison |
| 3 | Frame stated once after the first story (slide 6) and named "every rule, twice"; the name returns on 30 and 35 | Willison |
| 4 | "In application security, 99% is a failing grade" on slide 24, as the answer to "why a second agent, not just Guardrails" | Willison |
| 5 | Old slide 8 (architecture inventory) rebuilt as four click-states of one journey (9-12); full version to the appendix (37) | Karpathy (one picture per idea) |
| 6 | Slide 13: the harness as an autonomy slider set to "a human approves every publish" | Karpathy |
| 7 | Demo 3 framed as "the fastest verification there is" | Karpathy (make verification fast) |
| 8 | Slide 16: data path is a workflow, answer path is an agent inside a workflow, consequence decides | Zhang |
| 9 | Slide 17 shows the data model as the agent receives it (describe_model output), not the file | Zhang (think like your agent) |
| 10 | Slide 24 shows the evidence agent's actual input as a context box: question and claims, never the rows | Zhang |
| 11 | One produce-check-act loop, same shape and colours, at three scales (13, 24, 27) and together on 33 | MacCárthaigh |
| 12 | Old slide 9 (state machine diagram) replaced by the loop; the state machine moved to the appendix (38) | MacCárthaigh / Karpathy |
| 13 | Each demo slide carries exactly one "watch for:" line naming the thing to watch in a real tool | brief (none of the four live-coded) |
| 14 | Close: your question round the loop three times (33), three things to take (34), the principle again with nothing new (35), the wish line | Willison (end on the frame) |
| 15 | Well-Architected moved to the appendix (39); old quote "the model is the engine" cut - replaced by the named principle | Karpathy (one idea per slide) |
| 16 | Section dividers renamed as the question each part answers | earlier brief (open with a question) |
| 17 | Agenda now names the three scenes (refused, denied, blocked) instead of four topics | Willison (escalation) |

**Ideas that take more than one slide, and why:**
- The journey (9-12): four click-states of one picture - one idea built up, not four ideas.
- Gold only (15-16): the AWS quote names the problem; the medallion picture answers it. ✂ the quote if late.
- What the agent reads (17-19): agent view, then the three tools that serve it; skills (19) is a cut candidate.
- The contract and its limit (22-23): the schema, then the failure it can't catch. They are one idea told as claim and counter-claim.
- Buy or build (28-29): a table and a rule of thumb; candidate to merge into one slide.

Before you start: board on the projector, phone QR tested, Step Functions and GenAI Observability tabs open, the
`demo/drop-pii-guard` branch pushed but no pull request yet (see `demo-runbook.md`).

---

## Cold open - what is the worst thing this could do? (0:00-2:15)

**Slides 1-2 · Event branding** - *Walk on while they show. Say nothing yet.*

**Slide 3 · Title** (0:00)
> It's Monday, nine o'clock. Someone asked an agent for last week's orders, and the number is in the deck for the
> leadership meeting.

**Slide 4 · The number nobody questioned** (0:20)
> 3146 orders in week 42. The CFO reads it. It's up a lot. Plans get made.
>
> *Pause. Point at the right-hand number.* The real answer is 1032.
>
> Here's the twist: nothing went wrong. No error, no warning, no timeout. The agent wrote `SELECT COUNT(*)` on a sales
> table where every order has about three lines, and it counted lines. A perfectly plausible number, three times too big.
>
> [CAROLINE: one or two sentences of your own - the moment you were asked to "put an agent on our data", or a time a
> confident wrong number got further than it should have. Only if it's true.]
>
> I'm Caroline, Digital Lead at Wallenius Wilhelmsen. This talk is about that number.

## Phones out (2:15-3:00)

**Slide 5 · Ask the lakehouse. Now.** (2:15)
> Take your phone out. Scan this, type a question, press Ask. Eight stores, fifty products, twenty thousand orders.
> Revenue, returns, weeks - or try to break it: ask for customers' email addresses.
>
> Remember your question. At the end you'll hear exactly what happened to it. Nothing you write is posted anywhere until
> I press Approve.

## What's the idea? (3:00-4:00)

**Slide 6 · Don't trust the agent. Trust the checks around it - never just one.** (3:00)
> So here's the idea, once. Don't trust the agent. Trust the checks around it - and never just one. Every rule the agent
> has to follow lives in at least two places, and nothing reaches a person until it has proved itself.
>
> I call it *every rule, twice*. Hold on to that phrase; everything tonight is that idea again, one layer deeper.

**Slide 7 · Agenda** (3:45)
> Three scenes. Something gets refused. Something gets denied. Something gets blocked before it ships. Each one a size
> bigger than the last.

## Where does your question go? (4:00-6:30)

**Slide 8 · Section** (4:00) - *Click through.*

**Slides 9-12 · What happens to your question** (4:05) - *one click per stop; the picture builds.*
> *Slide 9.* You pressed Ask. API Gateway, a small Lambda, and one Step Functions run, named after your question, so it
> can't start twice.
>
> *Slide 10.* The agent - Strands, TypeScript, on AgentCore Runtime - can't touch the lakehouse. It goes through
> AgentCore Gateway with a Cognito token, gets three tools, and runs guarded SQL on Athena as a role that can only see
> gold. That's the rule "no raw tables", twice: the tools and the role.
>
> *Slide 11.* Then two checks the agent didn't write. Bedrock Guardrails asks whether the answer is grounded in the rows,
> and a second agent re-runs every claim.
>
> *Slide 12.* And now it's waiting for me, for up to 24 hours. Nothing has left this account.
> *(If someone asks for the full diagram: it's in the appendix.)*

## Why is that one loop? (6:30-8:30)

**Slide 13 · One loop: produce, check, act** (6:30)
> Pull back and it's one shape. Produce: the agent writes an answer. Check: the contract, grounding, the evidence agent.
> Act: a human approves or rejects. Colm MacCárthaigh's re:Invent talk on control loops draws systems as this shape -
> measure, compare, act. You'll see it two more times tonight, bigger each time.
>
> Andrej Karpathy calls this an autonomy slider. This harness sets it to "a human approves every publish". The design
> question isn't whether you have the slider; it's where you set it.
>
> And in the loop, a failed check never waves anything through. Every step has a timeout, a check that crashes counts as
> a deny, and Publish is never retried, so nothing is ever posted twice.
>
> Confession number one: until last week this loop was one Lambda racing its own deadlines, and if it crashed, a card sat
> in Working forever. "It usually works" is not something you can say to a CFO.
> *Optional: the Step Functions tab, one execution waiting at Wait for decision.* ✂

## Why can't the agent just read the tables? (8:30-13:30)

**Slide 14 · Section** (8:30)
> Remember 3146? That's what reading raw tables does.

**Slide 15 · The medallion quote** (8:35) ✂ (skip the quote, say the problem in one sentence)
> AWS put it like this in September: a medallion used to mean three systems - ETL jobs, an orchestrator, and
> change-data-capture code. When one breaks, everything stops.

**Slide 16 · Bronze in, gold out, nothing in between** (9:10)
> So here it's two layers. Bronze: the raw drop as Iceberg, personal data included. Gold: an Iceberg materialized view
> that Glue refreshes every hour on its own. The agent's role sees gold only, and gold never contains an email address.
> Even if every other check failed, the data isn't there to leak. Every rule, twice.
>
> Barry Zhang draws a line between workflows and agents, and says consequence decides which. The data path is a
> workflow: no orchestrator, no agent, nothing to decide. The answer path is an agent inside a workflow, because that's
> where the consequences are.
>
> Confession number two: this didn't work the first time. On Monday the first deploy failed because I'd left out three
> lines of Spark configuration the AWS guide asks for. And the honest limit: gold refreshes hourly, so an answer can be
> an hour behind.

**Slide 17 · What the agent actually reads** (10:30)
> **This is the first part to take.** Think like the agent: this is what it actually reads when it calls
> describe_model. Not the repo. This.
>
> *Point at the paragraph.* "Count orders with distinct order id, not rows." That sentence is the difference between
> 1032 and 3146.
>
> It comes from one Markdown file in the repo. The same file feeds the tools, the SQL guard, the prompt, Terraform and the
> evaluators. If someone edits it and forgets to regenerate, CI fails. You can copy this tomorrow without anything else
> from this talk.

**Slide 18 · Three tools, one guard it can't talk past** (12:30)
> And if the agent ignores what it read? Three tools. Query only takes a SELECT, always with a limit, and refuses
> anything not in the model, any personal-data column by name, and SELECT star. Behind it, a role that only sees gold and
> a 100 MB scan cap. AgentCore Policy, with Cedar rules on every Gateway call, is the off-the-shelf next step; I keep the
> guard as code because it's unit-tested and it tells the agent why it said no.

**Slide 19 · Skills, tools, harness** - *click past by default.* ✂ *(Cut candidate: if asked - the AWS skill suggests
SELECT star and "ask the user"; here the rules win and the guard enforces them.)*

## Scene one: refused (13:30-16:30)

**Slide 20 · Demo 1 · Refused** (13:30) - **3 minutes** - *watch for: three tool calls, in order, in the trace*
> *Set the stakes.* The worst thing it could do with your question: put customers' email addresses into a comment on a
> public GitHub issue. Let's see the agent behave first.
>
> *Ask, or pick from the board: "What was the revenue per store in ISO week 42?" Switch to CloudWatch GenAI
> Observability, open the trace.* Watch the order: describe_model, explain_metric, query. It read the model, it read the
> definition, then one guarded query.
>
> *Back to the board: the email question.* Refused: personal data isn't available through this interface. If it had
> tried anyway, the guard would have stopped it and the evaluator would have flagged the attempt.
>
> *Turn to the room.* But that was the easy one. The question was obviously forbidden. 3146 wasn't forbidden. It was an
> answer.
>
> **Fallback (script only):** `VITE_REPLAY=/replay.json pnpm dev` in `packages/board` and narrate the recording.

## What if it's confident and wrong? (16:30-21:20)

**Slide 21 · Section** (16:30)

**Slide 22 · An answer is a set of claims with evidence** (16:35)
> **This is the second part to take.** A schema you can bolt onto any agent you already have. An answer is a list of
> claims. A verified claim must point at evidence: the exact SQL, the Athena query id, the rows. Every number in the
> summary has to appear in those rows, digit for digit. Break the contract and the agent gets the errors back: three
> attempts, then it has to refuse.

**Slide 23 · The one the fix wouldn't catch** (17:40)
> Story two. Göteborg, the same week. The right revenue is 1059350.7 kronor. Count the cancelled orders too and you get
> 1061078.7. Off by 1728 kronor. Nobody in the room notices.
>
> And here's the twist: the fix for 3146 doesn't touch it. Worse - if the agent's query was the wrong one, its rows
> agree with its answer. The contract passes, validated twice. Guardrails grounding, threshold 0.7, passes; on Monday a
> real answer scored 0.99. Every check so far asks "does the answer match its evidence?" Nobody has asked "is the
> evidence right?"

**Slide 24 · The evidence agent: reproduce it or deny it** (19:10)
> **This is the third part to take, and the part AWS doesn't sell you.** The same loop, one scale down: per claim.
>
> Think like the evidence agent. *Point at the box.* This is everything it is given: the question and the claims with
> their SQL. Not the analyst's rows - it doesn't get to trust them. So it reads the model, checks the metric definition
> and runs its own query. VERIFIED needs its own query id. Anything it can't reproduce is DENIED, and Approve is refused
> on the server.
>
> Why a second agent and not just a better filter? Simon Willison: in application security, 99% is a failing grade. You
> don't make the bad path less likely. You make it fail closed.
>
> Confession number three, unsolved: today the evidence agent is the same model as the analyst, and two agents with the
> same blind spots can agree. Next is a check in plain code before it - fetch the cited query's results and compare the
> numbers - and a different model as judge. And it costs: on Monday the analyst took 23.9 seconds and the evidence agent
> another 14.7. Your CFO waits about forty seconds for an answer that proves itself.

## Scene two: denied (21:20-23:50)

**Slide 25 · Demo 2 · Denied** (21:20) - **2.5 minutes** - *watch for: the GitHub comment appearing after Approve*
> *Set the stakes.* The CFO question: "What's our margin?" There is no cost price anywhere in this data.
>
> *Ask: "What was the gross margin per product in ISO week 42 of 2026?"* Either the analyst refuses… *(if it does)*
> …which is the right answer… *(or)* …or the evidence agent denies it. DENIED, with the reason, and no Approve button.
>
> *Now a verified card that's waiting. Press Approve. Switch to GitHub and watch.* There. The comment appears - question,
> answer, every claim with its query - now, and not one second before a human said yes.
>
> *Turn to the room.* So it can't publish what it can't prove. But every one of these checks is code. What happens when
> someone on your team, trying to help, deletes one?
>
> **Fallback (script only):** the replay, plus the g9 row in `talk/golden-results.md`.

## What stops a well-meaning change? (23:50-27:50)

**Slide 26 · Section** (23:50)

**Slide 27 · Checked at merge, at release, in production** (23:55)
> The same loop, one scale up: per change. Produce: a pull request. Check: 168 tests, including the guard, the contracts
> and the evidence review, plus the data-model drift check - and before a release, nine golden questions with exact
> answers, two of which must be refused. Act: merge or block. AWS published a sample in September that gates pull
> requests on AgentCore Evaluations below 0.8. That's the one to copy.
>
> Honest limit: my golden set runs by hand before a release; it needs a deployed stack.
>
> Confession number four: last week my own slides drifted from my code. "Everything in Terraform." "The golden set runs
> at merge." Neither was true; I found nine. Now the deck reads its numbers from the code when it's built.

**Slide 28 · What AWS gives you off the shelf** (25:40)
> Why not buy it? For most of it, you should: Quick for chat over governed datasets, Lake Formation to keep an agent on
> gold, Guardrails, AgentCore Evaluations and Policy as the platform. *Point at the red rows.* What nothing on AWS does
> today is check every claim against the data, re-run it with a second agent, and refuse to publish until it holds.

**Slide 29 · When to buy, when to build** (26:40) ✂ (one sentence)
> If a human reads the SQL anyway, buy. If the answer goes to someone who won't, build the evidence and the gate. And for
> us in Sweden: Quick's agents aren't in Stockholm yet; this runs in Frankfurt.

**Slide 30 · Every rule, twice** (27:10)
> *Point at one row.* No personal data: the prompt says it, the guard refuses it by name, IAM can't read bronze, gold
> doesn't contain it, the evaluator flags any attempt. Five places. That's what *every rule, twice* looks like when you
> take it seriously. Now watch what happens when someone removes one.

## Scene three: blocked (27:50-30:20)

**Slide 31 · Demo 3 · Blocked** (27:50) - **2.5 minutes** - *watch for: the diff on one screen, then the red check*
> *Set the stakes.* Not a hacker - a colleague. Someone "simplifies" the SQL guard.
>
> *Open the pull request from `demo/drop-pii-guard`. Show the diff: one deleted block, on one screen.* That's it. It
> looks harmless, the agent still answers, nothing on the board changes. From this moment every future question can
> reach a personal-data column.
>
> *Open the Actions run.* And red. The guard's tests catch it before it merges. Karpathy says the human's job is to make
> verification fast. This is the fastest verification there is: before merge, in minutes, in front of no one.
> *Close the pull request without merging.*
>
> **Fallback (script only):** run `pnpm --filter @lakehouse/shared test` on the branch in the terminal.

## Close - what can't I promise, and where is your question? (30:20-32:10)

**Slide 32 · From demo to production** (30:20) ✂ (one sentence)
> What I can't promise yet: one account, a public runtime, one IAM role, a shared board token. Before real users:
> separate accounts, a VPC, Lake Formation, our own keys, AgentCore Policy, named approvers, the CI sample. None of it
> changes the design.

**Slide 33 · What happened to your question** (30:40)
> *Phones.* So, your question. It went round the loop per answer: written, checked by the contract and by Guardrails,
> and now waiting for me. Every claim in it went round the loop per claim: a second agent re-ran it with its own query.
> And all of that code went round the loop per change before it was allowed to run tonight. Three loops, three scenes:
> refused, denied, blocked. Your question is in that queue right now, for up to 24 hours, and nothing about it has left
> the account. *If time allows: approve one audience question and show the comment.* ✂

**Slide 34 · Take home** (31:20)
> Three things to steal tomorrow morning. Write your data model in Markdown, one file everything reads. Make every answer
> a set of claims that point at evidence. Put a second agent between the answer and the person who will trust it.
> *Point at the QR.* Everything is in the repo.

**Slide 35 · Every rule, twice** (31:50) - *the same slide as 30. Nothing new on it. Let it sit for a breath.*
> Remember 3146. Nothing tonight made the model smarter. What stopped it was a sentence, a schema, a second agent, a test
> and a human. Every rule, twice. Because if a rule lives in only one place, it's a wish.

**Slide 36 · Questions?** (32:10)
> Thank you. *Leave the board visible.*

**Slides 37-40 · Appendix** - *Click past: full architecture, state machine, Well-Architected, further reading.*

**Slides 41-42 · Builder Center, Thank you** - *as the organisers ask.*

---

## Likely questions

- **"Why not Bedrock Knowledge Bases for text-to-SQL?"** Its structured data support runs through Redshift, not Athena.
  AWS calls its query context "best effort" and says it isn't a substitute for guardrails. No evidence per claim, no gate.
- **"Isn't the evidence agent just the same model checking itself?"** Yes, today - confession three. It gets the claims,
  not the rows, and runs its own queries. Next: a plain-code check of the cited query id, then a different model.
- **"What does a question cost?"** Two agents' model tokens, Athena scans capped at 100 MB, seconds of AgentCore and
  Lambda. Measured time: about forty seconds. I don't quote a price I haven't measured.
- **"How do you stop prompt injection through the question?"** The agent's access is the boundary: three tools, a
  guard in code, a role that only sees gold. A successful injection still can't reach bronze, and nothing goes out
  without Approve.
- **"Does this work in Stockholm?"** The harness, yes. Quick's agents, Bedrock structured knowledge bases and the AWS MCP
  Server don't run there yet. See `off-the-shelf.md`.
