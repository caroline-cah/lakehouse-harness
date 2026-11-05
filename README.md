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
