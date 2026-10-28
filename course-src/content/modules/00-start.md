---
id: start
title: Start here
kicker: how this works · the sample shop · warm-up quiz
summary: How the course is put together, the database every lesson runs on, and a 12-question warm-up that shows where you're rusty.
---

## How this course works

You already know SQL. The goal is to get it **back into your fingers**, so every page asks you to do something:

- **Runnable examples.** Each grey code box has a **Run** button, and **Edit** (or a double-click) turns it into an editor. Change the query and run it again. Every run starts from a fresh copy of the data, so you can't break anything. **Reset** restores the original.
- **Quick checks.** A few questions at the end of each module. Answer before reading the explanation.
- **LeetCode problems.** Each module ends with the problems that practice it. Every problem page has the tables, an editor, **Run** (your result on the example data) and **Check** (the example data plus hidden edge cases). There are hints that open one at a time, solutions with alternatives, and a list of *common wrong answers* you can run to see exactly how they fail.
- **Progress.** Solved problems, finished modules and your drafts are saved in this browser.

Keyboard: <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> runs the editor. On problem pages, add <kbd>Shift</kbd> to check.

:::tip A good order
Take the warm-up quiz at the bottom of this page first. Skim the modules where you answered confidently, slow down where you didn't, and do the problems as you finish each module. The **Cheat sheet** (top bar) is for review.
:::

## The sample shop

Every lesson example runs on the same small database: an electronics company and its online shop. It's small enough to see whole results and seeded with the awkward cases real data has.

| Table | Rows | What's in it | Keys |
|---|---|---|---|
| `departments` | 5 | Departments. **Legal has no staff** | `dept_id` |
| `employees` | 16 | Staff with salaries. The **CEO has no department**, there are **salary ties**, and one email is NULL | `emp_id`; `dept_id` → departments; `manager_id` → employees |
| `customers` | 12 | Shop customers. **Two never ordered**, and some have no city or email | `customer_id`; `referred_by` → customers |
| `products` | 11 | Catalog. **The Smart Watch never sold** | `product_id` |
| `orders` | 24 | Orders from Jan 2024 to Mar 2025, with a status | `order_id`; `customer_id` → customers |
| `order_items` | 38 | Order lines with the **price paid at the time** | (`order_id`, `product_id`) |
| `logins` | 19 | Customer logins in March 2025, **including a duplicate** | `customer_id` → customers |

```sql run
SELECT 'departments' AS table_name, COUNT(*) AS n_rows FROM departments
UNION ALL SELECT 'employees',   COUNT(*) FROM employees
UNION ALL SELECT 'customers',   COUNT(*) FROM customers
UNION ALL SELECT 'products',    COUNT(*) FROM products
UNION ALL SELECT 'orders',      COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'logins',      COUNT(*) FROM logins;
```

You can explore it freely in the **Playground** (top bar), which also lists every table and column.

## The engine, and how it differs from MySQL

The page runs **SQLite** compiled to JavaScript, plus a translation layer that accepts **MySQL 8 syntax**: `IF`, `IFNULL`, `DATE_ADD(… INTERVAL …)`, `DATEDIFF`, `DATE_FORMAT`, `TIMESTAMPDIFF`, `GROUP_CONCAT(… SEPARATOR …)`, `REGEXP` and `REGEXP_LIKE`, `CONCAT` with NULL semantics, decimal `/` and `DIV`, `LEFT`/`RIGHT`, `SUBSTRING_INDEX`, multi-table `DELETE`/`UPDATE`, `ON DUPLICATE KEY UPDATE`, `SHOW TABLES`, `DESCRIBE` and more. Text columns compare case-insensitively like MySQL's default collation. It also **warns you** when MySQL would reject a query that happens to run here: ONLY_FULL_GROUP_BY, aliases in WHERE, error 1093, FULL OUTER JOIN, `||`, reserved words like `rank`, and SQLite-only functions.

The remaining differences are small but worth knowing:

- A scalar subquery that returns several rows makes MySQL fail (error 1242). Here it silently uses the first row.
- MySQL keeps 4 extra decimal digits after each division before later arithmetic. This page keeps full precision, so a final `ROUND` can differ in rare exact-half cases.
- DECIMAL values show without trailing zeros (`2.5`, not `2.50`). They compare equal either way.
- Case-insensitive comparison applies to text **columns**. Text computed by a function (`LEFT(name, 1) = 'm'`) compares case-sensitively here.
- Comparing a DATETIME with a date-only string at exactly midnight differs (`'2024-01-31 00:00:00' <= '2024-01-31'` is false here, true in MySQL). Half-open ranges avoid the issue entirely, and that's the habit the course teaches anyway.
- `UPDATE t SET a = b, b = a` swaps the values here. MySQL applies single-table assignments left to right, so it doesn't swap.
- Not supported: user variables (`@x`), stored procedures (functions work only in #177), `WITH ROLLUP`, `XOR`, `LATERAL`, full-text search.
- `EXPLAIN` shows SQLite's plan (`SCAN` / `SEARCH … USING INDEX`) rather than MySQL's table. Module 13 explains both.

When you submit on LeetCode, you're running real MySQL 8.

## Warm-up quiz

Answer quickly and honestly. Each explanation points to the module that covers the idea.

:::quiz
? Which clause is evaluated first?
- [ ] SELECT
- [x] WHERE
- [ ] ORDER BY
- [ ] They run in the order written
> FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT. That's why WHERE can't use SELECT aliases. Review: [[m:basics|Query basics]].

? `t(x)` holds 1, 5 and NULL. How many rows does `WHERE x <> 5` return?
- [x] 1
- [ ] 2
- [ ] 3
- [ ] 0
> `NULL <> 5` is UNKNOWN, and WHERE keeps only TRUE. Review: [[m:filtering|Filtering and NULL]].

? `COUNT(*)` vs `COUNT(email)` when some emails are NULL?
- [ ] Always equal
- [x] `COUNT(email)` is smaller: it skips NULLs
- [ ] `COUNT(*)` skips NULL rows
- [ ] `COUNT(email)` errors on NULLs
> Aggregates skip NULLs, but `COUNT(*)` counts rows. Review: [[m:aggregation|Aggregation]].

? Where does a condition on `COUNT(*)` go?
- [ ] WHERE
- [x] HAVING
- [ ] ON
- [ ] ORDER BY
> WHERE runs before groups exist. HAVING filters groups. Review: [[m:aggregation|Aggregation]].

? `customers c LEFT JOIN orders o ON … WHERE o.status = 'paid'` keeps customers without orders?
- [ ] Yes, that's what LEFT JOIN does
- [x] No: the WHERE on the right table removes the NULL-padded rows
- [ ] Only if status is nullable
- [ ] Only with RIGHT JOIN
> Move the condition into ON to keep every customer. Review: [[m:joins|Joins]].

? `WHERE id NOT IN (SELECT manager_id FROM employees)` returns nothing. Most likely cause?
- [ ] NOT IN doesn't work with subqueries
- [x] `manager_id` contains a NULL
- [ ] The subquery needs DISTINCT
- [ ] id must be indexed
> One NULL makes every `id <> NULL` UNKNOWN. Use NOT EXISTS. Review: [[m:subqueries|Subqueries]].

? UNION vs UNION ALL?
- [ ] UNION ALL removes duplicates
- [x] UNION removes duplicates; UNION ALL keeps every row and is cheaper
- [ ] They're identical in MySQL
- [ ] UNION needs the same column names
> Review: [[m:sets|Set operations]].

? A recursive CTE consists of…
- [ ] one SELECT that calls itself in WHERE
- [x] an anchor SELECT, UNION ALL, and a recursive SELECT that references the CTE
- [ ] a stored procedure with a loop
- [ ] a view that references itself
> Review: [[m:ctes|CTEs and recursion]].

? Salaries 90, 80, 80, 70. `RANK()` vs `DENSE_RANK()` for 70 (descending)?
- [ ] 3 and 3
- [x] 4 and 3
- [ ] 3 and 4
- [ ] 4 and 4
> RANK skips after ties, DENSE_RANK doesn't. Review: [[m:windows|Window functions]].

? "The top 3 salaries in each department, ties included". The standard shape is…
- [ ] GROUP BY department with LIMIT 3
- [ ] ORDER BY salary DESC LIMIT 3
- [x] DENSE_RANK() partitioned by department in a subquery, then `WHERE rnk <= 3`
- [ ] a self-join on salary
> Review: [[m:patterns|Interview patterns]].

? MySQL InnoDB's default transaction isolation level?
- [ ] READ UNCOMMITTED
- [ ] READ COMMITTED
- [x] REPEATABLE READ
- [ ] SERIALIZABLE
> Review: [[m:modifying|Changing data]].

? Which condition can use an index on `created_at`?
- [ ] `YEAR(created_at) = 2024`
- [ ] `DATE(created_at) = '2024-05-01'`
- [x] `created_at >= '2024-01-01' AND created_at < '2025-01-01'`
- [ ] `created_at + INTERVAL 1 DAY > NOW()`
> Keep the column bare: sargable conditions. Review: [[m:performance|Indexes and performance]].
:::
