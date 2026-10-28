---
id: playbook
title: Interview playbook
kicker: routine · edge cases · error codes · dialects · mock sets
summary: A repeatable routine for SQL interview questions, the edge-case checklist that catches most wrong answers, MySQL errors decoded, and three timed practice sets.
---

## A six-step routine

1. **Restate the output.** Exact column names and order, what one row represents (the *grain*), and any required sort. Write the final SELECT list first.
2. **Interrogate the edge cases.** NULLs? Duplicates? Ties? Empty input? Inclusive or exclusive boundaries? Rounding? Ask, or state your assumption out loud.
3. **Sketch the flow.** Which tables, which join types (does every row on one side have to survive?), which filters, what gets aggregated, and at what grain.
4. **Build in named steps.** One CTE per idea, each with a comment saying its grain. It's easier to write, to debug and to explain.
5. **Test by hand.** Walk the sample rows through each step, then one edge case such as an empty group or a tie.
6. **Polish.** Simplify, then mention indexes or complexity if there's time. Interviewers remember a clear explanation more than a clever trick.

A worked example on the sample shop: *"For each country, the customer who spent the most in 2024 (ties included), with their share of the country's 2024 revenue."*

```sql run
WITH spend AS (                    -- one row per customer: 2024 revenue, cancelled orders excluded
  SELECT c.customer_id, c.name, c.country,
         SUM(oi.quantity * oi.unit_price) AS spent
  FROM customers c
  JOIN orders o       ON o.customer_id = c.customer_id
                     AND o.status <> 'cancelled'
                     AND o.order_date >= '2024-01-01' AND o.order_date < '2025-01-01'
  JOIN order_items oi ON oi.order_id = o.order_id
  GROUP BY c.customer_id, c.name, c.country
),
ranked AS (                        -- add per-country rank and total
  SELECT s.*,
         RANK() OVER (PARTITION BY country ORDER BY spent DESC) AS rnk,
         SUM(spent) OVER (PARTITION BY country)                 AS country_total
  FROM spend s
)
SELECT country, name, spent,
       ROUND(100 * spent / country_total, 1) AS pct_of_country
FROM ranked
WHERE rnk = 1
ORDER BY spent DESC;
```

## The edge-case checklist

| Check | What goes wrong | Fix |
|---|---|---|
| NULLs in filters | `x <> 5` and `NOT IN (…)` silently drop or kill rows | `IS NULL` branches, `<=>`, `NOT EXISTS` |
| NULLs in results | Sums over nothing are NULL, not 0 | `IFNULL(SUM(x), 0)`, `COUNT(col)` after LEFT JOIN |
| Duplicates | Double counting, repeated names | `DISTINCT`, `COUNT(DISTINCT …)`, group by id |
| Ties | "Top 1" returns one of several | `RANK`/`DENSE_RANK`, or an explicit tie-breaker |
| Empty input | Query returns *no row* when one row with NULL is required | Scalar-subquery wrap or an aggregate |
| Boundaries | `>` vs `>=`, BETWEEN on DATETIME, leap days | Half-open ranges: `>= start AND < next_start` |
| Division and rounding | Integer division (PostgreSQL), rounding too early | `100.0 * a / b`, round once at the end |
| Grain after joins | Fan-out inflates SUM and COUNT | Aggregate before joining, `COUNT(DISTINCT id)` |
| Output format | Wrong column names or order | Alias exactly, and backtick names with spaces or reserved words |
| Ordering | Right rows, wrong order | ORDER BY with every tie-breaker the question states |

## Phrase → technique

| When the question says… | Reach for |
|---|---|
| "for each X, the top/first/latest N" | window rank in a subquery, filter `rn <= N` |
| "consecutive", "in a row", "streak" | `LAG`/`LEAD`, self-join on id + 1, or gaps and islands |
| "the first time", "initial" | `MIN(date)` per entity + join back, or `ROW_NUMBER() = 1` |
| "never", "without any" | anti-join (`LEFT JOIN … IS NULL` / `NOT EXISTS`) |
| "at least one" | `EXISTS` / semi-join |
| "all of", "every" | relational division: `COUNT(DISTINCT) = total` |
| "percentage", "rate", "ratio" | `ROUND(100 * AVG(condition), 2)` over the right denominator |
| "running", "cumulative", "so far" | `SUM(...) OVER (ORDER BY ...)` |
| "moving average", "last 7 days" | window frame `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW`, or a range self-join |
| "include days/categories with none" | calendar or category list + LEFT JOIN |
| "one column per month/status" | conditional aggregation (pivot) |
| "compare with the previous/next" | `LAG` / `LEAD` |
| "hierarchy", "all reports", "level" | recursive CTE |
| "N-th highest" | `DENSE_RANK`, or `DISTINCT … LIMIT 1 OFFSET N-1` |
| "delete duplicates", "swap values" | self-join DELETE, `UPDATE … CASE` |

## MySQL errors, decoded

| Error | Message (short) | Usual cause |
|---|---|---|
| 1054 | Unknown column 'x' in 'where clause' | A SELECT alias used in WHERE, or a typo |
| 1055 | … isn't in GROUP BY (ONLY_FULL_GROUP_BY) | Selected a column that's neither grouped nor aggregated |
| 1064 | You have an error in your SQL syntax | Missing comma, reserved word such as `rank` used as a name, PostgreSQL syntax |
| 1093 | You can't specify target table … for update | DELETE/UPDATE subquery reads the same table: wrap it in a derived table |
| 1111 | Invalid use of group function | An aggregate in WHERE: move it to HAVING |
| 1235 | This version doesn't yet support 'LIMIT & IN … subquery' | Wrap the LIMIT subquery in a derived table |
| 1242 | Subquery returns more than 1 row | A scalar subquery isn't scalar: add a condition, an aggregate or LIMIT 1 |
| 1248 | Every derived table must have its own alias | `FROM (SELECT …) AS t` |

## MySQL ↔ PostgreSQL ↔ SQL Server

| Task | MySQL | PostgreSQL | SQL Server |
|---|---|---|---|
| First n rows | `LIMIT n OFFSET m` | same, or `FETCH FIRST n ROWS ONLY` | `TOP n` / `OFFSET m ROWS FETCH NEXT n ROWS ONLY` |
| Quote identifiers | `` `name` `` | `"name"` | `[name]` |
| Concatenate | `CONCAT(a, b)` | `a \|\| b` | `a + b` / `CONCAT` |
| NULL fallback | `IFNULL(a, b)` | `COALESCE(a, b)` | `ISNULL(a, b)` |
| Add days | `DATE_ADD(d, INTERVAL 7 DAY)` | `d + INTERVAL '7 days'` | `DATEADD(day, 7, d)` |
| Day difference | `DATEDIFF(later, earlier)` | `later - earlier` | `DATEDIFF(day, earlier, later)` |
| Format date | `DATE_FORMAT(d, '%Y-%m')` | `to_char(d, 'YYYY-MM')` | `FORMAT(d, 'yyyy-MM')` |
| Truncate to month | `DATE_FORMAT(d, '%Y-%m-01')` | `date_trunc('month', d)` | `DATETRUNC(month, d)` (2022) |
| String aggregate | `GROUP_CONCAT(x ORDER BY x SEPARATOR ',')` | `string_agg(x, ',' ORDER BY x)` | `STRING_AGG(x, ',') WITHIN GROUP (ORDER BY x)` |
| `7 / 2` | 3.5000 | 3 | 3 |
| Boolean in SUM | `SUM(cond)` | `SUM(cond::int)` / `COUNT(*) FILTER (WHERE cond)` | `SUM(CASE WHEN cond THEN 1 ELSE 0 END)` |
| Upsert | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT … DO UPDATE` | `MERGE` |
| Auto id | `AUTO_INCREMENT` | `GENERATED … AS IDENTITY` / `SERIAL` | `IDENTITY(1,1)` |
| Regex match | `REGEXP` / `REGEXP_LIKE` | `~` / `~*` | not built in (LIKE patterns) |

## Timed practice sets

Do each set in one sitting, without hints, against the clock. Then read every solution, including the alternatives. That second reading is where most of the learning happens.

**Set A: warm-up, 25 minutes.** [[p:1757]], [[p:584]], [[p:1378]], [[p:1581]], [[p:1729]]

**Set B: core interview level, 45 minutes.** [[p:1934]], [[p:550]], [[p:1164]], [[p:1907]], [[p:602]]

**Set C: hard, 60 minutes.** [[p:185]], [[p:262]], [[p:601]], [[p:1321]], [[p:3482]]

:::interview Say it while you type
Silence reads as being stuck. Narrate the routine as you go: "one row per customer, so I'll group by customer id; revenue could double-count if I join items before orders are filtered, so…". Even a half-finished query with clear reasoning often passes.
:::

## Quick check

:::quiz
? The question asks for "each department's highest earners, including ties". Which is safest?
- [ ] `ORDER BY salary DESC LIMIT 1` per department
- [ ] `ROW_NUMBER() … = 1`
- [x] `RANK()` or `DENSE_RANK() … = 1` in a subquery
- [ ] `MAX(salary)` with the name in GROUP BY
> Only the rank functions keep every tied top earner. ROW_NUMBER picks one arbitrarily.

? MySQL says "Invalid use of group function" (1111). You most likely…
- [ ] forgot an alias
- [x] used an aggregate like COUNT() in WHERE
- [ ] used LIMIT in a subquery
- [ ] quoted a column with double quotes
> Aggregates belong in SELECT or HAVING, never in WHERE.

? A result should list every month, even months with no sales. The shape is…
- [ ] GROUP BY month with HAVING COUNT(*) >= 0
- [x] a generated calendar (recursive CTE or list) LEFT JOINed to the sales
- [ ] ORDER BY month with NULLS FIRST
- [ ] UNION of the sales with itself
> GROUP BY can't create groups that have no rows, so the list of months must come from somewhere else.
:::
