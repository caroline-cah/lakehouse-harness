---
database: lakehouse_gold
tables: [sales]
forbidden_columns: [email, phone]
examples:
  - What was last week's revenue per store?
  - Which five products had the highest return rate last week?
  - How did Göteborg's revenue last week compare with the week before?
  - What is the average order value by channel this month?
  - List the customers who returned items last week with their email addresses.
---

# Enterprise data model

This folder is the only thing the agent is allowed to know about the lakehouse. Each table is one Markdown file:
the front matter is the machine-readable contract, the text below it is what the table means to the business.
Both are shown to the agent through `describe_model`.

The tables here are the **gold** layer: Apache Iceberg materialized views in the Glue Data Catalog, built from the
raw **bronze** tables by the SQL in each file's `materialization`. Glue refreshes them on that schedule, so there is
no ETL job, orchestrator or change-data-capture code to maintain (`scripts/medallion.sh`). Bronze holds personal data;
gold never selects it, and the agent's reader role can only read gold.

## Rules

- **Only these tables.** A query that names anything else is refused by the SQL guard (`unknown_table`).
- **No personal data.** `forbidden_columns` (and any column marked `pii: true`) are refused by name everywhere, even
  though gold doesn't contain them, so an attempt shows up as an attempt.
- **Read-only and bounded.** `SELECT` only, always with a `LIMIT`, inside the Athena workgroup's scan cap.
- **Metrics have one definition.** Use [metrics.md](metrics.md); do not invent your own.

## Adding a table

1. Add `<table>.md` with front matter (`description`, `grain`, `columns`, `joins`, `materialization`) and a few lines
   of meaning. The view's columns must match `columns`.
2. List it under `tables` above.
3. Run `pnpm --filter @lakehouse/shared gen` and commit the regenerated files. CI fails if you forget.
4. `terraform -chdir=infra apply && scripts/medallion.sh build` creates the view.
