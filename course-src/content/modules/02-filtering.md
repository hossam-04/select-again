---
id: filtering
title: Filtering and NULL
kicker: WHERE · IN · BETWEEN · LIKE · IS NULL
summary: How WHERE really decides, why NULL breaks naive filters, and the NOT IN trap that returns nothing.
clauses: WHERE
---

## WHERE keeps only TRUE

WHERE evaluates its condition for each row and keeps the row only if the result is **TRUE**. That sounds obvious until you meet the third truth value, **UNKNOWN**, which is what you get whenever NULL takes part in a comparison. Rows whose condition is UNKNOWN are dropped, exactly like FALSE ones.

Start with precedence: `AND` binds tighter than `OR`, just as `*` binds tighter than `+`.

```sql run
-- Reads as: dept 1, OR (dept 2 AND salary > 100000)
SELECT first_name, dept_id, salary
FROM employees
WHERE dept_id = 1 OR dept_id = 2 AND salary > 100000;
```

```sql run
-- What was probably meant: parentheses first
SELECT first_name, dept_id, salary
FROM employees
WHERE (dept_id = 1 OR dept_id = 2) AND salary > 100000;
```

:::tip
Whenever a condition mixes `AND` and `OR`, add parentheses, even when the precedence already happens to do the right thing. It costs nothing and saves the next reader a double-take.
:::

## IN, BETWEEN, LIKE

- `x IN (a, b, c)` is shorthand for `x = a OR x = b OR x = c`.
- `x BETWEEN lo AND hi` is **inclusive** at both ends: `x >= lo AND x <= hi`.
- `x LIKE pattern` uses `%` for any run of characters (including none) and `_` for exactly one character. With MySQL's default collation, `LIKE` ignores case.

```sql run
SELECT name, city, signup_date
FROM customers
WHERE city IN ('Cairo', 'Alexandria')
  AND signup_date BETWEEN '2024-01-01' AND '2024-06-30';
```

```sql run
SELECT name FROM products
WHERE name LIKE '%phone%'      -- matches "Phone X", "Phone Case" and "…Headphones"
ORDER BY name;
```

:::gotcha BETWEEN and timestamps
With `DATETIME` values, `BETWEEN '2024-01-01' AND '2024-01-31'` stops at `2024-01-31 00:00:00`, so events later on the 31st are silently missed. Use a half-open range instead: `ts >= '2024-01-01' AND ts < '2024-02-01'`.
:::

```sql setup name=events
CREATE TABLE events (event_id INT, happened_at DATETIME);
INSERT INTO events VALUES
  (1, '2024-01-01 09:00:00'), (2, '2024-01-15 12:30:00'),
  (3, '2024-01-31 09:30:00'), (4, '2024-01-31 18:45:00'), (5, '2024-02-01 08:00:00');
```

```sql run db=events
SELECT
  SUM(happened_at BETWEEN '2024-01-01' AND '2024-01-31')           AS between_count,
  SUM(happened_at >= '2024-01-01' AND happened_at < '2024-02-01')   AS half_open_count
FROM events;
```

`BETWEEN` counted 2 events: it silently missed both of January 31st's events, at 09:30 and 18:45. The half-open range counts all 4. (A MySQL comparison evaluates to 1 or 0, so `SUM(condition)` counts matching rows, a trick you'll use constantly in Module 4.)

To match a literal `%` or `_`, escape it with a backslash (MySQL's default escape character): `LIKE '%\_%'` finds values containing an underscore.

## NULL: the missing value

NULL means "unknown" or "not applicable". It isn't a value you can compare against: any comparison with NULL, even `NULL = NULL`, yields NULL (UNKNOWN), never TRUE.

```sql run
SELECT NULL = NULL      AS eq,
       NULL <> 1        AS neq,
       NULL IS NULL     AS is_null,
       NULL <=> NULL    AS null_safe_eq,
       1 <=> NULL       AS null_safe_eq_2;
```

Three consequences to memorize:

1. **Test for NULL with `IS NULL` / `IS NOT NULL`**, never with `= NULL`.
2. **Negative filters drop NULLs.** `WHERE city <> 'Cairo'` does not return customers whose city is unknown, because `NULL <> 'Cairo'` is UNKNOWN.
3. **`<=>` is MySQL's NULL-safe equals**: `a <=> b` is TRUE when both are NULL. The standard spelling, which PostgreSQL supports, is `a IS NOT DISTINCT FROM b`.

```sql run
SELECT name, city
FROM customers
WHERE city <> 'Cairo';     -- George (city NULL) is missing
```

```sql run
SELECT name, city
FROM customers
WHERE city <> 'Cairo' OR city IS NULL;
```

The truth tables, where U is UNKNOWN:

| p | q | p AND q | p OR q | NOT p |
|---|---|---|---|---|
| TRUE | U | U | TRUE | FALSE |
| FALSE | U | FALSE | U | TRUE |
| U | U | U | U | U |

`FALSE AND U` is FALSE and `TRUE OR U` is TRUE, because the answer no longer depends on the unknown part. That is also why a single UNKNOWN can quietly sink an entire `AND` chain.

## The NOT IN trap

`x NOT IN (a, b, NULL)` means `x <> a AND x <> b AND x <> NULL`. The last term is UNKNOWN for every row, so **the whole condition can never be TRUE** and the query returns nothing. This bites hardest with subqueries, where the NULL is invisible:

```sql run
-- "Customers who never referred anyone"? Returns an empty set.
SELECT name
FROM customers
WHERE customer_id NOT IN (SELECT referred_by FROM customers);
```

`referred_by` contains NULLs (most customers weren't referred), so the result is empty. Filter the NULLs out of the subquery, or use `NOT EXISTS` (Module 6), which doesn't have this problem:

```sql run
SELECT name
FROM customers
WHERE customer_id NOT IN (SELECT referred_by FROM customers WHERE referred_by IS NOT NULL)
ORDER BY name;
```

:::interview
"Why does my NOT IN return nothing?" is a classic interview question. The answer: a NULL in the list makes every comparison UNKNOWN. Mention `NOT EXISTS` or a `LEFT JOIN … IS NULL` anti-join as the robust alternatives.
:::

## Replacing and producing NULLs

- `COALESCE(a, b, c)` returns the first non-NULL argument. It's standard SQL and works everywhere.
- `IFNULL(a, b)` is MySQL's two-argument version (SQL Server calls it `ISNULL(a, b)`, Oracle `NVL`).
- `NULLIF(a, b)` returns NULL when `a = b`, otherwise `a`. The classic use is `x / NULLIF(y, 0)` to avoid division-by-zero errors. MySQL already returns NULL for `x / 0`, but PostgreSQL and SQL Server raise an error, so the habit is worth keeping.

```sql run
SELECT name,
       COALESCE(city, 'unknown')              AS city,
       IFNULL(email, CONCAT('(no email) ', country)) AS contact
FROM customers
WHERE city IS NULL OR email IS NULL;
```

:::key NULL is grouped, sorted and deduplicated as one value
Comparisons treat NULL as unknown, but `GROUP BY`, `DISTINCT` and `ORDER BY` put all NULLs together as one group. Aggregate functions skip NULLs (`SUM`, `AVG`, `COUNT(col)`), while `COUNT(*)` counts rows. Module 4 builds on this.
:::

## Quick check

:::quiz
? Table `t(x)` holds 1, 2 and NULL. How many rows does `SELECT * FROM t WHERE x <> 1` return?
- [ ] 2
- [x] 1
- [ ] 0
- [ ] 3
> Only `2`. For the NULL row, `NULL <> 1` is UNKNOWN, and WHERE keeps only TRUE.

? What does `SELECT 5 NOT IN (1, 2, NULL)` return in MySQL?
- [ ] 1 (true)
- [ ] 0 (false)
- [x] NULL (unknown)
- [ ] an error
> `5 <> NULL` is UNKNOWN, and `TRUE AND UNKNOWN` is UNKNOWN. In a WHERE clause, that row would be filtered out.

? Which condition finds rows where `a` and `b` are equal **or both NULL**?
- [ ] `a = b`
- [ ] `a = b OR a = NULL`
- [x] `a <=> b`
- [ ] `IFNULL(a, b) = b`
> `<=>` is MySQL's NULL-safe equality (standard SQL: `IS NOT DISTINCT FROM`). `a = NULL` is never TRUE.

? `order_date BETWEEN '2024-03-01' AND '2024-03-31'` on a `DATE` column includes…
- [ ] March 1 to 30
- [x] March 1 to 31
- [ ] March 2 to 30
- [ ] nothing: BETWEEN needs numbers
> BETWEEN is inclusive at both ends. It only becomes dangerous with DATETIME values, where the upper bound means midnight at the start of March 31.
:::
