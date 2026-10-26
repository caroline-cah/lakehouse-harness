---
metrics:
  revenue:
    definition: Sum of net_revenue_sek over lines of orders whose status is not cancelled. Returned orders count (returns are a separate metric).
    sql: SUM(net_revenue_sek) FROM sales WHERE status <> 'cancelled'
  return_rate:
    definition: Distinct orders with status returned divided by distinct orders not cancelled, in the same period.
    sql: COUNT(DISTINCT CASE WHEN status = 'returned' THEN order_id END) * 1.0 / COUNT(DISTINCT CASE WHEN status <> 'cancelled' THEN order_id END)
  average_order_value:
    definition: Revenue divided by the number of distinct non-cancelled orders.
    sql: SUM(net_revenue_sek) / COUNT(DISTINCT order_id) FROM sales WHERE status <> 'cancelled'
  week:
    definition: ISO week (Monday to Sunday) in Europe/Stockholm time, already computed as iso_year and iso_week.
    sql: iso_year = 2026 AND iso_week = 42
  last_week:
    definition: The most recent complete ISO week before today. On Thursday 29 October 2026 that is week 43, 19 to 25 October.
    sql: iso_year = <ISO year of last week> AND iso_week = <ISO week number of last week>
---

# Metrics

One definition per metric, used by the agent through `explain_metric` and by the evaluators that judge it.

- **Revenue** counts returned orders; returns are their own metric. Cancelled orders are not revenue.
- **Return rate** is per order, not per unit.
- **Weeks** are ISO weeks in Stockholm time, Monday to Sunday. Filter on `iso_year` and `iso_week`.
