---
id: schema
title: Schema design
kicker: types · keys · constraints · normalization · views
summary: Designing tables that keep data correct by construction — choosing types, keys and constraints, normalizing away update anomalies, and knowing when to bend the rules.
---

## Choosing column types

| Data | MySQL type | Why |
|---|---|---|
| Ids | `INT` / `BIGINT` (`UNSIGNED` optional) | BIGINT when you might pass ~2 billion rows |
| Money | `DECIMAL(12, 2)` | Exact. **Never** FLOAT/DOUBLE for money: they're binary fractions |
| Short text | `VARCHAR(n)` | Variable length. `n` is a limit in characters, not bytes |
| Long text | `TEXT` | For bodies and descriptions. Awkward to index, so don't use it for keys |
| Flags | `BOOLEAN` (a `TINYINT(1)`) | MySQL stores 0/1 |
| Fixed small set | `ENUM('a','b')` or a lookup table | ENUM is compact but changing its values means an ALTER |
| Calendar day | `DATE` | No time zone involved |
| Moment in time | `DATETIME` or `TIMESTAMP` | `TIMESTAMP` is stored as UTC and converted to the session time zone. `DATETIME` stores exactly what you give it |
| Flexible attributes | `JSON` | Validated JSON with path functions. Don't use it to dodge schema design |

:::gotcha FLOAT for money
`0.1 + 0.2` in floating point is `0.30000000000000004`. With DECIMAL, MySQL stores the exact value, so sums of prices stay exact. Rounding bugs from FLOAT money columns are some of the hardest to track down in finance code.
:::

## Keys and constraints: let the database say no

Constraints turn business rules into guarantees. Bad data is rejected at write time instead of discovered in a report months later.

```sql run db=empty
CREATE TABLE authors (
  author_id INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(100) NOT NULL,
  email     VARCHAR(255) NOT NULL UNIQUE
);
CREATE TABLE books (
  book_id   INT AUTO_INCREMENT PRIMARY KEY,
  author_id INT NOT NULL,
  title     VARCHAR(200) NOT NULL,
  price     DECIMAL(8,2) NOT NULL CHECK (price >= 0),
  status    ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
  FOREIGN KEY (author_id) REFERENCES authors (author_id) ON DELETE CASCADE
);
INSERT INTO authors (name, email) VALUES ('Ursula', 'ul@books.test'), ('Octavia', 'ob@books.test');
INSERT INTO books (author_id, title, price) VALUES (1, 'The Dispossessed', 18.50), (1, 'Earthsea', 15.00), (2, 'Kindred', 16.00);

DELETE FROM authors WHERE author_id = 1;          -- ON DELETE CASCADE removes her books too

SELECT b.title, a.name, b.status
FROM books b
JOIN authors a ON a.author_id = b.author_id;
```

- **PRIMARY KEY**: unique, not null, one per table. In InnoDB the table is physically stored in primary-key order (the *clustered index*).
- **UNIQUE**: no duplicate values, though NULLs are allowed, even several of them.
- **NOT NULL** and **DEFAULT**: make missing values impossible, or give them a sensible fallback.
- **CHECK** (enforced since MySQL 8.0.16): any row-level rule.
- **FOREIGN KEY**: the referenced row must exist. The `ON DELETE` action decides what happens to children: `RESTRICT` (the default, block the delete), `CASCADE`, or `SET NULL`.

Watch the constraints fire:

```sql run db=empty error
CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(100) NOT NULL UNIQUE);
INSERT INTO users VALUES (1, 'a@x.io');
INSERT INTO users VALUES (2, 'A@X.IO');   -- duplicate under the case-insensitive collation
```

```sql run db=empty error
CREATE TABLE parents (id INT PRIMARY KEY);
CREATE TABLE children (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES parents (id));
INSERT INTO children VALUES (1, 99);      -- no parent 99
```

:::key Collation affects uniqueness
With MySQL's default case-insensitive collation, `'a@x.io'` and `'A@X.IO'` are *equal*, so a UNIQUE email column rejects the second one. That's usually what you want for emails. Use a `_bin` or `_cs` collation where case must matter.
:::

### Natural vs surrogate keys

A *natural* key comes from the domain (an ISBN, a country code). A *surrogate* key is a meaningless generated number. Surrogates don't change when the real world does: people change emails, and companies change names. So the usual design is a surrogate primary key plus a UNIQUE constraint on the natural key. Many-to-many junction tables often use a **composite** primary key instead, like `order_items (order_id, product_id)` in the sample database.

## Normalization: one fact in one place

Here's a "convenient" flat table that repeats customer and product facts on every line:

```sql setup name=flat
CREATE TABLE order_lines_flat (
  order_id INT, order_date DATE,
  customer_name VARCHAR(50), customer_city VARCHAR(50),
  product_name VARCHAR(50), unit_price DECIMAL(8,2), quantity INT
);
INSERT INTO order_lines_flat VALUES
  (1, '2025-01-05', 'Rosa Diaz', 'Madrid',    'Lamp',  40.00, 1),
  (1, '2025-01-05', 'Rosa Diaz', 'Madrid',    'Desk', 220.00, 1),
  (2, '2025-01-09', 'Rosa Diaz', 'Barcelona', 'Chair', 90.00, 4),
  (3, '2025-01-10', 'Tom Hale',  'Leeds',     'Lamp',  45.00, 2);
```

```sql run db=flat
SELECT customer_name,
       COUNT(DISTINCT customer_city)  AS cities_on_file,
       GROUP_CONCAT(DISTINCT customer_city ORDER BY customer_city) AS cities
FROM order_lines_flat
GROUP BY customer_name;
```

Rosa "lives" in two cities, because someone updated one row and not the others. That's an **update anomaly**. The flat design also has an *insertion* anomaly (you can't record a customer who hasn't ordered yet) and a *deletion* anomaly (delete Tom's only order and Tom is gone).

The normal forms, in practical terms:

1. **1NF**: one value per cell. No comma-separated lists or repeating columns like `phone1, phone2, phone3`. (LeetCode #1527 stores conditions as a space-separated list, and querying it needed LIKE gymnastics.)
2. **2NF**: every non-key column depends on the **whole** key. In `(order_id, product_id) → order_date`, the date depends only on `order_id`, so it belongs in `orders`.
3. **3NF**: no facts about facts. `customer_city` depends on the customer, not the order, so it belongs in `customers`.

```sql
CREATE TABLE customers (customer_id INT PRIMARY KEY, name VARCHAR(50), city VARCHAR(50));
CREATE TABLE products  (product_id  INT PRIMARY KEY, name VARCHAR(50), price DECIMAL(8,2));
CREATE TABLE orders (
  order_id    INT PRIMARY KEY,
  customer_id INT NOT NULL,
  order_date  DATE NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
);
CREATE TABLE order_items (
  order_id   INT,
  product_id INT,
  quantity   INT NOT NULL,
  unit_price DECIMAL(8,2) NOT NULL,          -- price at the time of sale
  PRIMARY KEY (order_id, product_id),
  FOREIGN KEY (order_id)   REFERENCES orders (order_id),
  FOREIGN KEY (product_id) REFERENCES products (product_id)
);
```

:::gotcha Inline REFERENCES is silently ignored
MySQL *parses* a column-level `customer_id INT REFERENCES customers(customer_id)` and then ignores it: no foreign key is created. Always write the table-level form `FOREIGN KEY (col) REFERENCES t (col)`. PostgreSQL honours both.
:::

`unit_price` stays on `order_items` on purpose. It records the price **at the time of sale**, which is a different fact from today's `products.price`. That's why the sample database keeps both.

:::work When to denormalize
Normalized schemas are the right default for writes (OLTP). Reporting and analytics (OLAP) often denormalize on purpose, with star schemas, summary tables and materialized aggregates, trading storage and refresh work for fast reads. Denormalize *deliberately*, from a normalized source of truth, never by accident.
:::

## Relationship shapes

- **One-to-many**: a foreign key on the "many" side (`orders.customer_id`).
- **Many-to-many**: a junction table with two foreign keys (`order_items` between orders and products). Put attributes of the relationship itself, like quantity, on the junction.
- **One-to-one**: a foreign key that's also UNIQUE, or the same primary key in both tables. It's used to split rarely-read or sensitive columns out of a hot table.
- **Hierarchy**: a self-referencing foreign key (`employees.manager_id`), queried with recursive CTEs (Module 8).

## Views

A view is a saved query that you can select from like a table. It's good for hiding join logic and exposing a stable interface to reports:

```sql run
CREATE VIEW customer_revenue AS
SELECT c.customer_id, c.name, c.country,
       SUM(oi.quantity * oi.unit_price) AS revenue
FROM customers c
JOIN orders o       ON o.customer_id = c.customer_id AND o.status <> 'cancelled'
JOIN order_items oi ON oi.order_id = o.order_id
GROUP BY c.customer_id, c.name, c.country;

SELECT country, SUM(revenue) AS revenue
FROM customer_revenue
GROUP BY country
ORDER BY revenue DESC;
```

A view stores no data and re-runs its query on every read. For precomputed results you'd use a summary table refreshed by a job. MySQL has no materialized views.

## Conventions that age well

- Use consistent `snake_case` names, and pick either singular or plural table names and stick with it.
- Add `created_at DATETIME DEFAULT CURRENT_TIMESTAMP` and `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` on most tables.
- Store instants in **UTC** and convert at the edges.
- Soft deletes (`deleted_at`) keep history, but every query must then filter them out, and UNIQUE constraints get tricky. Weigh them per table.

## Quick check

:::quiz
? Which type should store an order total like 1999.99?
- [ ] FLOAT
- [ ] DOUBLE
- [x] DECIMAL(10,2)
- [ ] VARCHAR(10)
> DECIMAL is exact. Binary floats can't represent most decimal fractions exactly, and the errors accumulate in sums.

? `orders(order_id, product_id, order_date, quantity)` with key (order_id, product_id). Which normal form does `order_date` break?
- [ ] 1NF
- [x] 2NF: it depends on only part of the composite key
- [ ] 3NF
- [ ] None
> The date is a fact about the order, not about the (order, product) line. Move it to an `orders` table.

? A UNIQUE column in MySQL can hold…
- [ ] no NULLs
- [ ] exactly one NULL
- [x] any number of NULLs
- [ ] NULLs only if the column is NOT NULL
> NULL isn't equal to anything, including another NULL, so several NULLs don't violate UNIQUE. SQL Server is the odd one out: it allows only one.

? `FOREIGN KEY (author_id) REFERENCES authors ON DELETE CASCADE`. Deleting an author…
- [ ] fails while they have books
- [x] also deletes their books
- [ ] sets the books' author_id to NULL
- [ ] leaves orphaned books behind
> That's CASCADE. RESTRICT (the default) blocks the delete, and SET NULL keeps the books with a NULL author_id.
:::
