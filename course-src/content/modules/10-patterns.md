---
id: patterns
title: Interview patterns
kicker: top-N · gaps & islands · pivots · division · dedupe · median
summary: The dozen shapes that most SQL interview questions reduce to, each as a template you can adapt.
clauses: SELECT, GROUP BY, WHERE
---

Most SQL interview questions reuse a small set of shapes. Recognizing the shape is half the work. Each section below gives the template, a runnable example on the sample database, and the LeetCode problems that use it.

## 1. Top N per group

*"The three highest-paid people in each department"*, *"the latest order per customer"*.

Rank inside each partition, then filter outside:

```sql run
WITH ranked AS (
  SELECT c.name, o.order_id, o.order_date,
         ROW_NUMBER() OVER (PARTITION BY o.customer_id ORDER BY o.order_date DESC) AS rn
  FROM orders o
  JOIN customers c ON c.customer_id = o.customer_id
)
SELECT name, order_id, order_date AS latest_order
FROM ranked
WHERE rn = 1
ORDER BY latest_order DESC;
```

Choose the ranking function by how ties should behave: `ROW_NUMBER` gives exactly N rows, `RANK` includes ties but skips numbers, and `DENSE_RANK` gives the top N *distinct values* (#185). Practice: [[p:185]], [[p:184]], [[p:1070]].

## 2. N-th highest value

"Second highest salary", "N-th highest". Three interchangeable templates, all returning NULL when there isn't one:

```sql
SELECT (SELECT DISTINCT salary FROM t ORDER BY salary DESC LIMIT 1 OFFSET 1);          -- scalar-subquery wrap
SELECT MAX(salary) FROM t WHERE salary < (SELECT MAX(salary) FROM t);                -- max below the max
SELECT MAX(salary) FROM (SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) r FROM t) x WHERE r = 2;
```

Practice: [[p:176]], [[p:177]].

## 3. First event per entity

"First login", "first order", "the product's first year". Find the minimum per entity, then join or filter back to get the rest of that row:

```sql run
SELECT c.name, o.order_id, o.order_date AS first_order, o.status
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
WHERE (o.customer_id, o.order_date) IN (SELECT customer_id, MIN(order_date)
                                        FROM orders GROUP BY customer_id)
ORDER BY first_order;
```

The follow-up is usually **retention**: did they come back the next day, or within 30 days? Join the first event to later events with a date condition. Practice: [[p:511]], [[p:550]], [[p:1174]].

## 4. Gaps and islands (consecutive runs)

"Three consecutive days", "longest streak", "runs of 3+ rows". The trick: within a run of consecutive values, `value − row_number` is constant. Each run (an *island*) gets its own group key:

```sql run
WITH days AS (                        -- one row per customer per day (logins can repeat)
  SELECT DISTINCT customer_id, login_date FROM logins
),
grouped AS (
  SELECT customer_id, login_date,
         DATE_SUB(login_date, INTERVAL ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date) DAY) AS island
  FROM days
)
SELECT customer_id, MIN(login_date) AS streak_start, MAX(login_date) AS streak_end, COUNT(*) AS days
FROM grouped
GROUP BY customer_id, island
HAVING COUNT(*) >= 2
ORDER BY customer_id, streak_start;
```

Consecutive dates minus 1, 2, 3, … days all land on the same date, and a gap shifts the key. Deduplicate first: customer 5 logged in twice on March 5, which would otherwise break the run. With integer ids, use `id - ROW_NUMBER() OVER (ORDER BY id)`. For short fixed runs, `LAG`/`LEAD` or a triple self-join also work. Practice: [[p:180]], [[p:601]].

:::gotcha Keep ROW_NUMBER() on the right of the minus
MySQL types `ROW_NUMBER()`, `RANK()` and `DENSE_RANK()` as BIGINT UNSIGNED. If a subtraction involving one of them goes below zero, the whole query stops with error 1690 (*BIGINT UNSIGNED value is out of range*). `id - ROW_NUMBER() …` is safe for positive ids, because the n-th smallest id is at least n. `ROW_NUMBER() … - id` fails, and so does `a.rn - b.rn` on columns that came from ROW_NUMBER. When the result can be negative, use `CAST(ROW_NUMBER() OVER (…) AS SIGNED)`.
:::

Here the row number restarts at 1 for each customer, so for customer 2 the subtraction is 1 − 2:

```sql run error
SELECT customer_id, login_date,
       ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date) - customer_id AS oops
FROM logins;
```

## 5. Running totals and thresholds

"Cumulative revenue", "the last person who fits under 1000 kg", "7-day moving average". Use `SUM(...) OVER (ORDER BY ...)` with an explicit frame when it matters, then filter the running value in an outer query. Aggregate to one row per day before applying row-based frames. Practice: [[p:1204]], [[p:1321]].

## 6. Pivot: rows to columns

"One column per month / status / store". Conditional aggregation: one `SUM(CASE …)` or `MAX(CASE …)` per output column.

```sql run
SELECT DATE_FORMAT(order_date, '%Y-%m') AS month,
       SUM(status = 'delivered') AS delivered,
       SUM(status = 'shipped')   AS shipped,
       SUM(status = 'pending')   AS pending,
       SUM(status = 'cancelled') AS cancelled
FROM orders
WHERE order_date >= '2024-10-01'
GROUP BY month
ORDER BY month;
```

SQL has to know the output columns up front. For a truly dynamic set of columns you'd generate the query text in application code (MySQL has no `PIVOT` keyword). The reverse, **unpivot**, is a `UNION ALL` per column (Module 7). Practice: [[p:1179]], [[p:1193]], [[p:1795]].

## 7. Relational division: "all of them"

"Customers who bought every product", "students who took all required courses". Count the distinct matches and compare with the total:

```sql run
-- customers who bought every Audio product
SELECT c.name
FROM customers c
JOIN orders o       ON o.customer_id = c.customer_id
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products p     ON p.product_id = oi.product_id
WHERE p.category = 'Audio'
GROUP BY c.customer_id, c.name
HAVING COUNT(DISTINCT p.product_id) = (SELECT COUNT(*) FROM products WHERE category = 'Audio');
```

`DISTINCT` matters: buying the same product twice must not count as buying two products. The textbook alternative is a double `NOT EXISTS`: "there is no product this customer did not buy". Practice: [[p:1045]].

## 8. Deduplication

"Keep one row per email", "the latest record per key". To *select* the survivors, use `ROW_NUMBER() … = 1` or `MIN(id)` per key. To *delete* the rest in MySQL, use a self-join DELETE: `DELETE p1 FROM t p1 JOIN t p2 ON p1.key = p2.key AND p1.id > p2.id` (Module 11). Practice: [[p:196]], [[p:182]].

## 9. Median

MySQL has no `MEDIAN()`. Number the rows and average the middle one or two:

```sql run
WITH ranked AS (
  SELECT dept_id, salary,
         ROW_NUMBER() OVER (PARTITION BY dept_id ORDER BY salary) AS rn,
         COUNT(*)     OVER (PARTITION BY dept_id)                 AS n
  FROM employees
  WHERE dept_id IS NOT NULL
)
SELECT dept_id, AVG(salary) AS median_salary
FROM ranked
WHERE rn IN (FLOOR((n + 1) / 2), CEIL((n + 1) / 2))
GROUP BY dept_id
ORDER BY dept_id;
```

For odd `n` both expressions point at the same middle row. For even `n` they're the two middle rows, and AVG takes their mean.

## 10. Pairs and symmetric relationships

"Who has the most friends", "mutual follows", "pairs of users who share X". Two tricks cover almost everything:

- **Stack both columns** with `UNION ALL` so each person appears once per relationship, whichever side they're on (#602).
- **Count each pair once** by requiring `a.id < b.id` in a self-join, which removes (x, y)/(y, x) duplicates and self-pairs.

```sql run
-- pairs of customers from the same city, each pair listed once
SELECT a.city, a.name AS customer_a, b.name AS customer_b
FROM customers a
JOIN customers b ON b.city = a.city AND a.customer_id < b.customer_id
ORDER BY a.city, customer_a;
```

## 11. Rates and percentages

"Cancellation rate", "confirmation rate", "percentage of users who…". `ROUND(100 * AVG(condition), 2)` over the right population. The hard part is the **denominator**:

- Which rows count? For example, only trips whose client *and* driver are unbanned (#262).
- Must entities with no activity appear as 0? Then LEFT JOIN, and use `IFNULL(AVG(…), 0)` (#1934).
- Is it per entity or overall? Is it a ratio of averages or an average of ratios (#1211)?

## 12. Fixed categories with zeros

"Report all three categories even when empty": GROUP BY can't invent rows, so build the category list yourself and LEFT JOIN (Module 7, #1907).

:::interview How to use this list
When you read a question, name the pattern out loud: "this is top-N per group", "this is gaps and islands". Then write the template's skeleton first and fill in the details. It shows structure, and it stops you from improvising a self-join maze.
:::

## Quick check

:::quiz
? "Find the longest run of consecutive login days per user." Which pattern?
- [ ] Top N per group
- [x] Gaps and islands
- [ ] Relational division
- [ ] Pivot
> Group consecutive dates with `date − ROW_NUMBER()` (after de-duplicating days), then take the largest group per user.

? "Customers who bought every product in the catalog": what goes in HAVING?
- [ ] `COUNT(*) = (SELECT COUNT(*) FROM products)`
- [x] `COUNT(DISTINCT product_id) = (SELECT COUNT(*) FROM products)`
- [ ] `MAX(product_id) = (SELECT MAX(product_id) FROM products)`
- [ ] `COUNT(product_id) > 0`
> Repeat purchases inflate `COUNT(*)`. Count distinct products.

? You need each department's top 3 *distinct* salaries, ties included. Which function?
- [ ] ROW_NUMBER
- [ ] RANK
- [x] DENSE_RANK
- [ ] NTILE(3)
> DENSE_RANK numbers distinct values 1, 2, 3 without gaps, so `<= 3` keeps every employee earning one of the top three amounts.

? Why deduplicate login days before applying `date − ROW_NUMBER()`?
- [ ] ROW_NUMBER fails on duplicates
- [x] A repeated date takes an extra row number and shifts the group key, splitting one streak in two
- [ ] DATE_SUB can't handle duplicates
- [ ] It's only for performance
> Two logins on the same day would get row numbers k and k+1 for the same date, so the island key changes mid-streak.
:::
