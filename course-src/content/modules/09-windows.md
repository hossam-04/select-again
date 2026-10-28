---
id: windows
title: Window functions
kicker: OVER · PARTITION BY · ROW_NUMBER · RANK · LAG · running totals
summary: Calculations across related rows without collapsing them — ranking, previous/next values, running totals and moving averages. The single biggest upgrade to your SQL since you last used it.
clauses: SELECT, ORDER BY
---

## Aggregate without collapsing

`GROUP BY` squeezes each group into one row. A **window function** computes over a group of related rows but keeps every row, attaching the result to each one:

```sql run
SELECT first_name, dept_id, salary,
       ROUND(AVG(salary) OVER (PARTITION BY dept_id)) AS dept_avg,
       salary - ROUND(AVG(salary) OVER (PARTITION BY dept_id)) AS vs_avg
FROM employees
WHERE dept_id IS NOT NULL
ORDER BY dept_id, salary DESC;
```

The anatomy: `function(...) OVER (PARTITION BY … ORDER BY … frame)`.

- `PARTITION BY` splits rows into independent groups, like GROUP BY but without collapsing. Leave it out and the whole result is one partition.
- `ORDER BY` inside OVER orders rows *within* each partition. Ranking and LAG/LEAD need it, and it also turns aggregates into running totals.
- The **frame** (`ROWS BETWEEN …`) narrows which rows count, for moving windows.

:::key Windows run late
Window functions are evaluated after `WHERE`, `GROUP BY` and `HAVING`, just before `ORDER BY`/`LIMIT`. So you **can't filter on them in WHERE**. Compute them in a subquery or CTE and filter outside. That wrapping step is the heart of most window-function patterns.
:::

## Ranking: ROW_NUMBER, RANK, DENSE_RANK

The three differ only on ties:

```sql run
SELECT first_name, salary,
       ROW_NUMBER() OVER (ORDER BY salary DESC) AS row_num,
       RANK()       OVER (ORDER BY salary DESC) AS rnk,
       DENSE_RANK() OVER (ORDER BY salary DESC) AS dense_rnk
FROM employees
WHERE salary < 115000
ORDER BY salary DESC, first_name;
```

- `ROW_NUMBER` gives 1, 2, 3, 4 and breaks ties arbitrarily, so add a tie-breaker to its ORDER BY when it matters.
- `RANK` gives 1, 2, 2, 4: ties share a rank, then the numbering skips.
- `DENSE_RANK` gives 1, 2, 2, 3: ties share a rank and the numbering doesn't skip.

"Nth highest distinct value" is `DENSE_RANK`. "The first row per group" is `ROW_NUMBER`. "Everyone tied for first" is `RANK` or `DENSE_RANK` = 1.

### Top N per group

Rank inside each partition, then filter in an outer query:

```sql run
SELECT dept_id, first_name, salary
FROM (
  SELECT dept_id, first_name, salary,
         DENSE_RANK() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rnk
  FROM employees
  WHERE dept_id IS NOT NULL
) ranked
WHERE rnk <= 2
ORDER BY dept_id, rnk, first_name;
```

Sales shows three people: Youssef, then Emma and Hana tied for second. That's the behavior #185 asks for.

:::gotcha rank is a reserved word
Since MySQL 8.0.2, `RANK`, `DENSE_RANK`, `ROW_NUMBER`, `LAG`, `LEAD` and the other window function names are reserved words. `… AS rank` is a syntax error. Write `` AS `rank` `` or choose another name such as `rnk`.
:::

## LAG and LEAD: the neighbouring row

`LAG(col, n, default)` reads the value `n` rows earlier within the partition (default n is 1), and `LEAD` reads later rows. They're how you compare each row with the previous one without a self-join:

```sql run
SELECT customer_id, order_id, order_date,
       LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) AS previous_order,
       DATEDIFF(order_date,
                LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date)) AS days_since
FROM orders
WHERE customer_id IN (1, 9)
ORDER BY customer_id, order_date;
```

:::gotcha Previous row is not previous day
`LAG` returns the previous *row*. If days can be missing, "yesterday's temperature" needs a check that the previous row really is yesterday (#197) or a date-based self-join.
:::

## Running totals and moving windows

Add `ORDER BY` to an aggregate's OVER and it becomes cumulative:

```sql run
WITH monthly AS (
  SELECT DATE_FORMAT(o.order_date, '%Y-%m') AS month,
         SUM(oi.quantity * oi.unit_price)    AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY month
)
SELECT month, revenue,
       SUM(revenue) OVER (ORDER BY month)                                  AS running_total,
       ROUND(AVG(revenue) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)) AS moving_avg_3m
FROM monthly
ORDER BY month;
```

The frame clause `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` means "this row and the two before it". Other boundaries are `UNBOUNDED PRECEDING`, `n FOLLOWING` and `UNBOUNDED FOLLOWING`.

:::gotcha The default frame and ties
With `ORDER BY` but no frame, the default is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. `RANGE` includes every row **tied** with the current one, so tied rows all get the same running total. When you want a strict row-by-row running total, say `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`.
:::

```sql run
SELECT first_name, salary,
       SUM(salary) OVER (ORDER BY salary)                                         AS range_default,
       SUM(salary) OVER (ORDER BY salary ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rows_frame
FROM employees
WHERE dept_id = 4
ORDER BY salary, first_name;
```

Ahmed and Julia both earn 78,000. With the default frame they both show 156,000, but the ROWS frame counts them one at a time.

## FIRST_VALUE, LAST_VALUE, NTH_VALUE

These return a value from the first, last or n-th row of the frame. `LAST_VALUE` has a famous trap: with the default frame, the "last" row is the current row. Widen the frame to the whole partition:

```sql run
SELECT first_name, dept_id, salary,
       FIRST_VALUE(first_name) OVER w AS top_earner,
       LAST_VALUE(first_name)  OVER w AS lowest_earner
FROM employees
WHERE dept_id IN (2, 3)
WINDOW w AS (PARTITION BY dept_id ORDER BY salary DESC
             ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
ORDER BY dept_id, salary DESC;
```

The `WINDOW w AS (…)` clause names a window definition so several functions can share it.

## Aggregates as annotations

Plain aggregates over a partition annotate each row with group facts, such as a count or a share of the total:

```sql run
SELECT name, category, price,
       COUNT(*)   OVER (PARTITION BY category)                     AS in_category,
       ROUND(100 * price / SUM(price) OVER (PARTITION BY category), 1) AS pct_of_category
FROM products
ORDER BY category, price DESC;
```

`NTILE(n)` splits ordered rows into n buckets (quartiles, deciles), and `PERCENT_RANK()` / `CUME_DIST()` give relative positions from 0 to 1.

:::dialect
Window functions arrived in **MySQL 8.0** and SQLite 3.25, and have been in PostgreSQL and SQL Server for much longer. PostgreSQL adds `FILTER (WHERE …)` on aggregates and `QUALIFY`-style filtering needs a subquery everywhere except Snowflake, BigQuery and DuckDB. MySQL supports `RANGE` frames with date intervals: `RANGE BETWEEN INTERVAL 6 DAY PRECEDING AND CURRENT ROW`.
:::

## Quick check

:::quiz
? Salaries 500, 400, 400, 300 ordered DESC. What does `DENSE_RANK()` give the 300?
- [ ] 4
- [x] 3
- [ ] 2
- [ ] NULL
> DENSE_RANK doesn't skip after ties: 1, 2, 2, 3. RANK would give 4.

? Why doesn't `WHERE ROW_NUMBER() OVER (…) = 1` work?
- [ ] ROW_NUMBER needs PARTITION BY
- [x] Window functions are evaluated after WHERE, so WHERE can't see them
- [ ] It works in MySQL 8
- [ ] ROW_NUMBER returns a string
> Compute the row number in a subquery or CTE, then filter it in the outer query.

? `SUM(x) OVER (ORDER BY d)` with two rows sharing the same `d` gives those rows…
- [x] the same running total, which includes both of them
- [ ] different running totals, row by row
- [ ] NULL
- [ ] an error
> The default frame is RANGE, which treats tied rows as peers. Use `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` for strict row-by-row totals.

? `LAST_VALUE(name) OVER (PARTITION BY g ORDER BY x)` returns the current row's name. Why?
- [ ] LAST_VALUE is broken in MySQL
- [x] The default frame ends at the current row, so the current row *is* the last one in the frame
- [ ] It needs DESC ordering
- [ ] PARTITION BY is ignored
> Widen the frame: `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`, or use `FIRST_VALUE` with the opposite ordering.

? Which is a valid MySQL 8 alias for a ranking column?
- [ ] `AS rank`
- [x] `` AS `rank` ``
- [ ] `AS RANK()`
- [ ] `AS 'rank()'`
> RANK is a reserved word in MySQL 8, so quote it with backticks, or name the column something else.
:::
