# Reference map

Which of the four model talks each slide follows, and the one visual it carries.

- **Willison**: Simon Willison, "The Lethal Trifecta" (2025). Structure: failures as short stories first, then the frame and its name; "99% is a failing grade".
- **Karpathy**: Andrej Karpathy, "Software Is Changing (Again)" (YC, 2025). Framing: one analogy per idea, the picture is the idea; autonomy slider; make verification fast.
- **Zhang**: Barry Zhang, "Building Effective Agents" (AI Engineer, 2025). Scope: workflow vs agent, decided by consequence; think like your agent; show what the model sees.
- **MacCárthaigh**: Colm MacCárthaigh, "Close Loops and Opening Minds" (re:Invent 2018). Drawing: one control loop, redrawn at every scale.

| # | Slide | Model | The one visual |
|---|---|---|---|
| 1-2 | Event branding | (template) | Event artwork |
| 3 | Title | Willison | Title over the start of story one |
| 4 | The number nobody questioned | Willison | 3146 next to 1032 |
| 5 | Ask the lakehouse. Now. | none | QR code |
| 6 | Don't trust the agent… | Willison | The principle and its name |
| 7 | Agenda | Willison (escalation) | Refused, denied, blocked |
| 8 | Where does your question go? | none | Section question |
| 9-12 | What happens to your question | Karpathy | One journey, built up in four clicks |
| 13 | One loop: produce, check, act | MacCárthaigh + Karpathy | The loop, per answer |
| 14 | Why can't the agent just read the tables? | none | Section question |
| 15 | Medallion quote | none | AWS quote |
| 16 | Bronze in, gold out | Zhang | Bronze to gold, the agent on gold only |
| 17 | What the agent actually reads | Zhang | describe_model output, as the agent sees it |
| 18 | Three tools, one guard | Zhang (scope) | Three tool columns |
| 19 | Skills, tools, harness | none | Three columns |
| 20 | Demo 1 · Refused | Karpathy | "watch for: three tool calls, in order" |
| 21 | What if it's confident and wrong? | none | Section question |
| 22 | An answer is a set of claims | Karpathy (one picture) | The schema |
| 23 | The one the fix wouldn't catch | Willison | 1061078.7 next to 1059350.7 |
| 24 | The evidence agent | MacCárthaigh + Zhang + Willison | The loop per claim, with the agent's context box |
| 25 | Demo 2 · Denied | Karpathy | "watch for: the GitHub comment after Approve" |
| 26 | What stops a well-meaning change? | none | Section question |
| 27 | Checked at merge, at release, in production | MacCárthaigh | The loop, per change |
| 28 | What AWS gives you off the shelf | none | Buy vs build table |
| 29 | When to buy, when to build | none | Three columns |
| 30 | Every rule, twice | Willison | Enforcement table, named |
| 31 | Demo 3 · Blocked | Karpathy | "watch for: the diff, then the red check" |
| 32 | From demo to production | none | Demo vs production table |
| 33 | What happened to your question | MacCárthaigh | Three loops side by side |
| 34 | Take home | none | Three things and the repo QR |
| 35 | Every rule, twice (again) | Willison | Same slide as 30, nothing new |
| 36 | Questions? | (template) | - |
| 37-40 | Appendix | none | Architecture, state machine, Well-Architected, reading |
| 41-42 | Builder Center, Thank you | (template) | - |

## What still follows none of the four, and why it is there anyway

This is the next round of cuts.

| Slide | Why it's still there | Cut test |
|---|---|---|
| 5 · QR code | The audience participation is the premise of the close. | Keep, but could live on slide 4's corner. |
| 8, 14, 21, 26 · Section questions | They mark the escalation. | Could become the titles of the next slide, which saves four clicks. |
| 15 · Medallion quote | Gives the AWS framing credibility. | Already ✂; slide 16 can carry the problem in one sentence. |
| 19 · Skills, tools, harness | A real feature, and the audience asks about AWS skills. | Clicked past by default; cut unless a question needs it. |
| 28-29 · Buy vs build | Honest limit; it answers "why not buy?". | Merge into one slide: the table with the rule of thumb as its title. |
| 32 · From demo to production | Honest limit; architects ask for it. | Could move to the appendix once the limits in the body (gold staleness, same model, golden by hand, Stockholm) stand on their own. |
| 34 · Take home list | The three steals need a moment of their own. | Could become three callouts on slide 33. |
| 37-40 · Appendix | For people who download the deck. | Off-stage; costs nothing. |
