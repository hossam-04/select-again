---
id: aggregation
title: Aggregation
kicker: GROUP BY · HAVING · COUNT · SUM · conditional aggregation
summary: Collapsing rows into answers — counting, summing and averaging per group, filtering groups, and the conditional-aggregation trick behind half of all reporting queries.
clauses: GROUP BY, HAVING, SELECT
---

## Aggregate functions

An aggregate turns many rows into one value. The five you'll use constantly:

| Function | Counts / computes | NULLs |
|---|---|---|
| `COUNT(*)` | rows | counted |
| `COUNT(col)` | rows where `col` is not NULL | skipped |
| `COUNT(DISTINCT col)` | distinct non-NULL values | skipped |
| `SUM(col)`, `AVG(col)` | total, mean | skipped (AVG divides by the non-NULL count) |
| `MIN(col)`, `MAX(col)` | smallest, largest (works on dates and text too) | skipped |

```sql run
SELECT COUNT(*)                AS employees,
       COUNT(email)            AS with_email,
       COUNT(DISTINCT dept_id) AS departments,
       SUM(salary)             AS payroll,
       ROUND(AVG(salary))      AS avg_salary,
       MIN(hire_date)          AS first_hire,
       MAX(hire_date)          AS latest_hire
FROM employees;
```

Ahmed has no email, so `COUNT(email)` is 15, not 16. The CEO has no department, and `COUNT(DISTINCT dept_id)` ignores her NULL, so it reports 4 departments.

:::gotcha Empty input
An aggregate over zero rows still returns one row: `COUNT` gives 0, but `SUM`, `AVG`, `MIN` and `MAX` give **NULL**. Wrap them with `IFNULL(SUM(x), 0)` when a total should read 0.
:::

## GROUP BY: one row per group

`GROUP BY` splits the rows into groups that share the same values, then each aggregate runs once per group:

```sql run
SELECT dept_id,
       COUNT(*)            AS headcount,
       ROUND(AVG(salary))  AS avg_salary,
       MAX(salary)         AS top_salary
FROM employees
GROUP BY dept_id
ORDER BY dept_id;
```

The NULL `dept_id` forms its own group (the CEO). You can group by several columns, or by an expression. Monthly order counts:

```sql run
SELECT DATE_FORMAT(order_date, '%Y-%m') AS month,
       COUNT(*)                          AS orders
FROM orders
GROUP BY month            -- MySQL allows the SELECT alias here
ORDER BY month;
```

:::key The golden rule of grouping
After `GROUP BY`, every column in SELECT must be either **in the GROUP BY** or **inside an aggregate**. Otherwise, which row's value would it show? MySQL enforces this with `ONLY_FULL_GROUP_BY` (on by default since 5.7, and on at LeetCode). The one exception is a column *determined* by the grouped primary key: after `GROUP BY d.dept_id` you may select `d.name`.
:::

```sql run warn
SELECT dept_id, first_name, COUNT(*) AS headcount
FROM employees
GROUP BY dept_id;
```

This engine ran it and picked an arbitrary `first_name` per group, but MySQL would refuse. Decide what you actually want: `MAX(first_name)`, a `GROUP_CONCAT` of all names, or the top earner per group (that one needs Module 9).

## WHERE vs HAVING

- **WHERE** filters *rows*, before grouping. It can't see aggregates.
- **HAVING** filters *groups*, after aggregating. It usually tests an aggregate.

```sql run
-- departments with at least 3 people hired before 2023
SELECT dept_id, COUNT(*) AS veterans
FROM employees
WHERE hire_date < '2023-01-01'   -- row filter
GROUP BY dept_id
HAVING COUNT(*) >= 3;            -- group filter
```

A condition that doesn't involve an aggregate belongs in WHERE. It's cheaper, because rows are dropped before any grouping work happens.

## Conditional aggregation

This is the single most useful aggregation trick. Put a condition *inside* the aggregate to count or sum only some rows, and get several answers from one pass:

```sql run
SELECT customer_id,
       COUNT(*)                                       AS orders,
       SUM(status = 'delivered')                      AS delivered,
       SUM(status = 'cancelled')                      AS cancelled,
       ROUND(100 * AVG(status = 'cancelled'), 1)      AS cancel_pct
FROM orders
GROUP BY customer_id
HAVING COUNT(*) >= 3
ORDER BY customer_id;
```

In MySQL a comparison is 1 or 0, so `SUM(cond)` counts the rows where it holds and `AVG(cond)` is the fraction. The portable spelling is `SUM(CASE WHEN cond THEN 1 ELSE 0 END)`, and to sum an amount instead of counting, use `SUM(CASE WHEN cond THEN amount ELSE 0 END)` or `SUM(IF(cond, amount, 0))`.

:::gotcha COUNT(condition) counts everything
`COUNT(status = 'cancelled')` counts every row, because the condition evaluates to 0 or 1 and neither is NULL. To count matches, use `SUM(cond)`, or `COUNT(CASE WHEN cond THEN 1 END)`: the missing ELSE yields NULL, which COUNT skips.
:::

```sql run
SELECT COUNT(status = 'cancelled')                   AS wrong_count,
       SUM(status = 'cancelled')                     AS sum_count,
       COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS count_case
FROM orders;
```

## Totals from related rows

Aggregates happily take expressions. Order totals come from the line items:

```sql run
SELECT order_id,
       SUM(quantity * unit_price) AS order_total,
       COUNT(*)                   AS lines
FROM order_items
GROUP BY order_id
HAVING order_total > 2000        -- MySQL allows the alias in HAVING
ORDER BY order_total DESC;
```

## GROUP_CONCAT: a list per group

`GROUP_CONCAT(expr ORDER BY … SEPARATOR '…')` glues a group's values into one string, and `DISTINCT` removes repeats:

```sql run
SELECT category,
       COUNT(*) AS n,
       GROUP_CONCAT(name ORDER BY price DESC SEPARATOR ', ') AS products
FROM products
GROUP BY category
ORDER BY n DESC, category;
```

:::work group_concat_max_len
MySQL silently truncates `GROUP_CONCAT` results at `group_concat_max_len` bytes, which defaults to **1024**. Long lists get cut off without an error. Raise it per session with `SET SESSION group_concat_max_len = 100000;` before relying on long lists.
:::

:::dialect
PostgreSQL uses `string_agg(name, ', ' ORDER BY price DESC)`, and SQL Server 2017+ uses `STRING_AGG(name, ', ') WITHIN GROUP (ORDER BY price DESC)`. Both have `FILTER (WHERE …)` or `CASE` for conditional aggregates. PostgreSQL enforces the grouping rule just like `ONLY_FULL_GROUP_BY`.
:::

## Things you can't do (and what to do instead)

- **Nest aggregates:** `MAX(COUNT(*))` is an error. Aggregate once in a subquery, then aggregate again outside, or sort and take the top: `ORDER BY COUNT(*) DESC LIMIT 1`.
- **Filter on an aggregate in WHERE:** use HAVING.
- **Mix detail and totals in one row** without a window function: "each employee with their department's average" is a job for Module 9's `AVG(salary) OVER (PARTITION BY dept_id)`.

:::interview Read the grain first
Before writing a GROUP BY, say what one output row represents: "one row per customer per month". The GROUP BY columns are exactly that grain. Most wrong answers group at the wrong grain, for example per day when the question asks per month, or per (date, product) when it asks per date.
:::

## Quick check

:::quiz
? `SELECT COUNT(city), COUNT(*) FROM customers` where 2 of 12 cities are NULL returns…
- [ ] 12, 12
- [x] 10, 12
- [ ] 12, 10
- [ ] 10, 10
> `COUNT(col)` skips NULLs; `COUNT(*)` counts rows.

? Where does a condition like `salary > 50000` belong in a grouped query?
- [x] WHERE — it filters rows before grouping
- [ ] HAVING — all conditions in a grouped query go there
- [ ] Either; MySQL moves it automatically
- [ ] Inside COUNT()
> Row-level conditions go in WHERE. HAVING is for conditions on the groups themselves, typically on aggregates.

? What does `SUM(amount)` return for a group where every `amount` is NULL?
- [ ] 0
- [x] NULL
- [ ] an error
- [ ] the row count
> SUM skips NULLs, and with nothing left to add, the result is NULL. Use `IFNULL(SUM(amount), 0)` for a zero.

? You need, per country, the number of approved transactions. Which expression is correct?
- [ ] `COUNT(state = 'approved')`
- [x] `SUM(state = 'approved')`
- [ ] `COUNT(*) WHERE state = 'approved'`
- [ ] `MAX(state = 'approved')`
> `COUNT(condition)` counts the 0s as well as the 1s. `SUM(condition)` adds up the 1s. (`COUNT(*) WHERE …` isn't valid syntax.)

? MySQL rejects `SELECT dept_id, first_name, COUNT(*) FROM employees GROUP BY dept_id`. Why?
- [ ] COUNT needs a column
- [x] `first_name` is neither grouped nor aggregated (ONLY_FULL_GROUP_BY)
- [ ] You can't group by a nullable column
- [ ] GROUP BY must list every column
> Each group has many first names. Say which one you want: `MAX(first_name)`, `GROUP_CONCAT(first_name)`, or group by it as well.
:::
