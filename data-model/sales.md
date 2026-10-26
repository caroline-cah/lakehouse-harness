---
description: One row per order line, with its order, store and product. The only table the agent can query.
grain: order_id + line_no
columns:
  - { name: order_id, type: string, description: Order identifier }
  - { name: line_no, type: int, description: Line number within the order }
  - { name: customer_id, type: string, description: Pseudonymous customer identifier }
  - { name: order_ts, type: string, description: Order timestamp, ISO 8601 UTC }
  - { name: order_date, type: date, description: Order date in Stockholm time }
  - { name: iso_year, type: int, description: ISO week-numbering year of order_date }
  - { name: iso_week, type: int, description: ISO week of order_date (Monday to Sunday) }
  - { name: status, type: string, description: "Status of the whole order: placed, returned or cancelled" }
  - { name: channel, type: string, description: "web or store" }
  - { name: store_id, type: string, description: Store that fulfilled the order }
  - { name: store_name, type: string, description: Store name }
  - { name: store_city, type: string, description: Store city }
  - { name: store_region, type: string, description: Sales region }
  - { name: product_id, type: string, description: Product sold }
  - { name: product_name, type: string, description: Product name }
  - { name: category, type: string, description: Product category }
  - { name: brand, type: string, description: Product brand }
  - { name: qty, type: int, description: Units sold }
  - { name: unit_price, type: double, description: Price per unit in SEK }
  - { name: discount, type: double, description: Discount for the line in SEK }
  - { name: net_revenue_sek, type: double, description: "qty * unit_price - discount, in SEK" }
joins: []
materialization:
  refresh: 1 HOUR
  sql: >-
    SELECT l.order_id, CAST(l.line_no AS INT) AS line_no, o.customer_id, o.order_ts,
    to_date(from_utc_timestamp(CAST(o.order_ts AS TIMESTAMP), 'Europe/Stockholm')) AS order_date,
    extract(YEAROFWEEK FROM to_date(from_utc_timestamp(CAST(o.order_ts AS TIMESTAMP), 'Europe/Stockholm'))) AS iso_year,
    weekofyear(to_date(from_utc_timestamp(CAST(o.order_ts AS TIMESTAMP), 'Europe/Stockholm'))) AS iso_week,
    o.status, o.channel, o.store_id, s.name AS store_name, s.city AS store_city, s.region AS store_region,
    l.product_id, p.name AS product_name, p.category, p.brand,
    CAST(l.qty AS INT) AS qty, CAST(l.unit_price AS DOUBLE) AS unit_price, CAST(l.discount AS DOUBLE) AS discount,
    CAST(l.qty AS INT) * CAST(l.unit_price AS DOUBLE) - CAST(l.discount AS DOUBLE) AS net_revenue_sek
    FROM glue_catalog.lakehouse_bronze.order_lines l
    JOIN glue_catalog.lakehouse_bronze.orders o ON l.order_id = o.order_id
    JOIN glue_catalog.lakehouse_bronze.stores s ON o.store_id = s.store_id
    JOIN glue_catalog.lakehouse_bronze.products p ON l.product_id = p.product_id
---

# Sales

What was sold, line by line, with everything needed to slice it: when (ISO week in Stockholm time), where (store,
city, region), what (product, category, brand) and how (web or store). Revenue is `net_revenue_sek`, never list prices.

An order's `status` is repeated on each of its lines: count orders with `COUNT(DISTINCT order_id)`, not rows. A
returned order stays in the table; a cancelled one never shipped and is left out of revenue. There is no cost price,
so margin cannot be answered from this model. Customers are pseudonymous ids: contact details stay in bronze.
