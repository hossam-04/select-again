// Module 6: subqueries, EXISTS, derived tables
export default [
  {
    id: 1978,
    module: 'subqueries',
    sql50: true,
    order: true,
    patterns: ['NOT IN', 'anti-join'],
    task: `When a manager leaves, their row is deleted but their reports keep the old \`manager_id\`. Return the \`employee_id\` of employees who earn **strictly less than 30000** and whose manager **left** (they have a \`manager_id\`, but no employee has that id). Order by \`employee_id\`.`,
    schema: `CREATE TABLE Employees (employee_id INT PRIMARY KEY, name VARCHAR(20), manager_id INT, salary INT);`,
    data: `INSERT INTO Employees VALUES
  (1, 'Ari', NULL, 45000), (2, 'Bex', 1, 25000), (3, 'Cam', 7, 21000), (4, 'Dot', 7, 32000),
  (5, 'Eli', NULL, 15000), (6, 'Fin', 8, 29999), (9, 'Gia', 2, 29000), (10, 'Hal', 11, 28000), (12, 'Ivo', 13, 30000);`,
    tests: [
      { name: "A middle manager left", data: `INSERT INTO Employees VALUES (1, 'Ada', NULL, 50000), (3, 'Cal', 2, 10000), (4, 'Dia', 3, 20000), (5, 'Eve', 1, 29000);` },
    ],
    hints: [
      'Two conditions: salary < 30000, and the manager_id is not any existing employee_id.',
      'Employees with no manager at all (NULL) did not "lose" one.',
    ],
    solution: {
      sql: `SELECT employee_id
FROM Employees
WHERE salary < 30000
  AND manager_id NOT IN (SELECT employee_id FROM Employees)
ORDER BY employee_id;`,
      explain: 'NOT IN is safe here: the subquery returns primary keys, which are never NULL. For Eli (`manager_id` NULL), `NULL NOT IN (…)` is UNKNOWN, so he is correctly excluded.',
    },
    alternatives: [
      {
        title: 'LEFT JOIN anti-join',
        sql: `SELECT e.employee_id
FROM Employees e
LEFT JOIN Employees m ON m.employee_id = e.manager_id
WHERE e.salary < 30000
  AND e.manager_id IS NOT NULL
  AND m.employee_id IS NULL
ORDER BY e.employee_id;`,
        explain: 'Here the explicit `manager_id IS NOT NULL` matters: without it, employees who never had a manager would also look "unmatched".',
      },
    ],
    traps: [
      { sql: `SELECT e.employee_id FROM Employees e LEFT JOIN Employees m ON m.employee_id = e.manager_id WHERE e.salary < 30000 AND m.employee_id IS NULL ORDER BY e.employee_id;`, why: 'Also returns Eli, who has no manager at all — the join finds no match for NULL either.' },
      { sql: `SELECT employee_id FROM Employees WHERE salary <= 30000 AND manager_id NOT IN (SELECT employee_id FROM Employees) ORDER BY employee_id;`, why: '"Strictly less" excludes a salary of exactly 30000 (Ivo).' },
    ],
  },
  {
    id: 176,
    module: 'subqueries',
    sql50: true,
    patterns: ['NULL when empty', 'DISTINCT + OFFSET'],
    task: `Return the **second highest distinct** salary in a column named \`SecondHighestSalary\`. If there is no second highest salary, return a single row containing NULL.`,
    schema: `CREATE TABLE Employee (id INT PRIMARY KEY, salary INT);`,
    data: `INSERT INTO Employee VALUES (1, 100), (2, 300), (3, 300), (4, 200);`,
    tests: [
      { name: 'Only one employee', data: `INSERT INTO Employee VALUES (1, 100);` },
      { name: 'Everyone earns the same', data: `INSERT INTO Employee VALUES (1, 500), (2, 500);` },
    ],
    hints: [
      '"Distinct": 300 appears twice but is one salary level.',
      'Sort distinct salaries descending and skip the first.',
      'An empty result is not the same as a row holding NULL — wrap the query as a scalar subquery.',
    ],
    solution: {
      sql: `SELECT (
  SELECT DISTINCT salary
  FROM Employee
  ORDER BY salary DESC
  LIMIT 1 OFFSET 1
) AS SecondHighestSalary;`,
      explain: 'The inner query finds the second distinct value or nothing. Placed in the SELECT list of an outer query with no FROM, it always yields exactly one row — NULL when the inner query found nothing.',
    },
    alternatives: [
      {
        title: 'MAX below the MAX',
        sql: `SELECT MAX(salary) AS SecondHighestSalary
FROM Employee
WHERE salary < (SELECT MAX(salary) FROM Employee);`,
        explain: 'The largest salary smaller than the largest is the second highest distinct salary. MAX over zero rows is NULL, so the empty case is handled for free.',
      },
      {
        title: 'DENSE_RANK',
        sql: `SELECT MAX(salary) AS SecondHighestSalary
FROM (SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS rnk FROM Employee) t
WHERE rnk = 2;`,
        explain: 'Generalizes to the N-th highest (Module 9); the outer MAX turns "no rank 2" into NULL.',
      },
    ],
    traps: [
      { sql: `SELECT salary AS SecondHighestSalary FROM Employee ORDER BY salary DESC LIMIT 1 OFFSET 1;`, why: 'Without DISTINCT the duplicate 300 is "second" — and with one employee you get no row instead of NULL.' },
      { sql: `SELECT DISTINCT salary AS SecondHighestSalary FROM Employee ORDER BY salary DESC LIMIT 1 OFFSET 1;`, why: 'Right value when it exists, but an empty result (not a NULL row) when it does not.' },
    ],
  },
  {
    id: 184,
    module: 'subqueries',
    patterns: ['max per group with ties', 'tuple IN'],
    task: `Find the employees who have the **highest salary in their department** (all of them, if several tie). Return \`Department\` (the department's name), \`Employee\` (the employee's name) and \`Salary\`. Any order.`,
    schema: `CREATE TABLE Employee (id INT PRIMARY KEY, name VARCHAR(255), salary INT, departmentId INT);
CREATE TABLE Department (id INT PRIMARY KEY, name VARCHAR(255));`,
    data: `INSERT INTO Department VALUES (1, 'IT'), (2, 'Sales'), (3, 'Ops'), (4, 'Legal');
INSERT INTO Employee VALUES (1, 'Anya', 85000, 1), (2, 'Boris', 92000, 1), (3, 'Chen', 92000, 1), (4, 'Dale', 70000, 1),
  (5, 'Emil', 60000, 2), (6, 'Faye', 75000, 2), (7, 'Gus', 50000, 3);`,
    tests: [
      { name: "A whole department tied", data: `INSERT INTO Department VALUES (1, 'Art'), (2, 'Law'); INSERT INTO Employee VALUES (1, 'Xia', 100, 1), (2, 'Yan', 100, 1), (3, 'Zak', 100, 1), (4, 'Wu', 50, 2);` },
    ],
    hints: [
      'First compute the maximum salary per department.',
      'Then keep employees whose (department, salary) pair matches — ties included.',
      'Join Department for the name.',
    ],
    solution: {
      sql: `SELECT d.name AS Department, e.name AS Employee, e.salary AS Salary
FROM Employee e
JOIN Department d ON d.id = e.departmentId
WHERE (e.departmentId, e.salary) IN (
  SELECT departmentId, MAX(salary)
  FROM Employee
  GROUP BY departmentId
);`,
      explain: 'The tuple IN keeps everyone who equals their department\'s maximum, so Boris and Chen both appear.',
    },
    alternatives: [
      {
        title: 'Correlated subquery',
        sql: `SELECT d.name AS Department, e.name AS Employee, e.salary AS Salary
FROM Employee e
JOIN Department d ON d.id = e.departmentId
WHERE e.salary = (SELECT MAX(x.salary) FROM Employee x WHERE x.departmentId = e.departmentId);`,
        explain: 'For each employee, compare with the max of their own department.',
      },
      {
        title: 'Window function',
        sql: `SELECT Department, Employee, Salary
FROM (
  SELECT d.name AS Department, e.name AS Employee, e.salary AS Salary,
         RANK() OVER (PARTITION BY e.departmentId ORDER BY e.salary DESC) AS rnk
  FROM Employee e
  JOIN Department d ON d.id = e.departmentId
) t
WHERE rnk = 1;`,
        explain: 'RANK gives tied top earners rank 1 (Module 9).',
      },
    ],
    traps: [
      { sql: `SELECT d.name AS Department, e.name AS Employee, MAX(e.salary) AS Salary FROM Employee e JOIN Department d ON d.id = e.departmentId GROUP BY d.id, d.name;`, why: 'MySQL rejects `e.name` here (ONLY_FULL_GROUP_BY); engines that allow it pick an arbitrary name — and one row per department cannot show ties.' },
      { sql: `SELECT d.name AS Department, e.name AS Employee, e.salary AS Salary FROM Employee e JOIN Department d ON d.id = e.departmentId ORDER BY e.salary DESC LIMIT 1;`, why: 'Finds the single highest salary overall, not per department.' },
    ],
  },
  {
    id: 1070,
    module: 'subqueries',
    sql50: true,
    patterns: ['first year per group', 'tuple IN'],
    task: `For each product, find the **first year** it was sold and return **every** sale of that product in that year: \`product_id\`, \`first_year\`, \`quantity\`, \`price\`. A product can have several sales in one year. Any order.`,
    schema: `CREATE TABLE Sales (sale_id INT, product_id INT, year INT, quantity INT, price INT, PRIMARY KEY (sale_id, year));`,
    data: `INSERT INTO Sales VALUES (1, 10, 2019, 5, 100), (2, 10, 2018, 3, 90), (3, 10, 2018, 4, 95), (4, 20, 2020, 1, 300), (5, 20, 2021, 2, 310), (6, 30, 2022, 7, 55);`,
    tests: [
      { name: "Several sales in the first year", data: `INSERT INTO Sales VALUES (1, 7, 2016, 1, 10), (2, 7, 2015, 2, 20), (3, 7, 2015, 3, 30), (4, 8, 2030, 5, 50);` },
    ],
    hints: ['Find each product\'s minimum year.', 'Keep the sales whose (product, year) is that minimum — possibly several rows.'],
    solution: {
      sql: `SELECT product_id, year AS first_year, quantity, price
FROM Sales
WHERE (product_id, year) IN (
  SELECT product_id, MIN(year)
  FROM Sales
  GROUP BY product_id
);`,
      explain: 'Product 10 sold twice in its first year (2018); both rows come back because the filter matches on (product, year), not on a single row.',
    },
    alternatives: [
      {
        title: 'RANK',
        sql: `SELECT product_id, year AS first_year, quantity, price
FROM (
  SELECT s.*, RANK() OVER (PARTITION BY product_id ORDER BY year) AS rnk
  FROM Sales s
) t
WHERE rnk = 1;`,
        explain: 'Rank sales by year within each product; every sale of the first year gets rank 1.',
      },
    ],
    traps: [
      { sql: `SELECT product_id, MIN(year) AS first_year, quantity, price FROM Sales GROUP BY product_id;`, why: 'MySQL rejects `quantity`/`price` here (ONLY_FULL_GROUP_BY); and one row per product loses the second 2018 sale.' },
    ],
  },
  {
    id: 550,
    module: 'subqueries',
    sql50: true,
    patterns: ['first event per user', 'next-day retention'],
    task: `Report the **fraction** of players who logged in again on the day right after their **first** login, rounded to 2 decimals: (players with a login on first_login + 1 day) ÷ (all players). Return one column, \`fraction\`.`,
    schema: `CREATE TABLE Activity (player_id INT, device_id INT, event_date DATE, games_played INT, PRIMARY KEY (player_id, event_date));`,
    data: `INSERT INTO Activity VALUES
  (1, 2, '2024-03-01', 5), (1, 2, '2024-03-02', 6),
  (2, 3, '2024-06-25', 1), (2, 3, '2024-06-27', 2),
  (3, 1, '2024-03-02', 0), (3, 4, '2024-07-03', 5), (3, 4, '2024-07-04', 1),
  (4, 1, '2024-01-01', 3),
  (5, 2, '2024-12-31', 4), (5, 2, '2025-01-01', 2),
  (6, 1, '2024-05-05', 1), (6, 1, '2024-05-04', 2),
  (7, 5, '2024-08-08', 9);`,
    tests: [
      { name: "Only a leap-day return", data: `INSERT INTO Activity VALUES (1, 1, '2024-01-01', 1), (1, 1, '2024-01-03', 1), (2, 1, '2024-02-01', 1), (3, 1, '2024-02-28', 1), (3, 1, '2024-02-29', 1);` },
    ],
    hints: [
      'Find each player\'s first login date (MIN per player).',
      'Then check whether the same player has a row on that date + 1 day.',
      'Divide by the number of players, not the number of rows.',
    ],
    solution: {
      sql: `SELECT ROUND(COUNT(a.player_id) / COUNT(f.player_id), 2) AS fraction
FROM (
  SELECT player_id, MIN(event_date) AS first_day
  FROM Activity
  GROUP BY player_id
) f
LEFT JOIN Activity a
       ON a.player_id = f.player_id
      AND a.event_date = DATE_ADD(f.first_day, INTERVAL 1 DAY);`,
      explain: 'The derived table has one row per player. The LEFT JOIN finds a next-day login if there is one, so `COUNT(a.player_id)` counts retained players and `COUNT(f.player_id)` counts all players. Player 3 logs in on consecutive days later on, but not right after the first login.',
    },
    alternatives: [
      {
        title: 'Tuple IN',
        sql: `SELECT ROUND(
  (SELECT COUNT(*) FROM Activity
   WHERE (player_id, DATE_SUB(event_date, INTERVAL 1 DAY)) IN
         (SELECT player_id, MIN(event_date) FROM Activity GROUP BY player_id))
  / (SELECT COUNT(DISTINCT player_id) FROM Activity), 2) AS fraction;`,
        explain: 'A row counts if "the day before it" was that player\'s first login day.',
      },
    ],
    traps: [
      { sql: `SELECT ROUND(COUNT(DISTINCT a.player_id) / (SELECT COUNT(DISTINCT player_id) FROM Activity), 2) AS fraction FROM Activity a JOIN Activity b ON b.player_id = a.player_id AND DATEDIFF(b.event_date, a.event_date) = 1;`, why: 'Counts players with *any* two consecutive days — player 3 qualifies later on, but not after the first login.' },
    ],
  },
  {
    id: 1174,
    module: 'subqueries',
    sql50: true,
    patterns: ['first event per user', 'percentage'],
    task: `An order is **immediate** if \`customer_pref_delivery_date\` equals \`order_date\`. A customer's **first order** is the one with the earliest \`order_date\` (there is exactly one). Return \`immediate_percentage\`: the percentage of customers whose first order was immediate, rounded to 2 decimals.`,
    schema: `CREATE TABLE Delivery (delivery_id INT PRIMARY KEY, customer_id INT, order_date DATE, customer_pref_delivery_date DATE);`,
    data: `INSERT INTO Delivery VALUES
  (1, 1, '2024-08-01', '2024-08-01'), (2, 1, '2024-08-05', '2024-08-07'),
  (3, 2, '2024-08-02', '2024-08-03'), (4, 2, '2024-08-10', '2024-08-10'),
  (5, 3, '2024-08-03', '2024-08-03'),
  (6, 4, '2024-08-09', '2024-08-11'),
  (7, 5, '2024-08-07', '2024-08-07'), (8, 5, '2024-08-06', '2024-08-08'),
  (9, 6, '2024-08-12', '2024-08-12'),
  (10, 7, '2024-08-15', '2024-08-18');`,
    tests: [
      { name: "Only first orders are immediate", data: `INSERT INTO Delivery VALUES (1, 1, '2024-01-01', '2024-01-01'), (2, 1, '2024-01-02', '2024-01-05'), (3, 2, '2024-01-03', '2024-01-03');` },
    ],
    hints: [
      'Restrict to each customer\'s first order: (customer_id, MIN(order_date)).',
      'Then the percentage of those orders where the two dates are equal.',
      'Do not assume the smallest delivery_id is the first order.',
    ],
    solution: {
      sql: `SELECT ROUND(100 * AVG(order_date = customer_pref_delivery_date), 2) AS immediate_percentage
FROM Delivery
WHERE (customer_id, order_date) IN (
  SELECT customer_id, MIN(order_date)
  FROM Delivery
  GROUP BY customer_id
);`,
      explain: 'The tuple IN keeps one row per customer (their first order); `AVG(condition)` gives the immediate fraction. 3 of 7 first orders are immediate.',
    },
    alternatives: [
      {
        title: 'ROW_NUMBER',
        sql: `SELECT ROUND(100 * AVG(order_date = customer_pref_delivery_date), 2) AS immediate_percentage
FROM (
  SELECT d.*, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date) AS rn
  FROM Delivery d
) t
WHERE rn = 1;`,
        explain: 'Number each customer\'s orders by date and keep the first.',
      },
    ],
    traps: [
      { sql: `SELECT ROUND(100 * AVG(order_date = customer_pref_delivery_date), 2) AS immediate_percentage FROM Delivery;`, why: 'Uses all orders instead of only first orders.' },
      { sql: `SELECT ROUND(100 * AVG(order_date = customer_pref_delivery_date), 2) AS immediate_percentage FROM Delivery WHERE delivery_id IN (SELECT MIN(delivery_id) FROM Delivery GROUP BY customer_id);`, why: 'Assumes ids follow dates. Customer 5\'s smallest id is not their earliest order.' },
    ],
  },
  {
    id: 1164,
    module: 'subqueries',
    sql50: true,
    patterns: ['latest value as of a date', 'default value'],
    task: `Every product starts at price **10**; each row of \`Products\` changes a product's price from \`change_date\` on. Return \`product_id\` and \`price\` for **every** product as of **2019-08-16** (a change made on that date counts). Any order.`,
    schema: `CREATE TABLE Products (product_id INT, new_price INT, change_date DATE, PRIMARY KEY (product_id, change_date));`,
    data: `INSERT INTO Products VALUES
  (1, 60, '2019-08-14'), (1, 35, '2019-08-16'), (1, 50, '2019-08-17'),
  (2, 40, '2019-08-10'), (2, 70, '2019-08-20'),
  (3, 99, '2019-08-18'),
  (4, 12, '2019-08-15');`,
    tests: [
      { name: "Only future changes, and one on the day", data: `INSERT INTO Products VALUES (1, 20, '2019-08-17'), (2, 30, '2019-08-16'), (3, 40, '2019-01-01'), (3, 45, '2019-12-31');` },
    ],
    hints: [
      'For each product, the latest change on or before 2019-08-16 decides the price.',
      'That is the change with MAX(change_date) among those dates — not MAX(new_price).',
      'Products with no change by then are still 10: don\'t lose them.',
    ],
    solution: {
      sql: `SELECT p.product_id,
       IFNULL(x.new_price, 10) AS price
FROM (SELECT DISTINCT product_id FROM Products) p
LEFT JOIN Products x
       ON x.product_id = p.product_id
      AND x.change_date = (SELECT MAX(y.change_date)
                           FROM Products y
                           WHERE y.product_id = p.product_id
                             AND y.change_date <= '2019-08-16');`,
      explain: 'Start from the list of all products so none is lost, attach the latest change on or before the date, and default to 10 where there is none (product 3).',
    },
    alternatives: [
      {
        title: 'UNION of the two cases',
        sql: `SELECT product_id, new_price AS price
FROM Products
WHERE (product_id, change_date) IN (
  SELECT product_id, MAX(change_date)
  FROM Products
  WHERE change_date <= '2019-08-16'
  GROUP BY product_id
)
UNION ALL
SELECT product_id, 10 AS price
FROM Products
GROUP BY product_id
HAVING MIN(change_date) > '2019-08-16';`,
        explain: 'Products that changed by the date get their latest price; products whose first change is later get 10. The two sets never overlap, so UNION ALL is fine.',
      },
    ],
    traps: [
      { sql: `SELECT product_id, new_price AS price FROM Products WHERE (product_id, change_date) IN (SELECT product_id, MAX(change_date) FROM Products WHERE change_date < '2019-08-16' GROUP BY product_id) UNION ALL SELECT product_id, 10 FROM Products GROUP BY product_id HAVING MIN(change_date) >= '2019-08-16';`, why: 'Ignores the change made on 2019-08-16 itself.' },
      { sql: `SELECT product_id, MAX(new_price) AS price FROM Products WHERE change_date <= '2019-08-16' GROUP BY product_id;`, why: 'Takes the highest price, not the latest one — and drops products with no change yet.' },
    ],
  },
  {
    id: 585,
    module: 'subqueries',
    sql50: true,
    patterns: ['IN with GROUP BY HAVING', 'uniqueness test'],
    task: `Return \`tiv_2016\`: the sum of \`tiv_2016\` (rounded to 2 decimals) over policies that

- share their \`tiv_2015\` value with **at least one other** policy, **and**
- are the **only** policy at their location — no other policy has the same (\`lat\`, \`lon\`) pair.`,
    schema: `CREATE TABLE Insurance (pid INT PRIMARY KEY, tiv_2015 FLOAT, tiv_2016 FLOAT, lat FLOAT, lon FLOAT);`,
    data: `INSERT INTO Insurance VALUES
  (1, 100, 15.5, 1.0, 1.0), (2, 200, 30.0, 2.0, 2.0), (3, 100, 40.25, 3.0, 3.0), (4, 300, 55.0, 4.0, 4.0),
  (5, 100, 12.0, 5.0, 5.0), (6, 300, 99.0, 3.0, 3.0), (7, 200, 10.0, 1.0, 9.0);`,
    tests: [
      { name: "A shared location beats a shared value", data: `INSERT INTO Insurance VALUES (1, 50, 1.5, 10, 10), (2, 50, 2.25, 20, 20), (3, 60, 4.0, 30, 30), (4, 50, 8.0, 20, 20);` },
    ],
    hints: [
      'Condition 1: tiv_2015 is in the set of values that occur more than once.',
      'Condition 2: (lat, lon) is in the set of pairs that occur exactly once — compare the pair, not lat alone.',
    ],
    solution: {
      sql: `SELECT ROUND(SUM(tiv_2016), 2) AS tiv_2016
FROM Insurance
WHERE tiv_2015 IN (SELECT tiv_2015 FROM Insurance GROUP BY tiv_2015 HAVING COUNT(*) > 1)
  AND (lat, lon) IN (SELECT lat, lon FROM Insurance GROUP BY lat, lon HAVING COUNT(*) = 1);`,
      explain: 'Each subquery turns a "compared with every other row" condition into a set membership test built with GROUP BY + HAVING.',
    },
    alternatives: [
      {
        title: 'Window counts',
        sql: `SELECT ROUND(SUM(tiv_2016), 2) AS tiv_2016
FROM (
  SELECT tiv_2016,
         COUNT(*) OVER (PARTITION BY tiv_2015) AS same_tiv,
         COUNT(*) OVER (PARTITION BY lat, lon) AS same_place
  FROM Insurance
) t
WHERE same_tiv > 1 AND same_place = 1;`,
        explain: 'Annotate each row with how many rows share its value/location, then filter (Module 9).',
      },
    ],
    traps: [
      { sql: `SELECT ROUND(SUM(tiv_2016), 2) AS tiv_2016 FROM Insurance WHERE tiv_2015 IN (SELECT tiv_2015 FROM Insurance GROUP BY tiv_2015 HAVING COUNT(*) > 1) AND lat IN (SELECT lat FROM Insurance GROUP BY lat HAVING COUNT(*) = 1);`, why: 'Checks latitude alone; policy 1 and 7 share a latitude but are at different locations.' },
      { sql: `SELECT ROUND(SUM(tiv_2016), 2) AS tiv_2016 FROM Insurance WHERE tiv_2015 IN (SELECT tiv_2015 FROM Insurance GROUP BY tiv_2015 HAVING COUNT(*) > 1);`, why: 'Forgets the unique-location condition.' },
    ],
  },
  {
    id: 608,
    module: 'subqueries',
    patterns: ['CASE with IN', 'tree'],
    task: `\`Tree\` stores a valid tree as (\`id\`, \`p_id\` = parent id). Label each node: \`'Root'\` (no parent), \`'Inner'\` (has a parent and at least one child) or \`'Leaf'\` (has a parent, no children). Return \`id\` and \`type\`. Any order.`,
    schema: `CREATE TABLE Tree (id INT PRIMARY KEY, p_id INT);`,
    data: `INSERT INTO Tree VALUES (1, NULL), (2, 1), (3, 1), (4, 3), (5, 3), (6, 5), (7, 2);`,
    tests: [{ name: 'A single node', data: `INSERT INTO Tree VALUES (1, NULL);` }],
    hints: [
      'Root: `p_id IS NULL`. Check it first — a lone root has no children but is still Root.',
      'Inner: the node\'s id appears as someone\'s p_id.',
      'Careful with `NOT IN (SELECT p_id …)`: the root\'s p_id is NULL.',
    ],
    solution: {
      sql: `SELECT id,
       CASE
         WHEN p_id IS NULL                    THEN 'Root'
         WHEN id IN (SELECT p_id FROM Tree)   THEN 'Inner'
         ELSE 'Leaf'
       END AS type
FROM Tree;`,
      explain: 'CASE checks in order. `id IN (…)` is TRUE if the node is anyone\'s parent; when it is not, IN yields UNKNOWN (because of the NULL), which CASE treats as "no" — so ELSE labels it Leaf.',
    },
    alternatives: [
      {
        title: 'LEFT JOIN children',
        sql: `SELECT t.id,
       CASE
         WHEN t.p_id IS NULL THEN 'Root'
         WHEN COUNT(c.id) > 0 THEN 'Inner'
         ELSE 'Leaf'
       END AS type
FROM Tree t
LEFT JOIN Tree c ON c.p_id = t.id
GROUP BY t.id, t.p_id;`,
        explain: 'Count each node\'s children with a self-join.',
      },
    ],
    traps: [
      { sql: `SELECT id, CASE WHEN p_id IS NULL THEN 'Root' WHEN id NOT IN (SELECT p_id FROM Tree) THEN 'Leaf' ELSE 'Inner' END AS type FROM Tree;`, why: 'The root\'s NULL p_id makes `NOT IN` UNKNOWN for every node, so no node is ever labelled Leaf.' },
      { sql: `SELECT id, CASE WHEN id NOT IN (SELECT p_id FROM Tree WHERE p_id IS NOT NULL) THEN 'Leaf' WHEN p_id IS NULL THEN 'Root' ELSE 'Inner' END AS type FROM Tree;`, why: 'Checks Leaf before Root, so a single-node tree is labelled Leaf.' },
    ],
  },
  {
    id: 1633,
    module: 'subqueries',
    sql50: true,
    order: true,
    patterns: ['scalar subquery denominator'],
    task: `For each contest, return \`contest_id\` and \`percentage\`: the share of **all users** who registered for it, rounded to 2 decimals. Order by \`percentage\` descending, then \`contest_id\` ascending.`,
    schema: `CREATE TABLE Users (user_id INT PRIMARY KEY, user_name VARCHAR(20));
CREATE TABLE Register (contest_id INT, user_id INT, PRIMARY KEY (contest_id, user_id));`,
    data: `INSERT INTO Users VALUES (1, 'Ama'), (2, 'Bo'), (3, 'Cleo'), (4, 'Dmitri'), (5, 'Esi'), (6, 'Femi'), (7, 'Gael');
INSERT INTO Register VALUES
  (208, 1), (208, 2), (208, 3), (208, 4), (208, 5), (208, 6),
  (209, 1), (209, 2), (209, 5), (209, 6),
  (210, 2), (210, 3), (210, 4), (210, 6),
  (211, 5),
  (212, 1), (212, 3);`,
    tests: [
      { name: "A full house and a tie", data: `INSERT INTO Users VALUES (1, 'Ana'), (2, 'Bo'), (3, 'Cy'); INSERT INTO Register VALUES (5, 1), (5, 2), (5, 3), (3, 1), (4, 2);` },
    ],
    hints: ['The denominator is the number of users in `Users` — including users who never registered.', 'Get it with a scalar subquery.'],
    solution: {
      sql: `SELECT contest_id,
       ROUND(100 * COUNT(user_id) / (SELECT COUNT(*) FROM Users), 2) AS percentage
FROM Register
GROUP BY contest_id
ORDER BY percentage DESC, contest_id;`,
      explain: 'Per contest, registrations ÷ total users. Gael never registered but still counts in the denominator.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT contest_id, ROUND(100 * COUNT(user_id) / (SELECT COUNT(DISTINCT user_id) FROM Register), 2) AS percentage FROM Register GROUP BY contest_id ORDER BY percentage DESC, contest_id;`, why: 'Divides by users who registered somewhere, missing users who never registered.' },
    ],
  },
  {
    id: 619,
    module: 'subqueries',
    sql50: true,
    patterns: ['NULL when empty', 'aggregate over a derived table'],
    task: `A *single number* appears exactly once in \`MyNumbers\` (which may contain duplicates). Return the **largest** single number in a column \`num\`, or a single NULL if there is none.`,
    schema: `CREATE TABLE MyNumbers (num INT);`,
    data: `INSERT INTO MyNumbers VALUES (12), (12), (4), (4), (2), (7), (9), (10), (10);`,
    tests: [{ name: 'Every number repeats', data: `INSERT INTO MyNumbers VALUES (2), (2), (7), (7);` }],
    hints: ['Find the numbers that occur once (GROUP BY + HAVING).', 'Take their MAX — an aggregate returns NULL when nothing qualifies.'],
    solution: {
      sql: `SELECT MAX(num) AS num
FROM (
  SELECT num
  FROM MyNumbers
  GROUP BY num
  HAVING COUNT(*) = 1
) t;`,
      explain: 'The derived table lists singles; MAX over it returns the largest, or NULL over an empty table — exactly the required "one row, possibly NULL".',
    },
    alternatives: [
      {
        title: 'Scalar subquery with LIMIT',
        sql: `SELECT (
  SELECT num FROM MyNumbers
  GROUP BY num HAVING COUNT(*) = 1
  ORDER BY num DESC LIMIT 1
) AS num;`,
        explain: 'Same "wrap it to get NULL" trick as #176.',
      },
    ],
    traps: [
      { sql: `SELECT num FROM MyNumbers GROUP BY num HAVING COUNT(*) = 1 ORDER BY num DESC LIMIT 1;`, why: 'Returns no row at all when there is no single number, instead of NULL.' },
      { sql: `SELECT MAX(num) AS num FROM MyNumbers;`, why: 'The largest number overall (12) appears twice.' },
    ],
  },
  {
    id: 626,
    module: 'subqueries',
    sql50: true,
    order: true,
    patterns: ['CASE on id parity', 'edge case: odd count'],
    task: `Seat ids run 1, 2, 3, … without gaps. Swap the students in every pair of consecutive seats (1↔2, 3↔4, …). If the number of students is odd, the last one stays put. Return \`id\` and \`student\`, ordered by \`id\`.`,
    schema: `CREATE TABLE Seat (id INT PRIMARY KEY, student VARCHAR(20));`,
    data: `INSERT INTO Seat VALUES (1, 'Ines'), (2, 'Jonas'), (3, 'Kira'), (4, 'Lior'), (5, 'Mateo');`,
    tests: [
      { name: 'Even number of students', data: `INSERT INTO Seat VALUES (1, 'Ana'), (2, 'Bo'), (3, 'Cy'), (4, 'Di');` },
      { name: 'A single student', data: `INSERT INTO Seat VALUES (1, 'Solo');` },
    ],
    hints: [
      'It is easier to move the ids than the names: odd ids +1, even ids −1.',
      'Exception: the last id, when it is odd, stays the same. How many seats are there? A scalar subquery can tell you.',
    ],
    solution: {
      sql: `SELECT CASE
         WHEN id % 2 = 1 AND id = (SELECT COUNT(*) FROM Seat) THEN id
         WHEN id % 2 = 1 THEN id + 1
         ELSE id - 1
       END AS id,
       student
FROM Seat
ORDER BY id;`,
      explain: 'Renumbering the ids and sorting by the new id swaps each pair. `ORDER BY id` refers to the computed alias (MySQL prefers the alias in ORDER BY).',
    },
    alternatives: [
      {
        title: 'LEAD / LAG',
        sql: `SELECT id,
       CASE
         WHEN id % 2 = 1 THEN COALESCE(LEAD(student) OVER (ORDER BY id), student)
         ELSE LAG(student) OVER (ORDER BY id)
       END AS student
FROM Seat
ORDER BY id;`,
        explain: 'Keep the ids and fetch the neighbour\'s name instead; COALESCE keeps the last student when there is no next row.',
      },
    ],
    traps: [
      { sql: `SELECT CASE WHEN id % 2 = 1 THEN id + 1 ELSE id - 1 END AS id, student FROM Seat ORDER BY id;`, why: 'With an odd number of students the last one moves to a seat that does not exist.' },
    ],
  },
];
