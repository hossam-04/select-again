---
id: modifying
title: Changing data
kicker: INSERT · UPDATE · DELETE · upserts · transactions · isolation
summary: Writing to tables safely — multi-row and INSERT…SELECT, UPDATE and DELETE with joins, MySQL upserts, transactions, and what isolation levels actually protect you from.
clauses: WHERE
---

Every example below runs on a fresh copy of the sample database, so experiment freely: nothing you change survives the next Run.

## INSERT

Always name the columns. The statement then survives new columns being added, and it documents itself:

```sql run
INSERT INTO products (product_id, name, category, price)
VALUES (12, 'E-reader', 'Accessories', 139.00),
       (13, 'Stylus',   'Accessories',  29.00);

SELECT * FROM products WHERE product_id >= 11 ORDER BY product_id;
```

`INSERT … SELECT` copies query results into a table, which is handy for archiving and backfills:

```sql run
CREATE TABLE order_archive (order_id INT PRIMARY KEY, customer_id INT, order_date DATE);

INSERT INTO order_archive (order_id, customer_id, order_date)
SELECT order_id, customer_id, order_date
FROM orders
WHERE order_date < '2024-03-01';

SELECT * FROM order_archive;
```

:::tip AUTO_INCREMENT
With `id INT AUTO_INCREMENT PRIMARY KEY`, leave `id` out of the column list and MySQL assigns the next number. `LAST_INSERT_ID()` returns it for the current connection, which is safe even with other sessions inserting at the same time.
:::

## UPDATE

`SET` expressions see each row's **old** values, and `WHERE` picks the rows. Forgetting the WHERE updates every row in the table.

```sql run
UPDATE employees
SET salary = ROUND(salary * 1.05)
WHERE dept_id = 3;

SELECT first_name, salary FROM employees WHERE dept_id = 3;
```

`CASE` lets one statement apply different changes to different rows (#627):

```sql run
UPDATE employees
SET salary = CASE dept_id WHEN 1 THEN salary * 1.10
                          WHEN 2 THEN salary * 1.05
                          ELSE salary END
WHERE dept_id IN (1, 2);

SELECT first_name, dept_id, salary FROM employees WHERE dept_id IN (1, 2) ORDER BY dept_id, emp_id;
```

MySQL can update using a **join**, reading from other tables to decide what to change:

```sql run
UPDATE employees e
JOIN departments d ON d.dept_id = e.dept_id
SET e.salary = e.salary + 1000
WHERE d.location = 'Cairo';

SELECT e.first_name, d.location, e.salary
FROM employees e
JOIN departments d ON d.dept_id = e.dept_id
WHERE d.location = 'Cairo';
```

:::dialect
PostgreSQL writes this as `UPDATE employees e SET salary = … FROM departments d WHERE d.dept_id = e.dept_id AND …`. SQL Server uses `UPDATE e SET … FROM employees e JOIN departments d ON …`. Same idea, three spellings.
:::

## DELETE

```sql run
DELETE FROM order_items
WHERE order_id IN (SELECT order_id FROM orders WHERE status = 'cancelled');

DELETE FROM orders WHERE status = 'cancelled';

SELECT status, COUNT(*) AS orders FROM orders GROUP BY status;
```

The output shows how many rows each statement touched, the way the MySQL client prints *Query OK, n rows affected*.

MySQL also has a **multi-table DELETE**: `DELETE t1 FROM t1 JOIN t2 ON … WHERE …` deletes the rows of `t1` that find a partner. It's the standard way to remove duplicates (#196).

:::gotcha Error 1093: reading the table you're changing
MySQL refuses a DELETE or UPDATE whose subquery selects from the same table. Wrapping the subquery in a derived table materializes it first and makes it legal.
:::

```sql run warn
DELETE FROM customers
WHERE customer_id NOT IN (SELECT customer_id FROM orders)
  AND signup_date < (SELECT MAX(signup_date) FROM customers);
```

```sql run
DELETE FROM customers
WHERE customer_id NOT IN (SELECT customer_id FROM orders)
  AND signup_date < (SELECT latest FROM (SELECT MAX(signup_date) AS latest FROM customers) AS t);

SELECT COUNT(*) AS customers_left FROM customers;
```

`DELETE FROM t` removes rows one by one (logged, triggers fire, can be rolled back). `TRUNCATE TABLE t` empties the table far faster and resets AUTO_INCREMENT, but in MySQL it can't be rolled back. `DROP TABLE t` removes the table itself.

## Upserts

"Insert, or update if the key already exists". MySQL has three tools:

```sql run db=empty
CREATE TABLE page_views (page VARCHAR(100) PRIMARY KEY, views INT NOT NULL);
INSERT INTO page_views VALUES ('/home', 1);

INSERT INTO page_views (page, views)
VALUES ('/home', 1), ('/pricing', 1)
ON DUPLICATE KEY UPDATE views = views + 1;       -- existing key: update instead

SELECT * FROM page_views ORDER BY page;
```

```sql run db=empty
CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(100) UNIQUE, name VARCHAR(50));
INSERT INTO users VALUES (1, 'a@x.io', 'Ann');

INSERT IGNORE INTO users VALUES (2, 'a@x.io', 'Ann again');  -- duplicate email: skipped, no error
REPLACE INTO users VALUES (1, 'ann@x.io', 'Ann R.');          -- deletes row 1, inserts the new one

SELECT * FROM users;
```

:::gotcha REPLACE is delete + insert
`REPLACE` deletes the conflicting row and inserts a new one. Columns you didn't supply revert to defaults, delete triggers fire, and `ON DELETE CASCADE` children disappear. Prefer `ON DUPLICATE KEY UPDATE`. `INSERT IGNORE` also silences other errors (bad data becomes warnings), so use it deliberately.
:::

:::dialect
PostgreSQL and SQLite use `INSERT … ON CONFLICT (key) DO UPDATE SET views = EXCLUDED.views + …`. SQL Server and Oracle have `MERGE`. MySQL 8.0.19+ lets you name the new row (`INSERT … AS new ON DUPLICATE KEY UPDATE views = new.views`) instead of the deprecated `VALUES(col)`.
:::

## Transactions

A transaction groups statements so they succeed or fail **together**. InnoDB tables are transactional. With `autocommit` on (the default), every statement is its own transaction until you open one explicitly:

```sql run db=empty
CREATE TABLE accounts (id INT PRIMARY KEY, owner VARCHAR(20), balance DECIMAL(10,2) CHECK (balance >= 0));
INSERT INTO accounts VALUES (1, 'Ana', 100), (2, 'Ben', 50);

START TRANSACTION;                                          -- transfer 80 from Ana to Ben
UPDATE accounts SET balance = balance - 80 WHERE id = 1;
UPDATE accounts SET balance = balance + 80 WHERE id = 2;
COMMIT;

START TRANSACTION;
UPDATE accounts SET balance = balance + 500 WHERE id = 2;   -- oops
ROLLBACK;                                                    -- undone

SELECT * FROM accounts;
```

Constraints are part of the safety net. The CHECK above stops an overdraft, so the whole statement fails:

```sql run db=empty error
CREATE TABLE accounts (id INT PRIMARY KEY, balance DECIMAL(10,2) CHECK (balance >= 0));
INSERT INTO accounts VALUES (1, 100);
UPDATE accounts SET balance = balance - 150 WHERE id = 1;
```

The four ACID guarantees: **Atomicity** (all or nothing), **Consistency** (constraints hold), **Isolation** (concurrent transactions don't see each other's half-done work, to a configurable degree), and **Durability** (committed means it survives a crash).

## Isolation levels

When two sessions work at the same time, these anomalies can happen:

- **Dirty read**: you read another transaction's uncommitted change, which it may later roll back.
- **Non-repeatable read**: you read a row twice in one transaction and get different values, because someone committed in between.
- **Phantom read**: you run the same range query twice and new rows appear.
- **Lost update**: two sessions read a value, both compute a new one, and the second write silently overwrites the first.

| Level | Dirty read | Non-repeatable read | Phantom |
|---|---|---|---|
| READ UNCOMMITTED | possible | possible | possible |
| READ COMMITTED (PostgreSQL, SQL Server default) | prevented | possible | possible |
| REPEATABLE READ (**MySQL InnoDB default**) | prevented | prevented | prevented for plain reads* |
| SERIALIZABLE | prevented | prevented | prevented |

\*InnoDB's REPEATABLE READ gives each transaction a consistent snapshot (MVCC). Plain `SELECT`s see the database as of the first read. *Locking* reads (`SELECT … FOR UPDATE`) and writes see the latest committed rows and use gap locks to block phantoms.

A lost update, step by step (two sessions, both starting from stock = 10):

| Step | Session A | Session B |
|---|---|---|
| 1 | `SELECT stock` → 10 | |
| 2 | | `SELECT stock` → 10 |
| 3 | `UPDATE … SET stock = 9` (10 − 1) | |
| 4 | `COMMIT` | |
| 5 | | `UPDATE … SET stock = 9` (10 − 1) |
| 6 | | `COMMIT`: two sales, stock only dropped by 1 |

Three standard fixes:

1. Let the database do the arithmetic atomically: `UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0`.
2. Lock the row while you decide: `SELECT stock … FOR UPDATE` inside the transaction, so the other session waits.
3. Optimistic concurrency: keep a `version` column and `UPDATE … SET …, version = version + 1 WHERE id = ? AND version = ?`. If 0 rows were updated, someone got there first, so retry.

:::work Deadlocks are normal
Two transactions that lock rows in opposite orders will deadlock. InnoDB detects it, kills one of them (error 1213) and lets the other continue. Keep transactions short, touch rows in a consistent order, and have application code retry deadlock victims.
:::

:::tip Safe-update habits
Before running an UPDATE or DELETE, run the same WHERE as a `SELECT COUNT(*)` first. In a console, open a transaction so you can roll back. MySQL's `SET sql_safe_updates = 1` refuses UPDATE/DELETE without a key-based WHERE or a LIMIT.
:::

## Quick check

:::quiz
? You run `UPDATE t SET a = b, b = a`. In MySQL, what ends up in `b`?
- [ ] The original value of `a`
- [x] The new value of `a`, which is the old `b`, so `b` is unchanged
- [ ] NULL
- [ ] An error
> This is a genuine MySQL quirk: single-table UPDATE assignments are applied left to right, so `b = a` sees the already-updated `a`. The SQL standard, PostgreSQL and SQLite all use the old values and would swap. (This page runs SQLite, which swaps.) Use a CASE or a temporary value when you need a swap in MySQL.

? Why does MySQL reject `DELETE FROM t WHERE id IN (SELECT id FROM t WHERE …)`?
- [ ] IN can't be used in DELETE
- [x] Error 1093: the subquery reads the table being modified. Wrap it in a derived table.
- [ ] DELETE needs a JOIN
- [ ] It's allowed in MySQL
> `… IN (SELECT id FROM (SELECT id FROM t WHERE …) AS x)` materializes the ids first and is accepted.

? What does `INSERT … ON DUPLICATE KEY UPDATE views = views + 1` do when the key already exists?
- [ ] Inserts a second row
- [x] Updates the existing row: its `views` goes up by 1
- [ ] Deletes the row and inserts a new one
- [ ] Raises a duplicate-key error
> REPLACE would delete and re-insert. ON DUPLICATE KEY UPDATE modifies the existing row in place.

? MySQL InnoDB's default isolation level is…
- [ ] READ UNCOMMITTED
- [ ] READ COMMITTED
- [x] REPEATABLE READ
- [ ] SERIALIZABLE
> PostgreSQL and SQL Server default to READ COMMITTED. InnoDB defaults to REPEATABLE READ with MVCC snapshots.

? Two sessions both read stock = 10, subtract 1 in application code, and write 9. What's this called, and one fix?
- [ ] A dirty read; use READ UNCOMMITTED
- [x] A lost update; use `UPDATE … SET stock = stock - 1` or `SELECT … FOR UPDATE`
- [ ] A phantom; use SERIALIZABLE indexes
- [ ] A deadlock; retry
> Do the arithmetic in the database atomically, lock the row before deciding, or use a version check.
:::
