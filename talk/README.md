# Harness Engineering, live

**Caroline Cah**, Digital Lead, Wallenius Wilhelmsen

| | |
|---|---|
| Linköping | AWS User Group, 29 October 2026 |
| Stockholm | AWS User Group, 5 November 2026 |
| Slot | 30–40 minutes, three live demos |

You ask a retail lakehouse questions from your phone, and an agent on Amazon Bedrock AgentCore answers through a
governed data model instead of raw tables. Every claim carries its evidence, a second agent has to reproduce it or
deny it, and nothing an agent does reaches a human, or main, without being checked.

## Three takeaways

1. **Give the agent a data model, not tables.** Write it in Markdown ([`data-model/`](../data-model)) and let it
   build the gold layer.
2. **Make evidence structural.** A contract the answer must satisfy, and an evidence agent that reproduces each claim
   or denies it.
3. **Buy the platform, build the gap.** AgentCore Evaluations and Policy, Guardrails and Lake Formation off the shelf;
   build the per-claim evidence, the evidence agent and the Approve gate. Check every change with CI, a golden set and
   online evaluations.

## In this folder

| File | What |
|---|---|
| [`outline.md`](outline.md) | Slides and speaker notes: the source of truth for the deck |
| [`script.md`](script.md) | What to say, slide by slide, with timings, demo moves, fallbacks and likely questions |
| [`harness-engineering-live.pptx`](harness-engineering-live.pptx) | The deck, generated, on the AWS Dev Day theme |
| [`build_deck.py`](build_deck.py) | Builds the deck from the outline and the theme |
| [`demo-runbook.md`](demo-runbook.md) | What to do the day before, the hour before and on stage, with fallbacks |
| [`off-the-shelf.md`](off-the-shelf.md) | What AWS offers off the shelf for each part of the talk, with sources: the build-vs-buy slides |
| [`theme/`](theme) | The AWS Dev Day template |

## Rebuild the deck

```bash
cd talk
python3 -m venv .venv && .venv/bin/pip install python-pptx==1.0.2 "qrcode[pil]==8.0"
.venv/bin/python -I build_deck.py \
  --form-url "$(terraform -chdir=../infra output -raw api_url)" \
  --repo-url https://github.com/<owner>/lakehouse-harness
```

Without `--form-url` or `--repo-url`, the QR codes are replaced by highlighted `[[FORM URL]]` / `[[REPO URL]]`
placeholders. Edit `outline.md`, never the .pptx.
