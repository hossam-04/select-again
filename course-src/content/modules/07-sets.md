---
id: sets
title: Set operations
kicker: UNION · UNION ALL · INTERSECT · EXCEPT
summary: Stacking results vertically — combining lists, unpivoting columns into rows, emulating FULL OUTER JOIN, and making zero-count rows appear.
clauses: SELECT
---

## Stacking results

Joins put tables side by side. Set operations stack **results** on top of each other. The rules:

- Every SELECT must return the **same number of columns**, and they're matched by **position**, not by name.
- The result's column names come from the **first** SELECT.
- `UNION` removes duplicate rows from the combined result. `UNION ALL` keeps everything.

```sql run
SELECT 'employee' AS kind, email FROM employees WHERE email LIKE '%acme.test'
UNION ALL
SELECT 'customer', email FROM customers WHERE email IS NOT NULL
ORDER BY kind, email
LIMIT 6;
```

`ORDER BY` and `LIMIT` at the end apply to the **whole** combined result, and they can only use the output column names (or positions).

:::key Default to UNION ALL
`UNION` has to sort or hash the whole result to find duplicates. When the branches can't overlap, or you *want* the duplicates, `UNION ALL` is correct and cheaper. Reach for `UNION` only when removing duplicates is the point.
:::

```sql run
SELECT country FROM customers WHERE city = 'Cairo'
UNION
SELECT country FROM customers WHERE city = 'Alexandria';
```

With `UNION ALL` that would be three rows of "Egypt".

## Sorting or limiting one branch

To apply `ORDER BY … LIMIT` to a single branch, wrap that branch in parentheses. MySQL supports this, and LeetCode's #1341 is built around it:

```sql run
(SELECT name, price FROM products ORDER BY price DESC LIMIT 1)
UNION ALL
(SELECT name, price FROM products ORDER BY price ASC LIMIT 1);
```

## INTERSECT and EXCEPT

`INTERSECT` keeps rows present in both results, and `EXCEPT` keeps rows in the first that aren't in the second. Both remove duplicates.

```sql run
-- cities where we have both an office and customers
SELECT location FROM departments WHERE location IS NOT NULL
INTERSECT
SELECT city FROM customers;
```

```sql run
-- office cities with no customers
SELECT location FROM departments WHERE location IS NOT NULL
EXCEPT
SELECT city FROM customers;
```

:::dialect Version check
MySQL only added `INTERSECT` and `EXCEPT` in **8.0.31** (late 2022). On older servers, and whenever you're unsure which version a judge runs, write them as `IN` / `EXISTS` (intersection) and `NOT EXISTS` (difference). PostgreSQL and SQL Server have had both for decades. Oracle calls `EXCEPT` `MINUS`.
:::

## Emulating FULL OUTER JOIN

MySQL has no `FULL OUTER JOIN`. Build one from a LEFT JOIN plus the rows only the right side has:

```sql run
SELECT d.name AS department, e.first_name
FROM departments d
LEFT JOIN employees e ON e.dept_id = d.dept_id
UNION ALL
SELECT NULL, e.first_name
FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.dept_id = e.dept_id)
ORDER BY department, first_name;
```

The first branch covers every department, including Legal, which has no employees. The second adds employees with no department, which here is only the CEO. Using `UNION ALL` plus an anti-join avoids the accidental de-duplication that `LEFT JOIN … UNION … RIGHT JOIN` performs.

## Turning columns into rows (unpivot)

When a table has one column per category (`q1`, `q2`, `q3` …), a `UNION ALL` of one SELECT per column turns it into one row per (item, category), which is the shape SQL likes to aggregate:

```sql run
SELECT 'with email' AS metric, COUNT(email) AS n FROM customers
UNION ALL
SELECT 'with city', COUNT(city) FROM customers
UNION ALL
SELECT 'referred', COUNT(referred_by) FROM customers;
```

(#1795 is exactly this. Module 10 covers the reverse, pivoting rows into columns.)

## Rows that must exist even at zero

GROUP BY only produces groups that exist in the data. If a report must always list every category, even ones with no rows, build the category list yourself with `UNION ALL`, then LEFT JOIN the counts onto it:

```sql run
SELECT s.status, COUNT(o.order_id) AS orders
FROM (SELECT 'pending' AS status UNION ALL SELECT 'shipped'
      UNION ALL SELECT 'delivered' UNION ALL SELECT 'cancelled'
      UNION ALL SELECT 'returned') s
LEFT JOIN orders o ON o.status = s.status
GROUP BY s.status
ORDER BY orders DESC;
```

"returned" isn't a status any order has, yet it shows up with 0. That's the pattern behind #1907.

:::gotcha UNION when you meant UNION ALL
Stacking two answers into one column, like "top user" and "top movie" (#1341), with `UNION` silently collapses them into one row when both happen to be the same string. If each branch contributes its own row, use `UNION ALL`.
:::

## Quick check

:::quiz
? `SELECT a FROM t1 UNION SELECT b FROM t2`: what is the result's column called?
- [x] `a`
- [ ] `b`
- [ ] `a_b`
- [ ] It's an error unless both are named the same
> Column names come from the first SELECT. Columns are matched by position.

? Where does `ORDER BY price` go to sort the combined result of two SELECTs?
- [ ] After each SELECT
- [x] Once, at the very end
- [ ] Before the first SELECT
- [ ] Set operations can't be sorted
> A trailing ORDER BY applies to the whole union. To sort a single branch (usually together with LIMIT), wrap that branch in parentheses.

? Why prefer `UNION ALL` over `UNION` when the branches can't overlap?
- [ ] UNION ALL keeps NULLs; UNION drops them
- [x] UNION must de-duplicate the whole result, which costs a sort or hash
- [ ] UNION changes column order
- [ ] There is no difference
> Same rows, less work. And when duplicates are meaningful, UNION ALL is the only correct choice.

? MySQL has no FULL OUTER JOIN. Which construction replaces `a FULL JOIN b ON …`?
- [ ] `a CROSS JOIN b`
- [ ] `a LEFT JOIN b … INTERSECT a RIGHT JOIN b …`
- [x] `a LEFT JOIN b …` combined with the `b` rows that have no match in `a`
- [ ] `a JOIN b … UNION ALL a JOIN b …`
> Take all of `a` with its matches, then append the `b` rows nothing matched, using UNION ALL plus an anti-join (or `LEFT … UNION … RIGHT`).
:::
