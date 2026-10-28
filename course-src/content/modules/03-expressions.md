---
id: expressions
title: Expressions and functions
kicker: CASE · strings · numbers · dates · REGEXP
summary: Computing new values per row — conditional logic, text surgery, rounding, and date math, the MySQL way.
clauses: SELECT, WHERE
---

## CASE: if/else inside a query

`CASE` evaluates conditions top to bottom and returns the first match. Without an `ELSE`, the default is NULL.

```sql run
SELECT first_name, salary,
       CASE
         WHEN salary >= 150000 THEN 'band A'
         WHEN salary >= 100000 THEN 'band B'   -- only reached if the first WHEN failed
         ELSE 'band C'
       END AS band
FROM employees
ORDER BY salary DESC
LIMIT 6;
```

The *simple* form compares a single expression against values: `CASE status WHEN 'pending' THEN … WHEN 'shipped' THEN … END`. A neat use is a custom sort order:

```sql run
SELECT order_id, status
FROM orders
WHERE order_date >= '2025-01-01'
ORDER BY CASE status WHEN 'pending' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END, order_id;
```

MySQL also has `IF(condition, then, else)` for the two-branch case, and conditions are just numbers: `salary > 100000` evaluates to 1 or 0. That makes `SUM(condition)` a row counter and `AVG(condition)` a ratio, a trick that shows up in half the LeetCode aggregation problems.

```sql run
SELECT first_name,
       IF(manager_id IS NULL, 'top', 'reports to someone') AS position,
       salary > 100000 AS six_figures
FROM employees
WHERE emp_id <= 5;
```

:::dialect
`IF()` is MySQL-only. `CASE` is standard and works in every database, so prefer it in code that might move. SQL Server has `IIF()`, and PostgreSQL booleans are `true`/`false` rather than 1/0: write `SUM(CASE WHEN cond THEN 1 ELSE 0 END)` or `COUNT(*) FILTER (WHERE cond)` there.
:::

## Numbers

| Function | Example | Result |
|---|---|---|
| `ROUND(x, d)` | `ROUND(2.675, 2)` | 2.68 (half away from zero) |
| `TRUNCATE(x, d)` | `TRUNCATE(2.679, 2)` | 2.67 |
| `CEIL(x)` / `FLOOR(x)` | `CEIL(4.1)`, `FLOOR(-4.1)` | 5, −5 |
| `x % y`, `MOD(x, y)` | `17 % 5` | 2 |
| `x DIV y` | `17 DIV 5` | 3 (integer division) |
| `ABS`, `POWER`, `SQRT` | `POWER(2, 10)` | 1024 |

```sql run
SELECT name, price,
       ROUND(price * 1.14, 2)   AS with_vat,
       CEIL(price / 100) * 100  AS next_hundred,
       FORMAT(price * 1000, 0)  AS pretty
FROM products
WHERE category = 'Computers';
```

:::gotcha Percentages on LeetCode
Many problems ask for a percentage "rounded to 2 decimal places". Compute with a decimal on the left, then round once, at the end: `ROUND(100 * hits / total, 2)`. In MySQL `hits / total` is already decimal. In PostgreSQL it would be integer division unless you cast, so writing `100.0 * hits / total` is the portable habit.
:::

## Strings

- `CONCAT(a, b, …)` joins strings, and returns **NULL if any argument is NULL**. `CONCAT_WS(sep, a, b, …)` joins with a separator and *skips* NULLs.
- `UPPER`, `LOWER`, `TRIM`, `REPLACE(s, from, to)`, `REVERSE`, `LPAD(s, n, pad)`.
- `LEFT(s, n)`, `RIGHT(s, n)`, `SUBSTRING(s, start, len)`. Positions start at **1**, and a negative start counts from the end.
- `CHAR_LENGTH(s)` counts characters. `LENGTH(s)` counts **bytes**, so `'é'` is 2.
- `LOCATE(sub, s)` / `INSTR(s, sub)` give the position (0 if absent). `SUBSTRING_INDEX(s, delim, n)` takes everything before the n-th delimiter, or after it when n is negative, which makes it a handy splitter.

```sql run
SELECT CONCAT(first_name, ' ', last_name)       AS full_name,
       UPPER(LEFT(last_name, 3))                 AS code,
       SUBSTRING_INDEX(email, '@', -1)           AS domain,
       CHAR_LENGTH(first_name)                   AS name_len
FROM employees
WHERE dept_id = 4;
```

Ahmed's email is NULL, so his `domain` is NULL. Now watch what NULL does to `CONCAT`:

```sql run
SELECT name,
       CONCAT(name, ' <', email, '>')         AS concat_result,
       CONCAT_WS(' / ', name, email, city)    AS concat_ws_result
FROM customers
WHERE email IS NULL OR city IS NULL;
```

:::dialect String concatenation elsewhere
PostgreSQL, Oracle and SQLite use `a || b`. SQL Server uses `a + b`. In MySQL, `||` means **OR** unless the `PIPES_AS_CONCAT` mode is on, so `'a' || 'b'` is 0. This page warns you if you try it.
:::

## Regular expressions

`col REGEXP pattern` (also `RLIKE`, or the function `REGEXP_LIKE(col, pattern, flags)`) tests a regular expression. MySQL 8 uses the ICU library, and two details matter:

- It's **case-insensitive** by default with the usual collation. Pass `'c'` as the third argument of `REGEXP_LIKE` for a case-sensitive match.
- Backslashes are string escapes first. To send `\.` to the regex engine, write `'\\.'` in the SQL literal, or sidestep the problem with `[.]`.

```sql run
SELECT email,
       email REGEXP '^[a-z]+[.][a-z]+@acme[.]test$'               AS default_match,
       REGEXP_LIKE(email, '^[a-z]+[.][a-z]+@acme[.]test$', 'c')   AS case_sensitive
FROM employees
WHERE dept_id = 3;
```

`Leo.Martin@Acme.test` passes the default match but fails the case-sensitive one. `REGEXP_REPLACE(s, pattern, replacement)` and `REGEXP_SUBSTR(s, pattern)` round out the family.

## Dates and times

Dates in MySQL look like `'YYYY-MM-DD'`, and datetimes like `'YYYY-MM-DD HH:MM:SS'`. Because that format sorts correctly as text, comparing a date column with a string literal just works.

| Need | MySQL |
|---|---|
| Today / now | `CURDATE()`, `NOW()` |
| Parts | `YEAR(d)`, `MONTH(d)`, `DAY(d)`, `DAYNAME(d)`, `DAYOFWEEK(d)` (1 = Sunday) |
| Format | `DATE_FORMAT(d, '%Y-%m')`, `'%Y-%m-%d'`, `'%b %e'` |
| Add / subtract | `DATE_ADD(d, INTERVAL 7 DAY)`, `d - INTERVAL 1 MONTH` |
| Difference in days | `DATEDIFF(later, earlier)` |
| Difference in other units | `TIMESTAMPDIFF(MONTH, start, end)` |
| Month start / end | `DATE_FORMAT(d, '%Y-%m-01')`, `LAST_DAY(d)` |
| Strip the time | `DATE(ts)` |

```sql run
SELECT order_id, order_date,
       DATE_FORMAT(order_date, '%Y-%m')      AS month,
       DAYNAME(order_date)                   AS weekday,
       DATEDIFF('2025-03-31', order_date)    AS days_before_q1_end,
       LAST_DAY(order_date)                  AS month_end
FROM orders
ORDER BY order_date DESC
LIMIT 5;
```

```sql run
SELECT first_name, hire_date,
       TIMESTAMPDIFF(YEAR, hire_date, '2025-06-30')  AS full_years,
       DATE_ADD(hire_date, INTERVAL 90 DAY)          AS probation_ends
FROM employees
WHERE dept_id = 1;
```

:::gotcha Month arithmetic clamps
`DATE_ADD('2024-01-31', INTERVAL 1 MONTH)` is `2024-02-29`: MySQL clamps to the last day of the shorter month. Adding one month and then subtracting one month doesn't always get you back to where you started.
:::

:::gotcha `date + 1` is not tomorrow
Without `INTERVAL`, MySQL treats a date in arithmetic as the number `YYYYMMDD`. `d + 1` and `later - earlier` look right in the middle of a month and go wrong at month ends. Add with `INTERVAL`, and subtract with `DATEDIFF`.
:::

```sql run
SELECT DATE('2025-03-01') - DATE('2025-02-28') AS subtracted,
       DATEDIFF('2025-03-01', '2025-02-28')    AS datediff_days,
       DATE('2025-02-28') + 1                  AS plus_one,
       DATE('2025-02-28') + INTERVAL 1 DAY     AS next_day;
```

`subtracted` is 73 (20250301 − 20250228), and `plus_one` is 20250229, a number rather than a date. This exact mistake is a classic wrong answer to [[p:197]].

:::dialect Dates are the least portable part of SQL
PostgreSQL: `date_trunc('month', d)`, `d + INTERVAL '7 days'`, `EXTRACT(YEAR FROM d)`, `to_char(d, 'YYYY-MM')`, and `later - earlier` gives days directly. SQL Server: `DATEADD(day, 7, d)`, `DATEDIFF(day, earlier, later)` (note the reversed order), `FORMAT(d, 'yyyy-MM')`. The ideas carry over; the spellings don't.
:::

## Implicit conversion

MySQL converts types quietly. `'10' + 5` is 15, and `'3 apples' + 2` is 5 (with a warning in real MySQL). Comparing a number column to a string compares numerically. This is convenient until it hides a bug. When types differ, cast explicitly: `CAST(x AS SIGNED)`, `CAST(x AS DECIMAL(10,2))`, `CAST(x AS CHAR)`, `CAST(x AS DATE)`.

```sql run
SELECT '10' + 5              AS sum_of_text,
       '3 apples' + 2        AS lenient,
       CAST('7.9' AS SIGNED) AS cast_text_int,
       CAST(7.9 AS SIGNED)   AS cast_num_int,
       CAST(2/3 AS DECIMAL(10,2)) AS two_thirds;
```

Casting the *string* `'7.9'` truncates to 7, but casting the *number* 7.9 rounds to 8. That's a genuine MySQL quirk.

## Quick check

:::quiz
? `CONCAT('Order #', order_id, ' — ', note)` returns NULL for some rows. Why?
- [ ] `order_id` is a number, so CONCAT fails
- [x] `note` is NULL on those rows, and CONCAT returns NULL if any argument is NULL
- [ ] the em dash is not allowed
- [ ] CONCAT needs exactly two arguments
> Wrap the nullable part (`IFNULL(note, '')`) or use `CONCAT_WS`, which skips NULLs.

? What does `CASE WHEN x > 10 THEN 'big' WHEN x > 5 THEN 'medium' END` return for x = 3?
- [ ] `'medium'`
- [ ] `''`
- [x] NULL
- [ ] an error
> No branch matched and there's no ELSE, so the result is NULL.

? `LENGTH('héllo')` vs `CHAR_LENGTH('héllo')` in MySQL with utf8mb4?
- [ ] 5 and 5
- [x] 6 and 5
- [ ] 5 and 6
- [ ] 6 and 6
> LENGTH counts bytes, and `é` takes two bytes in UTF-8. For "number of characters" use CHAR_LENGTH.

? Which expression gives the first day of the month for a date `d`?
- [ ] `DAY(d, 1)`
- [x] `DATE_FORMAT(d, '%Y-%m-01')`
- [ ] `LAST_DAY(d) - 30`
- [ ] `MONTH(d) || '-01'`
> Format the date back to text with the day fixed at 01 (MySQL accepts the result wherever a date is expected). `LAST_DAY(d)` gives the month end.

? Which REGEXP call is case-sensitive in MySQL 8?
- [ ] `mail REGEXP '^[a-z]+@x[.]com$'`
- [ ] `mail RLIKE '^[a-z]+@x[.]com$'`
- [x] `REGEXP_LIKE(mail, '^[a-z]+@x[.]com$', 'c')`
- [ ] All of them
> REGEXP and RLIKE follow the column's collation, which is case-insensitive by default. The `'c'` flag forces a case-sensitive match.
:::
