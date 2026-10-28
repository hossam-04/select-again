---
id: joins
title: Joins
kicker: INNER · LEFT · self · anti · semi · CROSS
summary: Combining tables without losing rows you meant to keep or duplicating rows you meant to count once — the source of most wrong answers in real reporting code.
clauses: FROM, WHERE
---

## The mental model

A join pairs rows from two tables. Conceptually, it builds every combination and keeps the pairs for which the `ON` condition is TRUE. Two questions decide every join:

1. **Which rows must survive?** Only matched pairs (INNER), or every row of one side even without a match (LEFT/RIGHT)?
2. **What is one output row now?** Joining a customer to their orders changes the grain from *customer* to *order*. Everything you aggregate afterwards counts at that new grain.

## INNER JOIN: matches only

```sql run
SELECT e.first_name, e.title, d.name AS department
FROM employees e
JOIN departments d ON d.dept_id = e.dept_id      -- JOIN means INNER JOIN
ORDER BY department, e.first_name;
```

That's 15 rows for 16 employees. Nadia, the CEO, has `dept_id = NULL`, and `NULL = anything` is never TRUE, so she has no partner and quietly disappears. That's what INNER means, and it's also how rows go missing from reports without anyone noticing.

## LEFT JOIN: keep every row on the left

```sql run
SELECT e.first_name, d.name AS department
FROM employees e
LEFT JOIN departments d ON d.dept_id = e.dept_id
WHERE e.emp_id IN (1, 2, 15);
```

A left row with no match still appears, with NULLs for the right side. The classic use is counting *including zeros*:

```sql run
SELECT d.name,
       COUNT(e.emp_id) AS headcount,      -- counts matches only
       COUNT(*)        AS rows_in_group   -- counts the NULL-padded row too
FROM departments d
LEFT JOIN employees e ON e.dept_id = d.dept_id
GROUP BY d.dept_id, d.name
ORDER BY headcount DESC, d.name;
```

Legal has no employees. It still gets a row, and `COUNT(e.emp_id)` correctly says 0, while `COUNT(*)` says 1 because the NULL-padded row is still a row.

:::key After a LEFT JOIN, count a column from the right table
`COUNT(right.id)` counts real matches. `COUNT(*)` counts rows, including the one NULL-filled row a left row gets when nothing matched.
:::

`RIGHT JOIN` is the mirror image. Nobody needs it, since you can swap the table order and write a LEFT JOIN, which reads more naturally. MySQL has **no FULL OUTER JOIN**; Module 7 shows the `UNION` emulation.

## ON vs WHERE: the bug everyone writes once

In a LEFT JOIN, a condition on the **right** table means very different things in ON and in WHERE:

- In **ON**, it restricts *which rows can match*, and unmatched left rows survive with NULLs.
- In **WHERE**, it runs *after* the join and throws away the NULL-padded rows, silently turning your LEFT JOIN into an INNER JOIN.

```sql run
-- Intended: every customer with their 2025 order count. Actual: customers without 2025 orders vanish.
SELECT c.name, COUNT(o.order_id) AS orders_2025
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_date >= '2025-01-01'
GROUP BY c.customer_id, c.name;
```

```sql run
SELECT c.name, COUNT(o.order_id) AS orders_2025
FROM customers c
LEFT JOIN orders o
       ON o.customer_id = c.customer_id
      AND o.order_date >= '2025-01-01'     -- restrict the matches, keep every customer
GROUP BY c.customer_id, c.name
ORDER BY orders_2025 DESC, c.name;
```

:::gotcha
Conditions on the **left** table of a LEFT JOIN belong in WHERE. Conditions on the **right** table almost always belong in ON. If you see `LEFT JOIN t … WHERE t.col = …`, something is probably wrong. The one exception is `WHERE t.id IS NULL`, which is the anti-join below.
:::

## Anti-join: rows with *no* match

"Customers who never ordered" means left rows whose match is missing:

```sql run
SELECT c.name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_id IS NULL;
```

Test a column that can't be NULL in a real match, like the right table's primary key. `NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)` says the same thing and is often clearer. Avoid `NOT IN (subquery)` unless the subquery column can't be NULL (Module 2).

## Semi-join: rows with *at least one* match

"Customers who bought a phone": a plain JOIN repeats each customer once per matching line.

```sql run
SELECT c.name
FROM customers c
JOIN orders o       ON o.customer_id = c.customer_id
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products p     ON p.product_id = oi.product_id
WHERE p.category = 'Phones'
ORDER BY c.name;
```

Jamal appears three times and Bilal twice. You could slap `DISTINCT` on it, but the cleaner tool is `EXISTS`, which asks the yes/no question directly and never duplicates (more in Module 6):

```sql run
SELECT c.name
FROM customers c
WHERE EXISTS (
  SELECT 1
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  JOIN products p     ON p.product_id = oi.product_id
  WHERE o.customer_id = c.customer_id
    AND p.category = 'Phones')
ORDER BY c.name;
```

## Self-join: a table meets itself

Hierarchies and "compare with another row of the same table" are self-joins. Give each copy its own alias:

```sql run
SELECT e.first_name AS employee, e.salary,
       m.first_name AS manager,  m.salary AS manager_salary
FROM employees e
LEFT JOIN employees m ON m.emp_id = e.manager_id
WHERE e.dept_id = 1
ORDER BY e.emp_id;
```

The same trick compares rows of one table: consecutive days (#197), start/end events (#1661), pairs of emails (#182).

## Fan-out: when joins multiply your totals

Join a customer to orders (one-to-many), then to order items (one-to-many again), and each order row is repeated once per item. Any COUNT or SUM taken at the wrong grain is now inflated:

```sql run
SELECT c.name,
       COUNT(*)                   AS orders_wrong,
       COUNT(DISTINCT o.order_id) AS orders,
       SUM(oi.quantity)           AS units
FROM customers c
JOIN orders o       ON o.customer_id = c.customer_id
JOIN order_items oi ON oi.order_id = o.order_id
GROUP BY c.customer_id, c.name
ORDER BY c.customer_id
LIMIT 4;
```

Alice placed 4 orders, but `COUNT(*)` counts her 5 order *lines*. `COUNT(DISTINCT o.order_id)` recovers the order count. For *sums* at the order level (say, a shipping fee stored on orders), DISTINCT won't save you. Aggregate each child table in a subquery first, then join the pre-aggregated results.

:::work The double-join report bug
"Revenue per customer" joined to both `payments` and `refunds` multiplies each payment by the number of refunds. Rule: never join two independent one-to-many children in the same query before aggregating them.
:::

## CROSS JOIN: every combination

`CROSS JOIN` has no condition. Every left row pairs with every right row. It's rarely what you want on real tables, but it's exactly right for building a **grid** that a LEFT JOIN then fills in, such as every student × every subject (#1280) or every day × every product:

```sql run
SELECT d.name, q.quarter
FROM departments d
CROSS JOIN (SELECT 1 AS quarter UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) q
WHERE d.dept_id <= 2
ORDER BY d.name, q.quarter;
```

## Other join details

- `JOIN … USING (col)` works when both sides name the key identically. The key then appears once in `SELECT *`.
- `NATURAL JOIN` joins on *all* same-named columns automatically. Avoid it, because adding a column later can silently change the join.
- A comma between tables (`FROM a, b WHERE a.x = b.x`) is an old-style inner join. It works, but explicit `JOIN … ON` keeps join logic apart from filters.
- Join conditions can be any expression: ranges (`BETWEEN p.start_date AND p.end_date`), inequalities, or `DATEDIFF(a.d, b.d) = 1`.

:::interview Say the grain out loud
Before joining, state what one row of the result will be. After joining, check that COUNT and SUM still count what you think. Interviewers love adding a second one-to-many table to see whether you notice the fan-out.
:::

## Quick check

:::quiz
? `SELECT … FROM a LEFT JOIN b ON b.a_id = a.id WHERE b.status = 'paid'`: what happens to rows of `a` with no match in `b`?
- [ ] They appear with NULLs, as usual for a LEFT JOIN
- [x] They are removed, because `NULL = 'paid'` isn't TRUE
- [ ] MySQL raises an error
- [ ] They appear only if `status` is nullable
> The WHERE runs after the join, and for NULL-padded rows the condition is UNKNOWN. Move `b.status = 'paid'` into the ON clause to keep every `a` row.

? After `departments d LEFT JOIN employees e`, which expression gives 0 for a department with no employees?
- [ ] `COUNT(*)`
- [x] `COUNT(e.emp_id)`
- [ ] `COUNT(d.dept_id)`
- [ ] `SUM(1)`
> The unmatched department still produces one row with NULL employee columns. `COUNT(*)` and `COUNT(d.dept_id)` count that row, while `COUNT(e.emp_id)` skips the NULL.

? Which query finds customers with no orders **safely** even if `orders.customer_id` contains NULLs?
- [ ] `WHERE customer_id NOT IN (SELECT customer_id FROM orders)`
- [x] `WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)`
- [ ] `JOIN orders o ON o.customer_id <> c.customer_id`
- [ ] `WHERE customer_id <> ALL (SELECT customer_id FROM orders)`
> NOT IN and `<> ALL` both return nothing when the subquery contains a NULL. NOT EXISTS only asks whether a matching row exists.

? You join customers → orders → order_items and `COUNT(*)` per customer. What are you counting?
- [ ] customers
- [ ] orders
- [x] order lines (items)
- [ ] products
> The grain after the last join is one row per order item. Use `COUNT(DISTINCT o.order_id)` for orders.
:::
