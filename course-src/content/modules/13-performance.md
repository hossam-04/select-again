---
id: performance
title: Indexes and performance
kicker: B-trees · EXPLAIN · sargable · composite · covering
summary: What an index really is, how to read a query plan, and the handful of rules that decide whether your query uses one.
---

## What an index is

A B-tree index is a **sorted copy** of one or more columns, with each entry pointing back to its row. Because it's sorted, the database can:

- **find** a value without reading the whole table (a *seek*, roughly log₂(n) steps: about 20 for a million rows),
- read a **range** (`BETWEEN`, `>`, `LIKE 'abc%'`) as one contiguous slice,
- return rows **already ordered**, skipping a sort,
- answer a query **from the index alone** when it contains every column the query needs (a *covering* index).

In InnoDB the table itself is a B-tree ordered by the primary key (the *clustered index*). Every secondary index stores the primary key as its pointer back to the row. That's one reason short primary keys matter.

## Reading a plan with EXPLAIN

`EXPLAIN` shows how the database intends to run a query without running it. In MySQL you get a table with one row per table access. The columns worth reading first:

| Column | What to look for |
|---|---|
| `type` | Access method, from best to worst: `const` → `eq_ref` → `ref` → `range` → `index` → **`ALL`** (a full table scan) |
| `key` | The index actually chosen (`NULL` means none) |
| `rows` | Estimated rows examined |
| `Extra` | `Using index` (covering, good), `Using where`, **`Using filesort`** (a sort step), **`Using temporary`** (a temp table) |

For example, a lookup by customer before and after adding an index on `orders.customer_id` looks like this in MySQL:

| id | select_type | table | type | possible_keys | key | rows | Extra |
|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | orders | **ALL** | NULL | NULL | 24 | Using where |
| 1 | SIMPLE | orders | **ref** | idx_orders_customer | idx_orders_customer | 3 | NULL |

This page runs SQLite, so its `EXPLAIN` prints SQLite's plan instead: **`SCAN`** means a full scan, **`SEARCH … USING INDEX`** means an index seek, and **`USE TEMP B-TREE FOR ORDER BY`** means a sort. The ideas map one to one.

```sql run
EXPLAIN SELECT * FROM orders WHERE customer_id = 9;
```

```sql run
CREATE INDEX idx_orders_customer ON orders (customer_id);
EXPLAIN SELECT * FROM orders WHERE customer_id = 9;
```

:::tip EXPLAIN ANALYZE
MySQL 8.0.18+ has `EXPLAIN ANALYZE`, which actually runs the query and reports real row counts and timings per step. It's the fastest way to find which step is slow. `EXPLAIN FORMAT=TREE` gives the same tree without running anything.
:::

## Sargable conditions: don't wrap the column

An index stores the column's raw values. Wrap the column in a function or expression and the index can't be searched, because the database would have to compute the function for every row first. Conditions that *can* use an index are called **sargable** (Search ARGument ABLE).

```sql run
CREATE INDEX idx_orders_date ON orders (order_date);
EXPLAIN SELECT order_id FROM orders WHERE YEAR(order_date) = 2024;
```

```sql run
CREATE INDEX idx_orders_date ON orders (order_date);
EXPLAIN SELECT order_id FROM orders WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01';
```

Common index-killers and their rewrites:

| Instead of | Write |
|---|---|
| `YEAR(d) = 2024` | `d >= '2024-01-01' AND d < '2025-01-01'` |
| `DATE(ts) = '2024-05-01'` | `ts >= '2024-05-01' AND ts < '2024-05-02'` |
| `price * 1.2 > 100` | `price > 100 / 1.2` |
| `LOWER(email) = 'a@x.io'` | `email = 'a@x.io'` (already case-insensitive in MySQL), or a functional index |
| `name LIKE '%son'` | Can't use a B-tree. Consider full-text search or a reversed column |
| `varchar_col = 42` | `varchar_col = '42'`. Comparing a string column to a number converts every row in MySQL |

:::dialect Functional indexes
MySQL 8.0.13+ can index an expression, `CREATE INDEX idx ON orders ((YEAR(order_date)))`, and PostgreSQL has had expression indexes for years. They help when you can't change the query, but a plain range condition on a plain index is usually the better fix.
:::

## Composite indexes: order matters

An index on `(a, b, c)` is sorted by `a`, then `b` within each `a`, then `c`. It can serve conditions on a **leftmost prefix**: `a`, or `a` and `b`, or all three. It can't serve `b` alone, just as a phone book sorted by (last name, first name) can't find everyone named "Ana" quickly.

```sql run
CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date);
EXPLAIN SELECT * FROM orders WHERE customer_id = 1 AND order_date >= '2024-06-01';
```

```sql run
CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date);
EXPLAIN SELECT * FROM orders WHERE order_date >= '2024-06-01';
```

:::key Rule of thumb
Put **equality** columns first, then the **range** or **sort** column. `(customer_id, order_date)` serves "this customer's orders since June, newest first" with a single seek and no sort. `(order_date, customer_id)` doesn't.
:::

## Covering indexes and ORDER BY

When every column the query touches is in the index, the table rows are never read:

```sql run
CREATE INDEX idx_orders_cust_status ON orders (customer_id, status);
EXPLAIN SELECT status, COUNT(*) FROM orders WHERE customer_id = 9 GROUP BY status;
```

An index can also hand rows back **in order**, which removes the sort step. Compare the two plans:

```sql run
EXPLAIN SELECT order_id, order_date FROM orders ORDER BY order_date DESC LIMIT 5;
```

```sql run
CREATE INDEX idx_orders_date ON orders (order_date);
EXPLAIN SELECT order_id, order_date FROM orders ORDER BY order_date DESC LIMIT 5;
```

## Indexes aren't free

- Every INSERT, UPDATE and DELETE must also update every index on the table. Write-heavy tables pay for each extra index.
- Indexes take disk space and buffer-pool memory.
- **Selectivity** matters. An index on a column with three distinct values (say, `status`) is rarely chosen alone, because reading a third of the table through an index is slower than scanning it. It works better as the second column of a composite index.
- The optimizer relies on **statistics**. Stale statistics produce bad plans, so run `ANALYZE TABLE t` after big data changes.

## Query habits that scale

- **Select only the columns you need.** Beyond bytes on the wire, it's what makes covering indexes possible.
- **Paginate with keysets**, not large OFFSETs: `WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT 50`.
- **Avoid N+1 queries** from application code: one query with a JOIN or `IN (…)` beats a thousand single-row lookups.
- **Filter early.** Conditions in WHERE and join keys on indexed columns cut the rows before joins multiply them.
- `COUNT(*)` on a big InnoDB table scans an index, and it isn't free. Cache or approximate counts shown on every page.
- Watch for **implicit conversions** in join keys (INT joined to VARCHAR), which silently disable indexes.

:::interview What they're looking for
"How would you speed this query up?" Answer with the plan first (EXPLAIN), then the specific fix: which index, with which column order and why. Mention the write cost. Generic answers like "add indexes" or "use a cache" score low.
:::

## Quick check

:::quiz
? An index on `(last_name, first_name)` can speed up which query?
- [x] `WHERE last_name = 'Chen' AND first_name LIKE 'L%'`
- [ ] `WHERE first_name = 'Lina'`
- [ ] `WHERE CONCAT(last_name, first_name) = 'ChenLina'`
- [ ] `WHERE last_name LIKE '%en'`
> Leftmost prefix, plus a range on the next column. The others skip the first column, wrap it in a function, or start with a wildcard.

? `WHERE YEAR(created_at) = 2024` doesn't use the index on `created_at`. Best rewrite?
- [ ] `WHERE YEAR(created_at) >= 2024 AND YEAR(created_at) < 2025`
- [x] `WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01'`
- [ ] `WHERE created_at LIKE '2024%'`
- [ ] Add `FORCE INDEX`
> Leave the column bare and move the computation to the constant side. That's a sargable range.

? In MySQL's EXPLAIN, which `type` value means a full table scan?
- [ ] ref
- [ ] range
- [x] ALL
- [ ] const
> `ALL` reads every row. `index` reads a whole index, which is cheaper but still a full pass.

? Why might MySQL ignore an index on `orders.status` (4 distinct values)?
- [ ] Indexes don't work on ENUM columns
- [x] Low selectivity: fetching a quarter of the table through the index is slower than scanning it
- [ ] It needs ANALYZE first, always
- [ ] Status should be the primary key
> The optimizer estimates cost. Low-cardinality columns are more useful as a later column in a composite index.
:::
