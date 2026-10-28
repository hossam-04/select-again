---
id: basics
title: Query basics
kicker: SELECT · FROM · WHERE · ORDER BY · LIMIT
summary: The five clauses you use every day — and the order MySQL actually evaluates them in.
clauses: FROM, WHERE, SELECT, ORDER BY, LIMIT
---

## The one idea that fixes most confusion

You *write* a query as `SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY … LIMIT`. The database *evaluates* it in a different order:

<ol class="order-strip">
<li><b>FROM</b><span>tables &amp; joins</span></li>
<li><b>WHERE</b><span>filter rows</span></li>
<li><b>GROUP BY</b><span>form groups</span></li>
<li><b>HAVING</b><span>filter groups</span></li>
<li><b>SELECT</b><span>compute columns</span></li>
<li><b>DISTINCT</b><span>drop duplicates</span></li>
<li><b>ORDER BY</b><span>sort</span></li>
<li><b>LIMIT</b><span>cut</span></li>
</ol>

Almost every "why doesn't this work?" moment in SQL comes from forgetting this order:

- **WHERE can't see SELECT aliases.** They don't exist yet when WHERE runs.
- **WHERE can't use aggregates** like `COUNT(*)`, because groups don't exist yet. That's what `HAVING` is for.
- **Window functions** (`ROW_NUMBER()` and friends) are computed in the SELECT step, so you can't filter on them in WHERE either. You wrap the query instead (Module 9).
- **ORDER BY runs late**, so it *can* use aliases and expressions from SELECT.
- **LIMIT is last**, so it cuts the final, sorted result.

```sql run
SELECT first_name, last_name, salary / 12 AS monthly
FROM employees
WHERE dept_id = 1          -- runs before SELECT: no aliases here
ORDER BY monthly DESC;     -- runs after SELECT: the alias works
```

Now use the alias in WHERE. MySQL would reject this with *Unknown column 'monthly' in 'where clause'*. The page's engine is more forgiving, so it runs the query and shows MySQL's objection as a warning:

```sql run warn
SELECT first_name, salary / 12 AS monthly
FROM employees
WHERE monthly > 10000;
```

The fix is to repeat the expression (`WHERE salary / 12 > 10000`), or to compute the alias in a subquery and filter it outside.

:::dialect Where aliases are allowed
MySQL lets you use a SELECT alias in `GROUP BY`, `HAVING` and `ORDER BY`. PostgreSQL allows it in `GROUP BY` and `ORDER BY` but not `HAVING`. SQL Server allows it only in `ORDER BY`. No database allows it in `WHERE`.
:::

## SELECT and FROM

- Pick columns or expressions, and name them with `AS`. The keyword is optional, but it makes aliases easy to spot.
- `SELECT *` is fine for exploring. In application code, list the columns so a schema change can't silently reshape your results.
- When a query touches several tables, **qualify** columns (`e.salary`, `d.name`). It prevents "ambiguous column" errors and makes the query readable.
- Put strings in **single quotes**. Wrap awkward identifiers in backticks (`` `order` ``). In MySQL, `"double quotes"` also make a *string*, which surprises people coming from PostgreSQL.

:::gotcha Division in MySQL is decimal
In MySQL, `/` always produces a decimal: `SELECT 7 / 2` gives `3.5000`. PostgreSQL and SQL Server truncate integer division (`7 / 2 = 3`) unless one side is a decimal. For whole-number division in MySQL, use `DIV` (`7 DIV 2 = 3`), and use `%` or `MOD()` for the remainder.
:::

```sql run
SELECT 7 / 2 AS decimal_division, 7 DIV 2 AS integer_division, 7 % 2 AS remainder;
```

## WHERE, briefly

WHERE keeps only the rows for which the condition is **true**. Use comparisons (`=`, `<>` or `!=`, `<`, `<=`, `>`, `>=`) combined with `AND`, `OR` and `NOT`. Module 2 covers the details, including what NULL does to all of this.

MySQL's default collation compares text **case-insensitively**, so `'CHEN'` matches `'Chen'`:

```sql run
SELECT first_name, last_name, title
FROM employees
WHERE last_name = 'CHEN';
```

## ORDER BY

- Each key gets its own direction: `ORDER BY dept_id, salary DESC` means department ascending, then salary descending within each department.
- The default direction is `ASC`. In MySQL, **NULLs sort first** in ascending order and last in descending order.
- You can sort by an alias, an expression, or a column position (`ORDER BY 2`). Avoid positions in real code, because they break as soon as someone reorders the column list.

```sql run
SELECT dept_id, first_name, salary
FROM employees
ORDER BY dept_id, salary DESC, emp_id;
```

The CEO has no department (`dept_id` is NULL), so she sorts first. Engineering's two 110,000 salaries tie, and `emp_id` breaks the tie.

:::key Ties are unordered unless you say otherwise
Rows that tie on every ORDER BY key come back in no guaranteed order, and it can change between runs or versions. Whenever you paginate or pick a "top N", add a unique tie-breaker (usually the primary key).
:::

## LIMIT and OFFSET

`LIMIT n` keeps the first *n* rows of the final result, and `OFFSET m` skips *m* rows before that. MySQL also has a shorthand with the arguments reversed:

```sql run
SELECT first_name, salary
FROM employees
ORDER BY salary DESC, emp_id
LIMIT 3 OFFSET 2;         -- same as LIMIT 2, 3
```

:::gotcha LIMIT m, n puts the offset first
`LIMIT 5, 10` skips 5 rows and returns the next 10 (rows 6–15). It does not mean "rows 5 to 10". Prefer the explicit `LIMIT 10 OFFSET 5` for readability.
:::

:::work Deep OFFSETs are slow
`OFFSET 100000` still reads and throws away 100,000 rows. For pages deep into a large table, use *keyset pagination*: `WHERE id > :last_seen_id ORDER BY id LIMIT 50`. Module 13 explains why that uses an index.
:::

:::dialect Top-N in other databases
SQL Server uses `SELECT TOP 5 …` or `OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY`. PostgreSQL and Oracle 12c+ accept the standard `FETCH FIRST 5 ROWS ONLY`, and PostgreSQL also supports `LIMIT`.
:::

## DISTINCT

`DISTINCT` removes duplicate **rows**, meaning the whole selected tuple, not one column:

```sql run
SELECT DISTINCT country
FROM customers
ORDER BY country;
```

```sql run
SELECT DISTINCT country, city
FROM customers
ORDER BY country, city;
```

The second query returns each *(country, city)* pair once. Spain appears once because both Spanish customers live in Madrid. George's city is NULL, and DISTINCT treats NULLs as equal to each other, so all-NULL duplicates collapse to a single row.

:::interview Say the evaluation order out loud
When an interviewer asks why a query fails, walking through *FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT* usually explains it: an alias in WHERE, an aggregate in WHERE, a window function in WHERE. It also shows you reason about queries rather than guess.
:::

## Quick check

:::quiz
? You write `SELECT price * qty AS total FROM items WHERE total > 100`. Why does MySQL reject it?
- [ ] Aliases can't contain arithmetic
- [x] WHERE is evaluated before SELECT, so `total` doesn't exist yet
- [ ] You must use HAVING for any alias
- [ ] Aliases need backticks
> The alias is created in the SELECT step, which runs after WHERE. Repeat the expression in WHERE, or filter in an outer query. (MySQL *does* allow the alias in HAVING and ORDER BY.)

? What does `LIMIT 5, 10` return in MySQL?
- [ ] Rows 5 to 10
- [ ] The first 5 rows, then 10 more
- [x] Rows 6 through 15
- [ ] An error
> The first argument is the offset, the second is the count: skip 5 rows, then take 10.

? `SELECT DISTINCT dept_id, title FROM employees` removes duplicates of…
- [ ] `dept_id` only
- [ ] `title` only
- [x] each (dept_id, title) combination
- [ ] nothing, because DISTINCT needs one column
> DISTINCT applies to the entire selected row.

? In MySQL, where do NULLs appear with `ORDER BY col ASC`?
- [x] First
- [ ] Last
- [ ] Randomly
- [ ] They are excluded
> MySQL treats NULL as smaller than any value, so NULLs come first ascending and last descending. PostgreSQL does the opposite by default.

? `SELECT 7 / 2` in MySQL returns…
- [ ] 3
- [x] 3.5000
- [ ] 4
- [ ] an error: integer division
> MySQL's `/` always returns a decimal. Use `DIV` for integer division. PostgreSQL would return 3.
:::
