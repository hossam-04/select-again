---
id: subqueries
title: Subqueries and EXISTS
kicker: scalar · correlated · IN · EXISTS · ANY/ALL · derived tables
summary: Queries inside queries — comparing against an aggregate, asking "is there a matching row?", and building an intermediate table you then query.
clauses: WHERE, FROM, SELECT
---

## Where a subquery can go

A subquery is a SELECT in parentheses. What it may return depends on where it sits:

| Position | Must return | Example |
|---|---|---|
| Scalar (in SELECT, WHERE, HAVING) | one value (1 column, at most 1 row) | `salary > (SELECT AVG(salary) FROM employees)` |
| After `IN` / `NOT IN` | one column, any rows | `dept_id IN (SELECT dept_id FROM departments WHERE location = 'Cairo')` |
| After `EXISTS` | anything (only "any rows?" matters) | `EXISTS (SELECT 1 FROM orders o WHERE …)` |
| In FROM (a *derived table*) | a table, **with an alias** | `FROM (SELECT …) AS t` |

## Scalar subqueries

A scalar subquery stands in for a single value, typically an aggregate you want to compare against:

```sql run
SELECT first_name, salary,
       (SELECT ROUND(AVG(salary)) FROM employees) AS company_avg
FROM employees
WHERE salary > (SELECT AVG(salary) FROM employees)
ORDER BY salary DESC;
```

Two facts make scalar subqueries powerful:

- If the subquery returns **no rows**, its value is **NULL** rather than an error. That's how "return NULL if there is no second-highest salary" is done (#176).
- If it returns **more than one row**, MySQL raises *Subquery returns more than 1 row* (error 1242).

:::gotcha
This page's engine (SQLite) quietly uses the first row when a scalar subquery returns several, instead of raising MySQL's error 1242. If a Check fails with a surprising value, make sure your scalar subquery really returns at most one row: add the right condition, an aggregate, or `LIMIT 1`.
:::

## Correlated subqueries

A *correlated* subquery refers to the outer row, so it's logically re-evaluated for each row. "Employees paid above **their own department's** average":

```sql run
SELECT e.first_name, e.dept_id, e.salary
FROM employees e
WHERE e.salary > (SELECT AVG(x.salary)
                  FROM employees x
                  WHERE x.dept_id = e.dept_id)   -- ties the subquery to the outer row
ORDER BY e.dept_id, e.salary DESC;
```

The same shape in SELECT computes a per-row lookup:

```sql run
SELECT c.name,
       (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.customer_id) AS orders
FROM customers c
ORDER BY orders DESC, c.name
LIMIT 5;
```

:::work
The optimizer often rewrites correlated subqueries into joins, but not always. On big tables, check the plan (Module 13). A join to a pre-aggregated derived table, or a window function, is frequently the faster formulation of the same question.
:::

## IN with a subquery, including tuples

`IN (subquery)` tests membership. MySQL also supports **row constructors**, so you can match on several columns at once. That gives a compact way to write "rows that equal their group's maximum":

```sql run
SELECT first_name, dept_id, salary
FROM employees
WHERE (dept_id, salary) IN (SELECT dept_id, MAX(salary)
                            FROM employees
                            GROUP BY dept_id)
ORDER BY dept_id;
```

This returns the top earner per department, including ties if there are any. The CEO's group has `dept_id = NULL`, and since `NULL = NULL` is not TRUE, she never matches. Remember that when a NULL group matters.

## EXISTS and NOT EXISTS

`EXISTS (subquery)` is TRUE as soon as the subquery produces one row. The select list is irrelevant, so write `SELECT 1`. It's the cleanest way to express semi-joins (at least one match) and anti-joins (no match):

```sql run
SELECT p.name, p.category
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.product_id);
```

:::key Prefer NOT EXISTS over NOT IN
`NOT IN (subquery)` returns nothing if the subquery yields a single NULL (Module 2). `NOT EXISTS` has no such trap, and it states the intent exactly: "there is no row such that…".
:::

## ANY and ALL

`x > ALL (subquery)` means greater than every value, and `x > ANY (subquery)` means greater than at least one. `= ANY` is the same as `IN`, and `<> ALL` is the same as `NOT IN`, with the same NULL trap.

```sql run
SELECT name, price
FROM products
WHERE price > ALL (SELECT price FROM products WHERE category = 'Accessories')
ORDER BY price;
```

## Derived tables: query a query

A subquery in FROM is a temporary table for the duration of the query. It's the standard way to **aggregate first, then filter, join or aggregate again**:

```sql run
SELECT d.name, t.headcount, t.avg_salary
FROM (SELECT dept_id, COUNT(*) AS headcount, ROUND(AVG(salary)) AS avg_salary
      FROM employees
      GROUP BY dept_id) AS t
JOIN departments d ON d.dept_id = t.dept_id
ORDER BY t.avg_salary DESC;
```

MySQL insists every derived table has an alias (error 1248: *Every derived table must have its own alias*). Module 8's CTEs are the same idea with a name up front, and they read better once there are several steps.

## "Return NULL when there's nothing"

LeetCode loves this requirement. A query that finds nothing returns an **empty result**, not a row containing NULL. Two ways to always get one row:

```sql run
SELECT
  (SELECT DISTINCT salary FROM employees
   ORDER BY salary DESC LIMIT 1 OFFSET 20)          AS twenty_first_highest,  -- scalar subquery: NULL
  (SELECT MAX(price) FROM products WHERE category = 'Toys') AS max_toy_price;   -- aggregate over nothing: NULL
```

1. Wrap the query in a **scalar subquery** in the SELECT list.
2. Use an **aggregate without GROUP BY** (`MAX`, `SUM`, …), which returns one row even over zero input rows.

## Which tool when?

- **Filter by an aggregate of the whole table**: scalar subquery.
- **Filter by an aggregate of "my group"**: correlated subquery, a join to a derived table, or a window function (Module 9).
- **Rows with / without a related row**: `EXISTS` / `NOT EXISTS`.
- **Several steps of aggregation**: a derived table or CTE.
- **Need columns from both sides**: a join.

:::dialect
Everything here is standard SQL and works in PostgreSQL and SQL Server. Two MySQL-specific limits: no `LIMIT` directly inside `IN (subquery)` (error 1235, so wrap it in a derived table), and a DELETE/UPDATE can't select from its own target table in a subquery (error 1093, see Module 11).
:::

## Quick check

:::quiz
? What does `SELECT (SELECT name FROM products WHERE price > 5000) AS x` return when no product costs over 5000?
- [ ] An empty result
- [x] One row with x = NULL
- [ ] An error
- [ ] One row with x = ''
> A scalar subquery with no rows evaluates to NULL, and the outer SELECT (which has no FROM) always produces one row.

? `WHERE (dept_id, salary) IN (SELECT dept_id, MAX(salary) FROM employees GROUP BY dept_id)` returns…
- [ ] exactly one employee per department
- [x] every employee whose salary equals their department's maximum, including ties
- [ ] an error: IN takes one column
- [ ] all employees
> Row constructors compare both columns. Two people sharing the top salary both match.

? Which is TRUE about `EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)`?
- [ ] It fails if `orders` contains NULL customer ids
- [ ] `SELECT 1` means it only checks the first order
- [x] It's TRUE when at least one matching order exists; the select list is ignored
- [ ] It returns the number of orders
> EXISTS only cares whether any row comes back. `SELECT 1` is a convention: `SELECT *` or `SELECT NULL` behave the same.

? MySQL error 1248 "Every derived table must have its own alias" means…
- [x] a subquery in FROM needs a name: `FROM (SELECT …) AS t`
- [ ] every column needs an alias
- [ ] you can't join a subquery
- [ ] you used the same alias twice
> Derived tables must be named. PostgreSQL requires it too (optional since version 16).
:::
