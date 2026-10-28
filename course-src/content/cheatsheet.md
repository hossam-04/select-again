## Evaluation order

`FROM` + joins → `WHERE` → `GROUP BY` → `HAVING` → `SELECT` (window functions here) → `DISTINCT` → `ORDER BY` → `LIMIT`

- WHERE can't see SELECT aliases or aggregates.
- HAVING filters groups. MySQL lets it use SELECT aliases.
- Window functions can't be filtered in WHERE, so wrap the query.
- ORDER BY can use aliases, expressions and positions.

## Query skeleton

```sql
WITH step AS (                 -- one row per …
  SELECT a, b, SUM(x) AS total
  FROM t1
  JOIN t2 ON t2.id = t1.t2_id
  WHERE t1.flag = 1
  GROUP BY a, b
  HAVING SUM(x) > 100
)
SELECT a, b, total,
       RANK() OVER (PARTITION BY a ORDER BY total DESC) AS rnk
FROM step
ORDER BY a, rnk
LIMIT 10 OFFSET 0;             -- MySQL also: LIMIT 0, 10
```

## NULL rules

- Any comparison with NULL is UNKNOWN, and WHERE keeps only TRUE.
- Test NULL with `IS NULL` / `IS NOT NULL`. `a <=> b` is NULL-safe equality.
- `NOT IN (list containing NULL)` matches nothing, so use `NOT EXISTS`.
- Aggregates skip NULLs. `COUNT(*)` counts rows. `SUM` over no rows is NULL.
- GROUP BY, DISTINCT and ORDER BY treat NULLs as one group. In MySQL, NULLs sort first when ascending.
- Fallbacks: `IFNULL(x, 0)`, `COALESCE(a, b, c)`. `NULLIF(a, b)` returns NULL when a = b.

## Joins

| Join | Keeps |
|---|---|
| `JOIN` (INNER) | matched pairs only |
| `LEFT JOIN` | every left row, NULLs when unmatched |
| `CROSS JOIN` | every combination (grids) |
| FULL (MySQL has none) | `LEFT JOIN … UNION ALL` right-only rows |

```sql
-- anti-join: rows with no match
SELECT a.* FROM a LEFT JOIN b ON b.a_id = a.id WHERE b.id IS NULL;
SELECT a.* FROM a WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.a_id = a.id);
-- semi-join: rows with at least one match, no duplicates
SELECT a.* FROM a WHERE EXISTS (SELECT 1 FROM b WHERE b.a_id = a.id);
```

Conditions on the right table of a LEFT JOIN belong in `ON`, not `WHERE`. After a LEFT JOIN, `COUNT(b.id)` counts matches.

## Aggregation

```sql
SELECT k,
       COUNT(*), COUNT(col), COUNT(DISTINCT col),
       SUM(cond),                          -- rows where cond is true
       ROUND(100 * AVG(cond), 2),          -- % of rows
       SUM(CASE WHEN cond THEN amt ELSE 0 END),
       GROUP_CONCAT(DISTINCT x ORDER BY x SEPARATOR ',')
FROM t
GROUP BY k
HAVING COUNT(*) >= 2;
```

- Every selected column must be grouped or aggregated (ONLY_FULL_GROUP_BY).
- `COUNT(cond)` counts false rows too (it skips only NULL). Use `SUM(cond)`.

## Window functions

```sql
fn() OVER (PARTITION BY p ORDER BY o ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
```

| Function | Ties 90, 80, 80, 70 |
|---|---|
| `ROW_NUMBER()` | 1, 2, 3, 4 |
| `RANK()` | 1, 2, 2, 4 |
| `DENSE_RANK()` | 1, 2, 2, 3 |

- `LAG(x, n, default)`, `LEAD(x)`, `FIRST_VALUE`, `LAST_VALUE` (widen the frame!), `NTH_VALUE`, `NTILE(n)`.
- `SUM(x) OVER (ORDER BY d)` is a running total. The default frame is RANGE, so ties are included together.
- Share of total: `x / SUM(x) OVER (PARTITION BY g)`.
- `rank`, `lag`, `lead`… are reserved words in MySQL 8. Backtick them as names.

## CTEs and recursion

```sql
WITH RECURSIVE seq AS (
  SELECT DATE('2025-01-01') AS d               -- anchor
  UNION ALL
  SELECT d + INTERVAL 1 DAY FROM seq           -- step
  WHERE d < '2025-01-31'                       -- stop
)
SELECT seq.d, COUNT(e.id)
FROM seq LEFT JOIN events e ON e.day = seq.d
GROUP BY seq.d;
```

Hierarchy: the anchor is `WHERE manager_id IS NULL`, and the step is `JOIN cte ON e.manager_id = cte.id`. The anchor fixes column types (`CAST(x AS CHAR(200))`). The depth limit is `cte_max_recursion_depth` (1000).

## Set operations

- `UNION` de-duplicates. `UNION ALL` keeps all rows and is cheaper.
- Columns match by position, and names come from the first SELECT.
- A final `ORDER BY`/`LIMIT` applies to the whole result. Per branch: `(SELECT … LIMIT 1) UNION ALL (SELECT … LIMIT 1)`.
- `INTERSECT` / `EXCEPT` need MySQL 8.0.31+. Otherwise use `IN` / `NOT EXISTS`.

## Patterns

```sql
-- top N per group
SELECT * FROM (SELECT t.*, DENSE_RANK() OVER (PARTITION BY g ORDER BY v DESC) r FROM t) x WHERE r <= 3;
-- N-th highest (NULL if none)
SELECT (SELECT DISTINCT v FROM t ORDER BY v DESC LIMIT 1 OFFSET 1) AS second;
-- gaps & islands
SELECT id - ROW_NUMBER() OVER (ORDER BY id) AS grp, t.* FROM t;         -- same grp = same run
-- pivot
SELECT id, SUM(CASE WHEN m = 'Jan' THEN v END) AS Jan FROM t GROUP BY id;
-- relational division ("bought all")
SELECT c FROM t GROUP BY c HAVING COUNT(DISTINCT p) = (SELECT COUNT(*) FROM products);
-- delete duplicates, keep smallest id
DELETE p1 FROM t p1 JOIN t p2 ON p1.k = p2.k AND p1.id > p2.id;
-- median
SELECT AVG(v) FROM (SELECT v, ROW_NUMBER() OVER (ORDER BY v) rn, COUNT(*) OVER () n FROM t) x
WHERE rn IN (FLOOR((n + 1) / 2), CEIL((n + 1) / 2));
```

## Dates (MySQL)

| Need | Expression |
|---|---|
| now / today | `NOW()`, `CURDATE()` |
| parts | `YEAR(d)`, `MONTH(d)`, `DAY(d)`, `DAYNAME(d)`, `DAYOFWEEK(d)` (1 = Sun) |
| month key | `DATE_FORMAT(d, '%Y-%m')` |
| month start / end | `DATE_FORMAT(d, '%Y-%m-01')`, `LAST_DAY(d)` |
| shift | `DATE_ADD(d, INTERVAL 7 DAY)`, `d - INTERVAL 1 MONTH` |
| difference | `DATEDIFF(a, b)` (days), `TIMESTAMPDIFF(MONTH, a, b)` |
| strip time | `DATE(ts)` |
| a whole day/year | `ts >= '2024-01-01' AND ts < '2025-01-01'` |

## Strings

| Need | Expression |
|---|---|
| join | `CONCAT(a, b)` (NULL if any is NULL), `CONCAT_WS(', ', a, b)` |
| case | `UPPER`, `LOWER` |
| cut | `LEFT(s, n)`, `RIGHT(s, n)`, `SUBSTRING(s, start, len)` (1-based) |
| split | `SUBSTRING_INDEX(s, '@', -1)` → after the last `@` |
| length | `CHAR_LENGTH(s)` (characters), `LENGTH(s)` (bytes) |
| find | `LOCATE(sub, s)`, `INSTR(s, sub)` |
| patterns | `LIKE 'a%'`, `_` = one char; `REGEXP_LIKE(s, '^a', 'c')` for case-sensitive |
| tidy | `TRIM`, `REPLACE(s, from, to)`, `LPAD(s, n, '0')` |

## Numbers and types

- `7 / 2` is 3.5 in MySQL (3 in PostgreSQL). Use `7 DIV 2` = 3 and `7 % 2` = 1.
- `ROUND(x, 2)` rounds exact values (DECIMAL, integers) half away from zero, and FLOAT/DOUBLE half to even. Also `TRUNCATE(x, 2)`, `CEIL`, `FLOOR`.
- `CAST(x AS SIGNED | UNSIGNED | DECIMAL(10,2) | CHAR | DATE)`.
- Money: `DECIMAL`, never FLOAT.
- Conditions are 1/0, so `SUM(cond)` and `AVG(cond)` work.

## Changing data

```sql
INSERT INTO t (a, b) VALUES (1, 'x'), (2, 'y');
INSERT INTO t (a, b) SELECT a, b FROM s WHERE …;
UPDATE t SET v = CASE WHEN … THEN … ELSE v END WHERE …;
UPDATE t JOIN s ON s.id = t.s_id SET t.v = s.v WHERE …;
DELETE FROM t WHERE …;
INSERT INTO t (k, n) VALUES ('a', 1) ON DUPLICATE KEY UPDATE n = n + 1;
INSERT IGNORE INTO t …;          -- skip duplicate keys
```

Run the WHERE as a SELECT first. Error 1093 means you need to wrap the self-referencing subquery in a derived table.

## Transactions

```sql
START TRANSACTION;
UPDATE accounts SET balance = balance - 80 WHERE id = 1;
UPDATE accounts SET balance = balance + 80 WHERE id = 2;
COMMIT;                          -- or ROLLBACK;
```

InnoDB defaults to REPEATABLE READ (MVCC snapshots). Prevent lost updates with `SET x = x - 1`, `SELECT … FOR UPDATE`, or version columns.

## Indexing rules

- Index the columns used in WHERE, JOIN ON, and ORDER BY/GROUP BY.
- Composite order: equality columns first, then the range or sort column. Leftmost prefix only.
- Keep indexed columns bare: `d >= … AND d < …`, not `YEAR(d) = …`.
- `LIKE 'abc%'` can use an index. `LIKE '%abc'` can't.
- A covering index answers from the index alone.
- Every index slows writes, so check `EXPLAIN` before and after.

## MySQL gotchas

- `||` is OR, not concatenation.
- REGEXP and `=` on text are case-insensitive by default.
- Aliases in WHERE are an error (1054).
- `LIMIT`/`OFFSET` take literals only.
- `NOT IN` + NULL returns nothing.
- `BETWEEN` on DATETIME misses the last day's times.
- `rank`, `rows`, `groups` are reserved words.
- `d + 1` on a DATE is the number 20240132. Use `INTERVAL` and `DATEDIFF`.
- `ROW_NUMBER()`/`RANK()` are BIGINT UNSIGNED, so `ROW_NUMBER() … - id` below zero is error 1690.
- `'2024' = YEAR(d)` compares as numbers (true), but `'abc' = 0` is also true.
- INTERSECT/EXCEPT need 8.0.31+.
- `SET a = b, b = a` doesn't swap.
- `GROUP_CONCAT` truncates at 1024 bytes by default.
