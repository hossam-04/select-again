---
id: ctes
title: CTEs and recursion
kicker: WITH · WITH RECURSIVE · series · hierarchies
summary: Naming intermediate results so complex queries read top to bottom, and recursive CTEs for date series and org charts.
clauses: FROM
---

## WITH: name your steps

A common table expression (CTE) is a named subquery declared up front. It lets a complicated query read as a sequence of steps instead of nested parentheses:

```sql run
WITH order_totals AS (          -- step 1: one row per order
  SELECT o.order_id, o.customer_id, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY o.order_id, o.customer_id
),
customer_totals AS (            -- step 2: one row per customer
  SELECT customer_id, COUNT(*) AS orders, SUM(total) AS spent
  FROM order_totals
  GROUP BY customer_id
)
SELECT c.name, ct.orders, ct.spent
FROM customer_totals ct
JOIN customers c ON c.customer_id = ct.customer_id
WHERE ct.spent > (SELECT AVG(spent) FROM customer_totals)   -- a CTE can be used twice
ORDER BY ct.spent DESC;
```

- Each CTE can refer to the ones defined **before** it.
- A CTE can be referenced several times, which a derived table can't do without copy-pasting.
- It exists only for this one statement. For something reusable across queries, use a view.

:::dialect
CTEs arrived in **MySQL 8.0**. On 5.7 you'd need derived tables. PostgreSQL may materialize or inline a CTE (you can force it with `MATERIALIZED` / `NOT MATERIALIZED`). MySQL decides on its own and may merge a CTE into the outer query just like a derived table.
:::

:::tip Grain comments
Writing a short comment after each CTE, like `-- one row per order`, costs nothing and is the fastest way to catch grain mistakes such as a fan-out (Module 5).
:::

## Recursive CTEs

A recursive CTE refers to **itself**. It has two parts joined by `UNION ALL`:

1. The **anchor** member runs once and produces the starting rows.
2. The **recursive** member runs repeatedly, each time on the rows produced by the previous round, until a round produces nothing.

The simplest case is a number series:

```sql run
WITH RECURSIVE n AS (
  SELECT 1 AS x                 -- anchor
  UNION ALL
  SELECT x + 1 FROM n           -- recursive member
  WHERE x < 10                  -- stop condition
)
SELECT x, x * x AS square FROM n;
```

### Date series: filling the gaps

Reports often need a row for **every** day, including days with no data. Generate the calendar recursively, then LEFT JOIN the facts:

```sql run
WITH RECURSIVE days AS (
  SELECT DATE('2025-03-01') AS d
  UNION ALL
  SELECT d + INTERVAL 1 DAY FROM days WHERE d < '2025-03-12'
)
SELECT days.d, COUNT(DISTINCT l.customer_id) AS active_customers
FROM days
LEFT JOIN logins l ON l.login_date = days.d
GROUP BY days.d
ORDER BY days.d;
```

Nobody logged in on March 10–12, yet those days appear with 0. A plain `GROUP BY login_date` can never produce them, because it only groups rows that exist.

### Walking a hierarchy

Org charts, category trees and bills of materials are stored as a parent pointer (`manager_id`). A recursive CTE walks down the tree one level per round:

```sql run
WITH RECURSIVE chain AS (
  SELECT emp_id, first_name, 1 AS depth,
         CAST(first_name AS CHAR(200)) AS path          -- widen the column in the anchor
  FROM employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.emp_id, e.first_name, c.depth + 1,
         CONCAT(c.path, ' > ', e.first_name)
  FROM employees e
  JOIN chain c ON e.manager_id = c.emp_id
)
SELECT depth, first_name, path
FROM chain
ORDER BY path;
```

Start from any node instead of the root to get a whole subtree, for example everyone under Omar and their combined payroll:

```sql run
WITH RECURSIVE team AS (
  SELECT emp_id, first_name, salary FROM employees WHERE emp_id = 2
  UNION ALL
  SELECT e.emp_id, e.first_name, e.salary
  FROM employees e
  JOIN team t ON e.manager_id = t.emp_id
)
SELECT COUNT(*) - 1 AS people_under_omar,
       SUM(salary)  AS payroll_including_omar
FROM team;
```

:::gotcha The anchor decides the column types (MySQL)
In MySQL, a recursive CTE's column types come from the anchor member. If the anchor's `path` is a short string, longer values built in later rounds fail with *Data too long* (or get truncated). That's why the anchor above uses `CAST(first_name AS CHAR(200))`. The same goes for numbers: an anchor of `1` is an INT.
:::

:::gotcha Recursion depth
MySQL stops a recursive CTE after **1000** rounds by default (`cte_max_recursion_depth`), which bites when generating long date ranges. Raise it per session, `SET SESSION cte_max_recursion_depth = 5000;`, and always include a stop condition. Cyclic data (A manages B manages A) recurses forever unless you track the depth or path.
:::

## Pairs: every ancestor with every descendant

For "total team size" or "total budget under each manager", generate every (manager, member) pair recursively, then aggregate once. #3482 is built this way:

```sql run
WITH RECURSIVE pairs AS (
  SELECT emp_id AS root_id, emp_id AS member_id, salary FROM employees   -- everyone is in their own subtree
  UNION ALL
  SELECT p.root_id, e.emp_id, e.salary
  FROM pairs p
  JOIN employees e ON e.manager_id = p.member_id
)
SELECT root_id, COUNT(*) - 1 AS team_size, SUM(salary) AS budget
FROM pairs
GROUP BY root_id
HAVING team_size > 0
ORDER BY budget DESC;
```

:::interview When interviewers ask for recursion
"Find all reports (direct and indirect)", "generate missing dates", "compute each node's level": these are the recursive-CTE signals. State the anchor, the recursive step and the stop condition out loud before writing any SQL.
:::

## Quick check

:::quiz
? In a recursive CTE, how many times does the anchor member run?
- [x] Once
- [ ] Once per recursion round
- [ ] Until it returns no rows
- [ ] Once per output row
> The anchor seeds the recursion. The recursive member then runs round after round on the previous round's rows.

? When does recursion stop?
- [ ] After exactly 1000 rounds
- [x] When a round produces no new rows (or the depth limit is hit)
- [ ] When the anchor returns NULL
- [ ] When UNION ALL finds a duplicate
> A WHERE in the recursive member eventually filters everything out. MySQL's `cte_max_recursion_depth` (default 1000) is a safety net that raises an error.

? Your recursive `path` column errors with "Data too long" in MySQL. The fix?
- [ ] Use UNION instead of UNION ALL
- [x] Cast the anchor's value to a wide type, e.g. `CAST(name AS CHAR(500))`
- [ ] Add ORDER BY inside the CTE
- [ ] Use a derived table
> Column types are fixed by the anchor member, so widen them there.

? Which feature needs at least MySQL 8.0?
- [ ] Derived tables
- [ ] Correlated subqueries
- [x] WITH (CTEs)
- [ ] UNION ALL
> CTEs and window functions both arrived in 8.0. LeetCode runs MySQL 8.
:::
