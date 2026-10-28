// Module 5: joins
export default [
  {
    id: 175,
    module: 'joins',
    patterns: ['LEFT JOIN'],
    task: `Report \`firstName\`, \`lastName\`, \`city\` and \`state\` for **every** person in \`Person\`. People without a row in \`Address\` still appear, with NULL \`city\` and \`state\`. Any order.`,
    schema: `CREATE TABLE Person (personId INT PRIMARY KEY, lastName VARCHAR(255), firstName VARCHAR(255));
CREATE TABLE Address (addressId INT PRIMARY KEY, personId INT, city VARCHAR(255), state VARCHAR(255));`,
    data: `INSERT INTO Person VALUES (1, 'Rossi', 'Marco'), (2, 'Okafor', 'Ada'), (3, 'Silva', 'Joao'), (4, 'Kim', 'Ji');
INSERT INTO Address VALUES (1, 2, 'Lagos', 'LA'), (2, 3, 'Porto', 'PO'), (3, 9, 'Nowhere', 'NW');`,
    tests: [
      { name: "Nobody has an address", data: `INSERT INTO Person VALUES (1, 'Wang', 'Allen'), (2, 'Alice', 'Bob');` },
    ],
    hints: ['Every person must appear, matched or not.', 'That is a LEFT JOIN with Person on the left.'],
    solution: {
      sql: `SELECT p.firstName, p.lastName, a.city, a.state
FROM Person p
LEFT JOIN Address a ON a.personId = p.personId;`,
      explain: 'LEFT JOIN keeps every Person row; where no address matches, the Address columns are NULL. The address for person 9 (who does not exist) is ignored.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT p.firstName, p.lastName, a.city, a.state FROM Person p JOIN Address a ON a.personId = p.personId;`, why: 'An inner join drops people without an address.' },
      { sql: `SELECT p.firstName, p.lastName, a.city, a.state FROM Person p RIGHT JOIN Address a ON a.personId = p.personId;`, why: 'RIGHT JOIN keeps every address instead — including one whose person does not exist — and drops people without addresses.' },
    ],
  },
  {
    id: 1378,
    module: 'joins',
    sql50: true,
    patterns: ['LEFT JOIN'],
    task: `Show \`unique_id\` and \`name\` for every employee. If an employee has no unique id, show NULL. Any order.`,
    schema: `CREATE TABLE Employees (id INT PRIMARY KEY, name VARCHAR(20));
CREATE TABLE EmployeeUNI (id INT, unique_id INT, PRIMARY KEY (id, unique_id));`,
    data: `INSERT INTO Employees VALUES (1, 'Lena'), (4, 'Theo'), (9, 'Priya'), (12, 'Omar'), (15, 'Zoe');
INSERT INTO EmployeeUNI VALUES (4, 1), (12, 2), (15, 3), (20, 4);`,
    tests: [
      { name: "Nobody has a unique id", data: `INSERT INTO Employees VALUES (1, 'Ana'), (2, 'Bo');` },
    ],
    hints: ['Every employee appears, so Employees is the preserved (left) side.', 'Put the columns in the requested order: `unique_id` first, then `name`.'],
    solution: {
      sql: `SELECT u.unique_id, e.name
FROM Employees e
LEFT JOIN EmployeeUNI u ON u.id = e.id;`,
      explain: 'Column order in SELECT is independent of join order: the left table decides which rows survive, the SELECT list decides the shape.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT u.unique_id, e.name FROM Employees e JOIN EmployeeUNI u ON u.id = e.id;`, why: 'Drops employees without a unique id.' },
    ],
  },
  {
    id: 1068,
    module: 'joins',
    sql50: true,
    patterns: ['INNER JOIN'],
    task: `For every row of \`Sales\`, report the \`product_name\` (from \`Product\`), \`year\` and \`price\`. Any order.`,
    schema: `CREATE TABLE Sales (sale_id INT, product_id INT, year INT, quantity INT, price INT, PRIMARY KEY (sale_id, year));
CREATE TABLE Product (product_id INT PRIMARY KEY, product_name VARCHAR(10));`,
    data: `INSERT INTO Product VALUES (10, 'Kettle'), (20, 'Toaster'), (30, 'Blender');
INSERT INTO Sales VALUES (3, 20, 2021, 4, 80), (5, 10, 2022, 9, 45), (6, 10, 2023, 2, 48), (9, 30, 2023, 6, 130);`,
    tests: [
      { name: "A product that never sold", data: `INSERT INTO Product VALUES (1, 'Fan'), (2, 'Heater'); INSERT INTO Sales VALUES (1, 1, 2019, 1, 10), (2, 1, 2020, 1, 12), (3, 1, 2021, 1, 15);` },
    ],
    hints: ['Look up each sale\'s product name through `product_id`.', 'Every sale has a product, so a plain (inner) JOIN is enough.'],
    solution: {
      sql: `SELECT p.product_name, s.year, s.price
FROM Sales s
JOIN Product p ON p.product_id = s.product_id;`,
      explain: 'A plain lookup join: every sale has a product (it is a foreign key), so INNER and LEFT give the same result here.',
    },
    alternatives: [
      {
        title: 'USING',
        sql: `SELECT product_name, year, price
FROM Sales
JOIN Product USING (product_id);`,
        explain: '`USING (col)` is shorthand when the key has the same name in both tables.',
      },
    ],
    traps: [
      { sql: `SELECT p.product_name, s.year, s.price FROM Sales s, Product p;`, why: 'Without a join condition every sale is paired with every product (a cross join).' },
      { sql: `SELECT p.product_name, s.year, s.price FROM Product p LEFT JOIN Sales s ON s.product_id = p.product_id;`, why: 'Starting from Product also lists products that never sold, with NULL year and price. The task wants one row per sale.' },
    ],
  },
  {
    id: 181,
    module: 'joins',
    patterns: ['self-join'],
    task: `Find the employees who earn **more** than their manager. Return their names in a column called \`Employee\`. Any order.`,
    schema: `CREATE TABLE Employee (id INT PRIMARY KEY, name VARCHAR(255), salary INT, managerId INT);`,
    data: `INSERT INTO Employee VALUES (1, 'Iris', 120000, NULL), (2, 'Jonas', 95000, 1), (3, 'Kemal', 100000, 2), (4, 'Lea', 90000, 2), (5, 'Milo', 95000, 2), (6, 'Nia', 130000, 1);`,
    tests: [
      { name: "Managers missing from the table", data: `INSERT INTO Employee VALUES (1, 'Ann', 50000, NULL), (2, 'Bob', 60000, 7), (3, 'Cid', 70000, 1), (4, 'Dee', 50000, 1);` },
    ],
    hints: ['Join the table to itself: one copy for the employee, one for the manager.', 'Match `e.managerId = m.id`, then compare the two salaries.'],
    solution: {
      sql: `SELECT e.name AS Employee
FROM Employee e
JOIN Employee m ON m.id = e.managerId
WHERE e.salary > m.salary;`,
      explain: 'Aliases `e` and `m` are two roles for the same table. Employees without a manager have no match and drop out, which is right: they cannot out-earn a manager.',
    },
    alternatives: [
      {
        title: 'Correlated subquery',
        sql: `SELECT name AS Employee
FROM Employee e
WHERE salary > (SELECT m.salary FROM Employee m WHERE m.id = e.managerId);`,
        explain: 'For each employee, look up the manager\'s salary. If there is no manager the subquery is NULL and the comparison is not TRUE.',
      },
    ],
    traps: [
      { sql: `SELECT e.name AS Employee FROM Employee e JOIN Employee m ON m.id = e.managerId WHERE e.salary >= m.salary;`, why: '`>=` also returns employees who earn exactly as much as their manager.' },
      { sql: `SELECT m.name AS Employee FROM Employee e JOIN Employee m ON m.id = e.managerId WHERE e.salary > m.salary;`, why: 'Returns the managers\' names instead of the employees\'.' },
    ],
  },
  {
    id: 183,
    module: 'joins',
    patterns: ['anti-join'],
    task: `Return the names of customers who **never** placed an order, in a column called \`Customers\`. Any order.`,
    schema: `CREATE TABLE Customers (id INT PRIMARY KEY, name VARCHAR(255));
CREATE TABLE Orders (id INT PRIMARY KEY, customerId INT);`,
    data: `INSERT INTO Customers VALUES (1, 'Aria'), (2, 'Bea'), (3, 'Cole'), (4, 'Dev'), (5, 'Eve');
INSERT INTO Orders VALUES (1, 3), (2, 1), (3, 3);`,
    tests: [
      {
        name: 'An order with no customer id',
        data: `INSERT INTO Customers VALUES (1, 'Aria'), (2, 'Bea'), (3, 'Cole');
INSERT INTO Orders VALUES (1, 1), (2, NULL);`,
      },
    ],
    hints: ['Customers with no matching order: a LEFT JOIN where the order side is NULL.', 'NOT IN is fragile if the subquery can return NULL — check the hidden test.'],
    solution: {
      sql: `SELECT c.name AS Customers
FROM Customers c
LEFT JOIN Orders o ON o.customerId = c.id
WHERE o.id IS NULL;`,
      explain: 'The classic anti-join: keep customers, attach orders if any, then keep only the rows where no order attached. Test the right table\'s primary key, which is never NULL in a real match.',
    },
    alternatives: [
      {
        title: 'NOT EXISTS',
        sql: `SELECT name AS Customers
FROM Customers c
WHERE NOT EXISTS (SELECT 1 FROM Orders o WHERE o.customerId = c.id);`,
        explain: 'Reads exactly like the question and is immune to NULLs in `Orders.customerId`.',
      },
    ],
    traps: [
      { sql: `SELECT name AS Customers FROM Customers WHERE id NOT IN (SELECT customerId FROM Orders);`, why: 'Passes LeetCode\'s data, but returns nothing once any order has a NULL customerId (see the hidden test).' },
      { sql: `SELECT c.name AS Customers FROM Customers c JOIN Orders o ON o.customerId <> c.id;`, why: '"Not equal" pairs each customer with every other customer\'s orders — it does not find missing matches.' },
    ],
  },
  {
    id: 1581,
    module: 'joins',
    sql50: true,
    patterns: ['anti-join', 'GROUP BY'],
    task: `Some mall visits ended without any transaction. For each customer who had such visits, return \`customer_id\` and \`count_no_trans\` — the number of their visits with no transaction. Any order.`,
    schema: `CREATE TABLE Visits (visit_id INT PRIMARY KEY, customer_id INT);
CREATE TABLE Transactions (transaction_id INT PRIMARY KEY, visit_id INT, amount INT);`,
    data: `INSERT INTO Visits VALUES (1, 5), (2, 7), (3, 5), (4, 8), (5, 7), (6, 5), (7, 9);
INSERT INTO Transactions VALUES (100, 2, 50), (101, 2, 30), (102, 4, 20), (103, 6, 70);`,
    tests: [
      { name: "One customer ever left empty-handed", data: `INSERT INTO Visits VALUES (10, 1), (11, 1), (12, 2), (13, 3), (14, 3); INSERT INTO Transactions VALUES (1, 10, 5), (2, 11, 5), (3, 12, 5);` },
    ],
    hints: ['First find visits with no transaction (an anti-join).', 'Then count those visits per customer.'],
    solution: {
      sql: `SELECT v.customer_id, COUNT(*) AS count_no_trans
FROM Visits v
LEFT JOIN Transactions t ON t.visit_id = v.visit_id
WHERE t.transaction_id IS NULL
GROUP BY v.customer_id;`,
      explain: 'The WHERE keeps only unmatched visits (the anti-join), and each remaining row is exactly one visit, so `COUNT(*)` is right here.',
    },
    alternatives: [
      {
        title: 'NOT IN',
        sql: `SELECT customer_id, COUNT(*) AS count_no_trans
FROM Visits
WHERE visit_id NOT IN (SELECT visit_id FROM Transactions)
GROUP BY customer_id;`,
        explain: 'Fine when `Transactions.visit_id` can never be NULL; NOT EXISTS is the safer default.',
      },
    ],
    traps: [
      { sql: `SELECT v.customer_id, COUNT(*) AS count_no_trans FROM Visits v LEFT JOIN Transactions t ON t.visit_id = v.visit_id GROUP BY v.customer_id;`, why: 'Without the IS NULL filter every visit is counted — and visit 2 twice, once per transaction.' },
    ],
  },
  {
    id: 577,
    module: 'joins',
    sql50: true,
    patterns: ['LEFT JOIN', 'NULL in filters'],
    task: `Report \`name\` and \`bonus\` for every employee whose bonus is **less than 1000**, or who has **no bonus at all** (show NULL). Any order.`,
    schema: `CREATE TABLE Employee (empId INT PRIMARY KEY, name VARCHAR(255), supervisor INT, salary INT);
CREATE TABLE Bonus (empId INT PRIMARY KEY, bonus INT);`,
    data: `INSERT INTO Employee VALUES (1, 'Ava', NULL, 5000), (2, 'Ben', 1, 3000), (3, 'Cal', 1, 3500), (4, 'Dia', 2, 2000), (5, 'Eli', 2, 2500);
INSERT INTO Bonus VALUES (2, 500), (3, 1000), (4, 2000);`,
    tests: [
      { name: "Bonuses around 1000", data: `INSERT INTO Employee VALUES (1, 'Pat', NULL, 100), (2, 'Quin', 1, 100), (3, 'Rex', 1, 100), (4, 'Sid', 1, 100); INSERT INTO Bonus VALUES (1, 999), (2, 1000), (3, 1001);` },
    ],
    hints: ['Employees without a bonus row must appear — LEFT JOIN.', 'After the join, "no bonus" shows up as NULL. Does `bonus < 1000` keep NULL rows?'],
    solution: {
      sql: `SELECT e.name, b.bonus
FROM Employee e
LEFT JOIN Bonus b ON b.empId = e.empId
WHERE b.bonus < 1000 OR b.bonus IS NULL;`,
      explain: 'Here the WHERE on the right table is intended: we *want* to filter after the join, and `IS NULL` deliberately keeps the unmatched employees.',
    },
    alternatives: [
      {
        title: 'IFNULL',
        sql: `SELECT e.name, b.bonus
FROM Employee e
LEFT JOIN Bonus b ON b.empId = e.empId
WHERE IFNULL(b.bonus, 0) < 1000;`,
        explain: 'Treat "no bonus" as 0 for the comparison; the SELECT still shows NULL.',
      },
    ],
    traps: [
      { sql: `SELECT e.name, b.bonus FROM Employee e LEFT JOIN Bonus b ON b.empId = e.empId WHERE b.bonus < 1000;`, why: '`NULL < 1000` is UNKNOWN, so employees without a bonus are dropped.' },
      { sql: `SELECT e.name, b.bonus FROM Employee e LEFT JOIN Bonus b ON b.empId = e.empId WHERE b.bonus <= 1000 OR b.bonus IS NULL;`, why: 'A bonus of exactly 1000 is not less than 1000.' },
    ],
  },
  {
    id: 197,
    module: 'joins',
    sql50: true,
    patterns: ['self-join on dates', 'DATEDIFF'],
    task: `Return the \`id\` of every day whose \`temperature\` is higher than the **previous calendar day's**. A day whose previous day has no record does not count. Any order.`,
    schema: `CREATE TABLE Weather (id INT PRIMARY KEY, recordDate DATE, temperature INT);`,
    data: `INSERT INTO Weather VALUES
  (1, '2024-01-01', 10), (2, '2024-01-02', 25), (3, '2024-01-03', 20), (4, '2024-01-04', 30),
  (5, '2024-01-06', 35), (6, '2024-01-07', 30), (7, '2024-01-08', 31),
  (8, '2024-01-09', 12), (9, '2024-01-10', 15),
  (10, '2024-01-31', 5), (11, '2024-02-01', 8);`,
    tests: [
      { name: "A year boundary and a leap day", data: `INSERT INTO Weather VALUES (1, '2023-12-31', -5), (2, '2024-01-01', -3), (3, '2024-02-28', 0), (4, '2024-02-29', 1), (5, '2024-03-01', 1), (6, '2024-03-02', 2);` },
    ],
    hints: [
      'Pair each day with the day before it: a self-join.',
      'Ids are not dates — id 5 comes after id 4 but not the day after. Match on dates.',
      '`DATEDIFF(today, yesterday) = 1` works across month boundaries.',
    ],
    solution: {
      sql: `SELECT w.id
FROM Weather w
JOIN Weather y ON DATEDIFF(w.recordDate, y.recordDate) = 1
WHERE w.temperature > y.temperature;`,
      explain: 'Each row `w` is paired with the row exactly one day earlier. If that day is missing there is no partner, so the day is excluded — as required.',
    },
    alternatives: [
      {
        title: 'DATE_SUB',
        sql: `SELECT w.id
FROM Weather w
JOIN Weather y ON y.recordDate = DATE_SUB(w.recordDate, INTERVAL 1 DAY)
WHERE w.temperature > y.temperature;`,
        explain: 'Computing the date on one side lets MySQL use an index on `recordDate` for the lookup.',
      },
      {
        title: 'LAG with a gap check',
        sql: `SELECT id
FROM (
  SELECT id, recordDate, temperature,
         LAG(recordDate)  OVER (ORDER BY recordDate) AS prev_date,
         LAG(temperature) OVER (ORDER BY recordDate) AS prev_temp
  FROM Weather
) t
WHERE temperature > prev_temp
  AND DATEDIFF(recordDate, prev_date) = 1;`,
        explain: 'LAG gives the previous *row*; checking that it is also the previous *day* handles gaps (Module 9).',
      },
    ],
    traps: [
      { sql: `SELECT w.id FROM Weather w JOIN Weather y ON w.id = y.id + 1 WHERE w.temperature > y.temperature;`, why: 'Assumes ids follow dates day by day. Day 6 (id 5) has no previous day but would be compared with id 4.' },
      { sql: `SELECT id FROM (SELECT id, temperature, LAG(temperature) OVER (ORDER BY recordDate) AS prev_temp FROM Weather) t WHERE temperature > prev_temp;`, why: 'LAG looks at the previous row, which is not always the previous day.' },
      { sql: `SELECT w.id FROM Weather w JOIN Weather y ON w.recordDate - y.recordDate = 1 WHERE w.temperature > y.temperature;`, why: 'Subtracting two DATEs subtracts them as numbers in MySQL: 20240201 − 20240131 = 70, not 1. It works inside a month, then silently misses 1 February. Use DATEDIFF.' },
      { sql: `SELECT w.id FROM Weather w JOIN Weather y ON w.recordDate = y.recordDate + 1 WHERE w.temperature > y.temperature;`, why: 'Same problem: `recordDate + 1` is the number 20240132, not the next date, so the month boundary breaks.' },
    ],
  },
  {
    id: 1661,
    module: 'joins',
    sql50: true,
    patterns: ['self-join', 'AVG'],
    task: `Each process on a machine has a 'start' and an 'end' row with a float \`timestamp\` (seconds). For each \`machine_id\`, return \`processing_time\`: the average of (end − start) over its processes, rounded to **3 decimals**. Any order.`,
    schema: 'CREATE TABLE Activity (machine_id INT, process_id INT, activity_type ENUM(\'start\', \'end\'), `timestamp` FLOAT, PRIMARY KEY (machine_id, process_id, activity_type));',
    data: `INSERT INTO Activity VALUES
  (0, 0, 'start', 1.250), (0, 0, 'end', 2.000), (0, 1, 'start', 5.000), (0, 1, 'end', 5.500),
  (1, 0, 'start', 0.500), (1, 0, 'end', 1.500), (1, 1, 'start', 3.000), (1, 1, 'end', 3.250), (1, 2, 'start', 6.000), (1, 2, 'end', 8.125),
  (2, 0, 'start', 2.000), (2, 0, 'end', 2.125), (2, 1, 'start', 9.000), (2, 1, 'end', 9.875),
  (3, 0, 'start', 1.000), (3, 0, 'end', 2.000), (3, 1, 'start', 4.000), (3, 1, 'end', 5.000), (3, 2, 'start', 7.000), (3, 2, 'end', 8.125);`,
    tests: [
      { name: "Odd numbers of processes", data: `INSERT INTO Activity VALUES (5, 0, 'start', 0.5), (5, 0, 'end', 2.75), (5, 1, 'start', 1.0), (5, 1, 'end', 1.25), (5, 2, 'start', 3.0), (5, 2, 'end', 3.125), (6, 0, 'start', 0.0), (6, 0, 'end', 0.75);` },
    ],
    hints: ['Pair each start row with the end row of the same machine and process.', 'Average the differences per machine, then round to 3 places.'],
    solution: {
      sql: `SELECT s.machine_id,
       ROUND(AVG(e.timestamp - s.timestamp), 3) AS processing_time
FROM Activity s
JOIN Activity e
  ON e.machine_id = s.machine_id
 AND e.process_id = s.process_id
 AND e.activity_type = 'end'
WHERE s.activity_type = 'start'
GROUP BY s.machine_id;`,
      explain: 'The self-join turns two rows per process into one row with both timestamps; then it is a plain AVG per machine.',
    },
    alternatives: [
      {
        title: 'Signed sum without a join',
        sql: `SELECT machine_id,
       ROUND(SUM(IF(activity_type = 'end', timestamp, -timestamp)) / COUNT(DISTINCT process_id), 3) AS processing_time
FROM Activity
GROUP BY machine_id;`,
        explain: 'Ends minus starts is the total processing time; divide by the number of processes (not rows — each process has two).',
      },
    ],
    traps: [
      { sql: `SELECT s.machine_id, AVG(e.timestamp - s.timestamp) AS processing_time FROM Activity s JOIN Activity e ON e.machine_id = s.machine_id AND e.process_id = s.process_id AND e.activity_type = 'end' WHERE s.activity_type = 'start' GROUP BY s.machine_id;`, why: 'Not rounded to 3 decimals (machine 3 averages 1.041666…).' },
      { sql: `SELECT machine_id, ROUND(SUM(IF(activity_type = 'end', timestamp, -timestamp)) / COUNT(*), 3) AS processing_time FROM Activity GROUP BY machine_id;`, why: 'Divides by the number of rows, which is twice the number of processes.' },
    ],
  },
  {
    id: 1280,
    module: 'joins',
    sql50: true,
    order: true,
    patterns: ['CROSS JOIN grid', 'LEFT JOIN + COUNT'],
    task: `Every student takes every subject. For each (student, subject) pair, return \`student_id\`, \`student_name\`, \`subject_name\` and \`attended_exams\` — how many times the student sat that subject's exam (possibly 0). \`Examinations\` may contain duplicates. Order by \`student_id\`, then \`subject_name\`.`,
    schema: `CREATE TABLE Students (student_id INT PRIMARY KEY, student_name VARCHAR(20));
CREATE TABLE Subjects (subject_name VARCHAR(20) PRIMARY KEY);
CREATE TABLE Examinations (student_id INT, subject_name VARCHAR(20));`,
    data: `INSERT INTO Students VALUES (1, 'Rana'), (2, 'Sven'), (4, 'Tomas'), (7, 'Yui');
INSERT INTO Subjects VALUES ('Chemistry'), ('History'), ('Math');
INSERT INTO Examinations VALUES (1, 'Math'), (1, 'Math'), (1, 'History'), (2, 'Chemistry'), (4, 'Math'), (4, 'History'), (4, 'History'), (4, 'Chemistry'), (1, 'Chemistry'), (1, 'Math');`,
    tests: [
      { name: "Nobody sat an exam", data: `INSERT INTO Students VALUES (1, 'Ali'), (2, 'Bea'); INSERT INTO Subjects VALUES ('Art'), ('Bio');` },
    ],
    hints: [
      'Build every (student, subject) pair first — a CROSS JOIN.',
      'LEFT JOIN the exams onto that grid and count matches.',
      'Count a column from Examinations, not `*`, so missing exams count as 0.',
    ],
    solution: {
      sql: `SELECT s.student_id, s.student_name, sub.subject_name,
       COUNT(e.student_id) AS attended_exams
FROM Students s
CROSS JOIN Subjects sub
LEFT JOIN Examinations e
       ON e.student_id = s.student_id
      AND e.subject_name = sub.subject_name
GROUP BY s.student_id, s.student_name, sub.subject_name
ORDER BY s.student_id, sub.subject_name;`,
      explain: 'The CROSS JOIN guarantees a row for every combination — including Yui, who sat no exams. `COUNT(e.student_id)` counts only real exam rows.',
    },
    alternatives: [
      {
        title: 'Pre-aggregate, then join',
        sql: `SELECT s.student_id, s.student_name, sub.subject_name,
       IFNULL(x.n, 0) AS attended_exams
FROM Students s
CROSS JOIN Subjects sub
LEFT JOIN (
  SELECT student_id, subject_name, COUNT(*) AS n
  FROM Examinations
  GROUP BY student_id, subject_name
) x ON x.student_id = s.student_id AND x.subject_name = sub.subject_name
ORDER BY s.student_id, sub.subject_name;`,
        explain: 'Counting in a derived table first keeps the outer query at the grid grain — the pattern that avoids fan-out in bigger reports.',
      },
    ],
    traps: [
      { sql: `SELECT s.student_id, s.student_name, e.subject_name, COUNT(*) AS attended_exams FROM Students s JOIN Examinations e ON e.student_id = s.student_id GROUP BY s.student_id, s.student_name, e.subject_name ORDER BY s.student_id, e.subject_name;`, why: 'Only shows exams that happened: zero-attendance pairs (and Yui) are missing.' },
      { sql: `SELECT s.student_id, s.student_name, sub.subject_name, COUNT(*) AS attended_exams FROM Students s CROSS JOIN Subjects sub LEFT JOIN Examinations e ON e.student_id = s.student_id AND e.subject_name = sub.subject_name GROUP BY s.student_id, s.student_name, sub.subject_name ORDER BY s.student_id, sub.subject_name;`, why: '`COUNT(*)` counts the NULL-padded row, so missing exams show 1 instead of 0.' },
    ],
  },
  {
    id: 570,
    module: 'joins',
    sql50: true,
    patterns: ['self-join', 'GROUP BY + HAVING'],
    task: `Return the \`name\` of every manager with **at least five** direct reports. Any order. Two different employees can share a name.`,
    schema: `CREATE TABLE Employee (id INT PRIMARY KEY, name VARCHAR(255), department VARCHAR(255), managerId INT);`,
    data: `INSERT INTO Employee VALUES
  (101, 'John', 'A', NULL), (102, 'Dan', 'A', 101), (103, 'James', 'A', 101), (104, 'Amy', 'A', 101), (105, 'Anne', 'A', 101), (106, 'Ron', 'B', 101),
  (201, 'Ana', 'C', NULL), (202, 'Ana', 'C', NULL), (203, 'Bo', 'C', 201), (204, 'Cy', 'C', 201), (205, 'Di', 'C', 201), (206, 'Ed', 'C', 202), (207, 'Flo', 'C', 202),
  (301, 'Gil', 'D', 999), (302, 'Hal', 'D', 999), (303, 'Ian', 'D', 999), (304, 'Jo', 'D', 999), (305, 'Kay', 'D', 999);`,
    tests: [
      { name: "Exactly five, and more than five", data: `INSERT INTO Employee VALUES (1, 'Zed', 'X', NULL), (2, 'Ari', 'X', 1), (3, 'Bea', 'X', 1), (4, 'Cy', 'X', 1), (5, 'Dov', 'X', 1), (6, 'Eno', 'X', 1), (10, 'Ola', 'Y', NULL), (11, 'Fio', 'Y', 10), (12, 'Gus', 'Y', 10), (13, 'Hana', 'Y', 10), (14, 'Ike', 'Y', 10), (15, 'Jae', 'Y', 10), (16, 'Kit', 'Y', 10);` },
    ],
    hints: [
      'Count reports per `managerId`.',
      'Group by the manager\'s **id**, not name — two Anas manage different teams.',
      'Manager 999 has five reports but no row of their own, so there is no name to return.',
    ],
    solution: {
      sql: `SELECT m.name
FROM Employee m
JOIN Employee e ON e.managerId = m.id
GROUP BY m.id, m.name
HAVING COUNT(*) >= 5;`,
      explain: 'Joining reports to their manager and grouping by the manager\'s id counts each manager\'s team separately, even when names repeat.',
    },
    alternatives: [
      {
        title: 'IN with a grouped subquery',
        sql: `SELECT name
FROM Employee
WHERE id IN (SELECT managerId FROM Employee GROUP BY managerId HAVING COUNT(*) >= 5);`,
        explain: 'Find qualifying manager ids first, then look their names up. Manager 999 is not in the table, so it simply finds no name.',
      },
    ],
    traps: [
      { sql: `SELECT m.name FROM Employee m JOIN Employee e ON e.managerId = m.id GROUP BY m.name HAVING COUNT(*) >= 5;`, why: 'Grouping by name merges the two Anas (3 + 2 reports) into one manager with five.' },
      { sql: `SELECT m.name FROM Employee m JOIN Employee e ON e.managerId = m.id GROUP BY m.id, m.name HAVING COUNT(*) > 5;`, why: '"At least five" includes exactly five.' },
    ],
  },
  {
    id: 1934,
    module: 'joins',
    sql50: true,
    patterns: ['LEFT JOIN + AVG(condition)', 'NULL to 0'],
    task: `A user's **confirmation rate** is the number of 'confirmed' messages divided by the number of confirmation messages they requested; users who requested none have a rate of 0. Return \`user_id\` and \`confirmation_rate\` (rounded to 2 decimals) for **every** user in \`Signups\`. Any order.`,
    schema: `CREATE TABLE Signups (user_id INT PRIMARY KEY, time_stamp DATETIME);
CREATE TABLE Confirmations (user_id INT, time_stamp DATETIME, action ENUM('confirmed', 'timeout'), PRIMARY KEY (user_id, time_stamp));`,
    data: `INSERT INTO Signups VALUES (1, '2024-03-01 10:00:00'), (2, '2024-03-02 11:00:00'), (3, '2024-03-03 12:00:00'), (4, '2024-03-04 13:00:00'), (5, '2024-03-05 14:00:00');
INSERT INTO Confirmations VALUES
  (1, '2024-03-06 09:00:00', 'confirmed'), (1, '2024-03-07 09:00:00', 'timeout'), (1, '2024-03-08 09:00:00', 'confirmed'),
  (2, '2024-03-06 10:00:00', 'timeout'), (2, '2024-03-07 10:00:00', 'timeout'),
  (3, '2024-03-06 11:00:00', 'confirmed'),
  (5, '2024-03-06 12:00:00', 'confirmed'), (5, '2024-03-07 12:00:00', 'timeout'), (5, '2024-03-08 12:00:00', 'timeout'),
  (5, '2024-03-09 12:00:00', 'confirmed'), (5, '2024-03-10 12:00:00', 'timeout'), (5, '2024-03-11 12:00:00', 'timeout');`,
    tests: [
      { name: "Rates that need rounding", data: `INSERT INTO Signups VALUES (10, '2024-04-01 09:00:00'), (11, '2024-04-01 10:00:00'), (12, '2024-04-01 11:00:00'); INSERT INTO Confirmations VALUES (10, '2024-04-02 09:00:00', 'confirmed'), (10, '2024-04-03 09:00:00', 'timeout'), (10, '2024-04-04 09:00:00', 'timeout'), (11, '2024-04-02 10:00:00', 'confirmed'), (11, '2024-04-03 10:00:00', 'confirmed'), (11, '2024-04-04 10:00:00', 'timeout');` },
    ],
    hints: [
      'Every signup appears, including users with no confirmations — LEFT JOIN.',
      'The rate is the average of "was this row confirmed?" over a user\'s rows.',
      'For users with no rows that average is NULL; the problem wants 0.',
    ],
    solution: {
      sql: `SELECT s.user_id,
       ROUND(IFNULL(AVG(c.action = 'confirmed'), 0), 2) AS confirmation_rate
FROM Signups s
LEFT JOIN Confirmations c ON c.user_id = s.user_id
GROUP BY s.user_id;`,
      explain: '`AVG(condition)` is the fraction of rows where it holds. User 4 has only a NULL-padded row, whose condition is NULL, so AVG is NULL — IFNULL turns it into 0.',
    },
    alternatives: [
      {
        title: 'IF inside AVG',
        sql: `SELECT s.user_id,
       ROUND(AVG(IF(c.action = 'confirmed', 1, 0)), 2) AS confirmation_rate
FROM Signups s
LEFT JOIN Confirmations c ON c.user_id = s.user_id
GROUP BY s.user_id;`,
        explain: '`IF(NULL, 1, 0)` is 0, so the padded row counts as "not confirmed" and user 4 gets 0.00 without IFNULL.',
      },
    ],
    traps: [
      { sql: `SELECT s.user_id, ROUND(AVG(c.action = 'confirmed'), 2) AS confirmation_rate FROM Signups s LEFT JOIN Confirmations c ON c.user_id = s.user_id GROUP BY s.user_id;`, why: 'User 4 gets NULL instead of 0.' },
      { sql: `SELECT c.user_id, ROUND(AVG(c.action = 'confirmed'), 2) AS confirmation_rate FROM Confirmations c GROUP BY c.user_id;`, why: 'Users who never requested a confirmation are missing entirely.' },
    ],
  },
  {
    id: 1731,
    module: 'joins',
    sql50: true,
    order: true,
    patterns: ['self-join', 'ROUND half up'],
    task: `A manager is an employee with at least one direct report. For each manager, return \`employee_id\`, \`name\`, \`reports_count\` (direct reports) and \`average_age\` (average age of those reports, **rounded to the nearest integer**). Order by \`employee_id\`.`,
    schema: `CREATE TABLE Employees (employee_id INT PRIMARY KEY, name VARCHAR(20), reports_to INT, age INT);`,
    data: `INSERT INTO Employees VALUES
  (1, 'Ines', NULL, 50), (2, 'Jack', 1, 36), (3, 'Kofi', 1, 37),
  (4, 'Lara', NULL, 45), (5, 'Moe', 4, 30), (6, 'Nils', 4, 31), (7, 'Opal', 4, 33),
  (8, 'Pim', 2, 25), (9, 'Quin', NULL, 60);`,
    tests: [
      { name: "Managers who report to managers", data: `INSERT INTO Employees VALUES (1, 'Ana', NULL, 40), (2, 'Ben', 1, 30), (3, 'Cy', 1, 31), (4, 'Dot', 2, 20), (5, 'Eve', 3, 22), (6, 'Fin', 3, 23);` },
    ],
    hints: ['Join each report to their manager (self-join on `reports_to`).', 'Group per manager; ROUND the average — Ines\'s reports average 36.5.'],
    solution: {
      sql: `SELECT m.employee_id, m.name,
       COUNT(*)          AS reports_count,
       ROUND(AVG(e.age)) AS average_age
FROM Employees m
JOIN Employees e ON e.reports_to = m.employee_id
GROUP BY m.employee_id, m.name
ORDER BY m.employee_id;`,
      explain: 'An INNER self-join keeps only employees who have reports. MySQL rounds 36.5 half away from zero, to 37.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT m.employee_id, m.name, COUNT(*) AS reports_count, FLOOR(AVG(e.age)) AS average_age FROM Employees m JOIN Employees e ON e.reports_to = m.employee_id GROUP BY m.employee_id, m.name ORDER BY m.employee_id;`, why: 'FLOOR truncates 36.5 to 36; the task asks for rounding.' },
      { sql: `SELECT m.employee_id, m.name, COUNT(e.employee_id) AS reports_count, ROUND(AVG(e.age)) AS average_age FROM Employees m LEFT JOIN Employees e ON e.reports_to = m.employee_id GROUP BY m.employee_id, m.name ORDER BY m.employee_id;`, why: 'A LEFT JOIN also lists employees with no reports, who are not managers.' },
    ],
  },
  {
    id: 1407,
    module: 'joins',
    order: true,
    patterns: ['LEFT JOIN + SUM', 'multi-key ORDER BY'],
    task: `Return each user's \`name\` and \`travelled_distance\` (total ride distance, 0 if they never rode). Order by \`travelled_distance\` descending, then \`name\` ascending. Different users can share a name.`,
    schema: `CREATE TABLE Users (id INT PRIMARY KEY, name VARCHAR(30));
CREATE TABLE Rides (id INT PRIMARY KEY, user_id INT, distance INT);`,
    data: `INSERT INTO Users VALUES (1, 'Kai'), (2, 'Lia'), (3, 'Max'), (4, 'Nell'), (5, 'Otto'), (6, 'Kai');
INSERT INTO Rides VALUES (1, 1, 120), (2, 1, 30), (3, 2, 150), (4, 4, 500), (5, 6, 80);`,
    tests: [
      { name: "Ties on distance", data: `INSERT INTO Users VALUES (1, 'Zoe'), (2, 'Amy'), (3, 'Bo'), (4, 'Amy'); INSERT INTO Rides VALUES (1, 1, 100), (2, 2, 100), (3, 4, 50), (4, 4, 50);` },
    ],
    hints: ['Users without rides appear with 0 — LEFT JOIN plus IFNULL.', 'Group by the user id, not the name.', 'Two sort keys: distance DESC, then name.'],
    solution: {
      sql: `SELECT u.name, IFNULL(SUM(r.distance), 0) AS travelled_distance
FROM Users u
LEFT JOIN Rides r ON r.user_id = u.id
GROUP BY u.id, u.name
ORDER BY travelled_distance DESC, u.name;`,
      explain: '`SUM` over only NULL-padded rows is NULL, so IFNULL supplies the 0. Grouping by id keeps the two users named Kai apart.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT u.name, IFNULL(SUM(r.distance), 0) AS travelled_distance FROM Users u LEFT JOIN Rides r ON r.user_id = u.id GROUP BY u.name ORDER BY travelled_distance DESC, u.name;`, why: 'Grouping by name merges the two Kais into one row with 230.' },
      { sql: `SELECT u.name, SUM(r.distance) AS travelled_distance FROM Users u LEFT JOIN Rides r ON r.user_id = u.id GROUP BY u.id, u.name ORDER BY travelled_distance DESC, u.name;`, why: 'Users with no rides show NULL instead of 0.' },
    ],
  },
  {
    id: 607,
    module: 'joins',
    patterns: ['anti-join through two tables'],
    task: `Return the \`name\` of every salesperson who has **no** orders with the company named \`RED\`. Salespeople with no orders at all qualify. Any order.`,
    schema: `CREATE TABLE SalesPerson (sales_id INT PRIMARY KEY, name VARCHAR(255), salary INT, commission_rate INT, hire_date DATE);
CREATE TABLE Company (com_id INT PRIMARY KEY, name VARCHAR(255), city VARCHAR(255));
CREATE TABLE Orders (order_id INT PRIMARY KEY, order_date DATE, com_id INT, sales_id INT, amount INT);`,
    data: `INSERT INTO SalesPerson VALUES (1, 'Rui', 100000, 6, '2016-04-01'), (2, 'Sol', 12000, 5, '2010-05-01'), (3, 'Tao', 65000, 12, '2008-12-25'), (4, 'Uri', 25000, 25, '2005-01-01'), (5, 'Vee', 50000, 10, '2007-02-03');
INSERT INTO Company VALUES (1, 'RED', 'Boston'), (2, 'ORANGE', 'New York'), (3, 'YELLOW', 'Boston'), (4, 'GREEN', 'Austin');
INSERT INTO Orders VALUES (1, '2024-01-01', 3, 4, 10000), (2, '2024-02-01', 4, 5, 5000), (3, '2024-03-01', 1, 1, 50000), (4, '2024-04-01', 1, 4, 25000), (5, '2024-05-01', 2, 2, 8000);`,
    tests: [
      { name: "No company is called RED", data: `INSERT INTO SalesPerson VALUES (1, 'Ann', 1000, 5, '2020-01-01'), (2, 'Ben', 2000, 6, '2021-01-01'); INSERT INTO Company VALUES (1, 'BLUE', 'Oslo'); INSERT INTO Orders VALUES (1, '2024-01-01', 1, 1, 100);` },
    ],
    hints: [
      'First find the salespeople who *did* sell to RED (orders joined to company).',
      'Then keep everyone not in that set.',
      'Filtering `company <> \'RED\'` row by row is not the same question.',
    ],
    solution: {
      sql: `SELECT name
FROM SalesPerson
WHERE sales_id NOT IN (
  SELECT o.sales_id
  FROM Orders o
  JOIN Company c ON c.com_id = o.com_id
  WHERE c.name = 'RED'
);`,
      explain: 'Find the "bad" set, then negate it. NOT IN is safe here because `Orders.sales_id` is never NULL in this data; NOT EXISTS would be safe regardless.',
    },
    alternatives: [
      {
        title: 'NOT EXISTS',
        sql: `SELECT s.name
FROM SalesPerson s
WHERE NOT EXISTS (
  SELECT 1
  FROM Orders o
  JOIN Company c ON c.com_id = o.com_id
  WHERE o.sales_id = s.sales_id AND c.name = 'RED'
);`,
        explain: 'Correlated per salesperson: "there is no RED order by this person".',
      },
    ],
    traps: [
      { sql: `SELECT DISTINCT s.name FROM SalesPerson s JOIN Orders o ON o.sales_id = s.sales_id JOIN Company c ON c.com_id = o.com_id WHERE c.name <> 'RED';`, why: 'Keeps Uri (who also sold to YELLOW) and loses Tao (who has no orders at all).' },
    ],
  },
  {
    id: 1158,
    module: 'joins',
    patterns: ['LEFT JOIN, filter in ON'],
    task: `For **every** user, return \`buyer_id\` (their user id), \`join_date\`, and \`orders_in_2019\`: how many orders they placed as a **buyer** during 2019 (0 if none). Any order.`,
    schema: `CREATE TABLE Users (user_id INT PRIMARY KEY, join_date DATE, favorite_brand VARCHAR(10));
CREATE TABLE Orders (order_id INT PRIMARY KEY, order_date DATE, item_id INT, buyer_id INT, seller_id INT);
CREATE TABLE Items (item_id INT PRIMARY KEY, item_brand VARCHAR(10));`,
    data: `INSERT INTO Users VALUES (1, '2018-03-01', 'Acer'), (2, '2018-07-15', 'Asus'), (3, '2019-01-20', 'Dell'), (4, '2019-06-30', 'Acer'), (5, '2020-01-01', 'Asus');
INSERT INTO Items VALUES (1, 'Acer'), (2, 'Asus'), (3, 'Dell');
INSERT INTO Orders VALUES
  (1, '2019-01-05', 1, 1, 2), (2, '2019-12-31', 2, 1, 3), (3, '2020-01-01', 3, 1, 2),
  (4, '2018-12-31', 1, 2, 3), (5, '2019-08-08', 3, 3, 1), (6, '2020-02-02', 2, 5, 4);`,
    tests: [
      { name: "Sellers are not buyers", data: `INSERT INTO Users VALUES (1, '2019-01-01', 'Acer'), (2, '2019-02-01', 'Dell'); INSERT INTO Items VALUES (1, 'Acer'); INSERT INTO Orders VALUES (1, '2019-03-01', 1, 2, 1), (2, '2019-04-01', 1, 2, 1);` },
    ],
    hints: [
      'Every user appears, so LEFT JOIN orders onto users.',
      'Where does the "2019 only" condition go so users without 2019 orders survive?',
      'Count an Orders column, not `*`.',
    ],
    solution: {
      sql: `SELECT u.user_id AS buyer_id, u.join_date,
       COUNT(o.order_id) AS orders_in_2019
FROM Users u
LEFT JOIN Orders o
       ON o.buyer_id = u.user_id
      AND o.order_date BETWEEN '2019-01-01' AND '2019-12-31'
GROUP BY u.user_id, u.join_date;`,
      explain: 'The year condition lives in ON, so it only limits which orders can match; users with no 2019 orders keep their row and count 0. This is the ON-vs-WHERE lesson in problem form.',
    },
    alternatives: [
      {
        title: 'Aggregate first, then join',
        sql: `SELECT u.user_id AS buyer_id, u.join_date, IFNULL(x.n, 0) AS orders_in_2019
FROM Users u
LEFT JOIN (
  SELECT buyer_id, COUNT(*) AS n
  FROM Orders
  WHERE YEAR(order_date) = 2019
  GROUP BY buyer_id
) x ON x.buyer_id = u.user_id;`,
        explain: 'Filter and count orders on their own, then attach the counts to users.',
      },
    ],
    traps: [
      { sql: `SELECT u.user_id AS buyer_id, u.join_date, COUNT(o.order_id) AS orders_in_2019 FROM Users u LEFT JOIN Orders o ON o.buyer_id = u.user_id WHERE YEAR(o.order_date) = 2019 GROUP BY u.user_id, u.join_date;`, why: 'The WHERE runs after the join and discards users with no 2019 orders (their order_date is NULL or another year).' },
      { sql: `SELECT u.user_id AS buyer_id, u.join_date, COUNT(*) AS orders_in_2019 FROM Users u LEFT JOIN Orders o ON o.buyer_id = u.user_id AND YEAR(o.order_date) = 2019 GROUP BY u.user_id, u.join_date;`, why: '`COUNT(*)` counts the NULL-padded row, giving 1 to users with no 2019 orders.' },
    ],
  },
  {
    id: 1075,
    module: 'joins',
    sql50: true,
    patterns: ['JOIN + AVG'],
    task: `For each \`project_id\`, return \`average_years\`: the average \`experience_years\` of the employees on that project, rounded to **2 decimals**. Any order.`,
    schema: `CREATE TABLE Project (project_id INT, employee_id INT, PRIMARY KEY (project_id, employee_id));
CREATE TABLE Employee (employee_id INT PRIMARY KEY, name VARCHAR(10), experience_years INT);`,
    data: `INSERT INTO Project VALUES (21, 101), (21, 102), (21, 103), (22, 101), (22, 104), (23, 105);
INSERT INTO Employee VALUES (101, 'Rafa', 3), (102, 'Sana', 2), (103, 'Ugo', 2), (104, 'Vera', 5), (105, 'Wim', 8);`,
    tests: [
      { name: "Averages that need rounding", data: `INSERT INTO Project VALUES (1, 1), (1, 2), (1, 3), (2, 3); INSERT INTO Employee VALUES (1, 'Al', 1), (2, 'Bo', 1), (3, 'Cy', 2);` },
    ],
    hints: ['Look up each project member\'s experience, then average per project.', 'Round with `ROUND(x, 2)` — some averages are repeating decimals.'],
    solution: {
      sql: `SELECT p.project_id,
       ROUND(AVG(e.experience_years), 2) AS average_years
FROM Project p
JOIN Employee e ON e.employee_id = p.employee_id
GROUP BY p.project_id;`,
      explain: 'Join to bring the experience next to each project row, then AVG per project. Project 21 averages 7/3 = 2.333…, so rounding matters.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT p.project_id, AVG(e.experience_years) AS average_years FROM Project p JOIN Employee e ON e.employee_id = p.employee_id GROUP BY p.project_id;`, why: 'Not rounded to 2 decimals.' },
    ],
  },
  {
    id: 1251,
    module: 'joins',
    sql50: true,
    patterns: ['range join', 'weighted average', 'NULL to 0'],
    task: `\`Prices\` gives each product's price over non-overlapping date ranges (both ends inclusive). \`UnitsSold\` records sales. For **every** product in \`Prices\`, return \`product_id\` and \`average_price\`: total revenue ÷ total units sold, rounded to **2 decimals**, or **0** if it sold nothing. Any order.`,
    schema: `CREATE TABLE Prices (product_id INT, start_date DATE, end_date DATE, price INT, PRIMARY KEY (product_id, start_date, end_date));
CREATE TABLE UnitsSold (product_id INT, purchase_date DATE, units INT);`,
    data: `INSERT INTO Prices VALUES
  (7, '2024-04-01', '2024-04-14', 12), (7, '2024-04-15', '2024-04-30', 18),
  (8, '2024-04-01', '2024-04-10', 40), (8, '2024-04-11', '2024-05-15', 25),
  (9, '2024-01-01', '2024-12-31', 9);
INSERT INTO UnitsSold VALUES (7, '2024-04-10', 30), (7, '2024-04-15', 10), (8, '2024-04-05', 5), (8, '2024-05-15', 20), (7, '2024-04-14', 5);`,
    tests: [
      { name: "Sales on the first and last day of each range", data: `INSERT INTO Prices VALUES (1, '2024-01-01', '2024-01-31', 10), (1, '2024-02-01', '2024-02-29', 20), (2, '2024-01-01', '2024-12-31', 5); INSERT INTO UnitsSold VALUES (1, '2024-01-31', 1), (1, '2024-02-01', 3), (1, '2024-02-29', 1);` },
    ],
    hints: [
      'Each sale must be matched to the price row whose date range contains it — a join on a range.',
      'Average *price per unit*: SUM(price × units) / SUM(units), not AVG(price).',
      'Product 9 never sold: keep it (LEFT JOIN) and show 0.',
    ],
    solution: {
      sql: `SELECT p.product_id,
       IFNULL(ROUND(SUM(p.price * u.units) / SUM(u.units), 2), 0) AS average_price
FROM Prices p
LEFT JOIN UnitsSold u
       ON u.product_id = p.product_id
      AND u.purchase_date BETWEEN p.start_date AND p.end_date
GROUP BY p.product_id;`,
      explain: 'The join condition includes the date range, so each sale meets exactly one price period (boundaries included). Revenue over units is a weighted average; for product 9 both sums are NULL, and IFNULL gives 0.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT p.product_id, IFNULL(ROUND(AVG(p.price), 2), 0) AS average_price FROM Prices p LEFT JOIN UnitsSold u ON u.product_id = p.product_id AND u.purchase_date BETWEEN p.start_date AND p.end_date GROUP BY p.product_id;`, why: 'AVG(price) ignores how many units sold at each price.' },
      { sql: `SELECT p.product_id, IFNULL(ROUND(SUM(p.price * u.units) / SUM(u.units), 2), 0) AS average_price FROM Prices p LEFT JOIN UnitsSold u ON u.product_id = p.product_id AND u.purchase_date > p.start_date AND u.purchase_date < p.end_date GROUP BY p.product_id;`, why: 'Excluding the range ends loses sales made on a boundary date (Apr 14, Apr 15, May 15).' },
      { sql: `SELECT p.product_id, ROUND(SUM(p.price * u.units) / SUM(u.units), 2) AS average_price FROM Prices p JOIN UnitsSold u ON u.product_id = p.product_id AND u.purchase_date BETWEEN p.start_date AND p.end_date GROUP BY p.product_id;`, why: 'An inner join drops products with no sales instead of reporting 0.' },
    ],
  },
  {
    id: 1587,
    module: 'joins',
    patterns: ['JOIN + SUM + HAVING'],
    task: `An account's balance is the sum of all its transaction amounts (negative for money sent). Return \`name\` and \`balance\` of users whose balance is **higher than 10000**. Any order.`,
    schema: `CREATE TABLE Users (account INT PRIMARY KEY, name VARCHAR(20));
CREATE TABLE Transactions (trans_id INT PRIMARY KEY, account INT, amount INT, transacted_on DATE);`,
    data: `INSERT INTO Users VALUES (700101, 'Ines'), (700102, 'Jomo'), (700103, 'Kara'), (700104, 'Luca'), (700105, 'Mina');
INSERT INTO Transactions VALUES
  (1, 700101, 8000, '2024-08-01'), (2, 700101, 5000, '2024-09-01'), (3, 700101, -2500, '2024-09-02'),
  (4, 700102, 10000, '2024-08-12'),
  (5, 700103, 4000, '2024-08-07'), (6, 700103, 7500, '2024-08-15'), (7, 700103, -1500, '2024-09-20'),
  (8, 700105, 16000, '2024-08-30'), (9, 700105, -3000, '2024-09-01');`,
    tests: [
      { name: "Just above, and exactly at, 10000", data: `INSERT INTO Users VALUES (1, 'Ari'), (2, 'Bea'), (3, 'Cy'); INSERT INTO Transactions VALUES (1, 1, 10001, '2024-01-01'), (2, 2, 20000, '2024-01-02'), (3, 2, -10000, '2024-01-03');` },
    ],
    hints: ['Sum amounts per account, then keep sums above 10000 — a HAVING condition.', '"Higher than" excludes exactly 10000.'],
    solution: {
      sql: `SELECT u.name, SUM(t.amount) AS balance
FROM Users u
JOIN Transactions t ON t.account = u.account
GROUP BY u.account, u.name
HAVING SUM(t.amount) > 10000;`,
      explain: 'Balances only exist after aggregation, so the filter is a HAVING. Jomo and Kara sit exactly at 10000 and are excluded.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT u.name, SUM(t.amount) AS balance FROM Users u JOIN Transactions t ON t.account = u.account GROUP BY u.account, u.name HAVING SUM(t.amount) >= 10000;`, why: 'Includes balances of exactly 10000.' },
      { sql: `SELECT u.name, SUM(t.amount) AS balance FROM Users u JOIN Transactions t ON t.account = u.account WHERE t.amount > 10000 GROUP BY u.account, u.name;`, why: 'Filters individual transactions, not balances.' },
    ],
  },
  {
    id: 1084,
    module: 'joins',
    patterns: ['HAVING MIN/MAX', 'only-within-range'],
    task: `Report the \`product_id\` and \`product_name\` of products that were sold **only** in the first quarter of 2019 (2019-01-01 to 2019-03-31, inclusive): at least one sale, and every sale inside that window. Any order.`,
    schema: `CREATE TABLE Product (product_id INT PRIMARY KEY, product_name VARCHAR(10), unit_price INT);
CREATE TABLE Sales (seller_id INT, product_id INT, buyer_id INT, sale_date DATE, quantity INT, price INT);`,
    data: `INSERT INTO Product VALUES (1, 'Tab A', 300), (2, 'Tab B', 450), (3, 'Tab C', 600), (4, 'Tab D', 350), (5, 'Tab E', 500);
INSERT INTO Sales VALUES
  (4, 1, 10, '2019-02-11', 1, 300), (4, 1, 11, '2019-03-31', 2, 600),
  (5, 2, 12, '2019-01-20', 1, 450), (5, 2, 13, '2019-04-15', 1, 450),
  (6, 3, 14, '2019-06-01', 1, 600),
  (6, 5, 15, '2019-01-01', 3, 1500);`,
    tests: [
      { name: "Q1 of another year", data: `INSERT INTO Product VALUES (1, 'P1', 10), (2, 'P2', 10); INSERT INTO Sales VALUES (1, 1, 1, '2019-01-01', 1, 10), (1, 1, 2, '2019-03-31', 1, 10), (1, 2, 1, '2018-02-01', 1, 10), (1, 2, 2, '2019-02-01', 1, 10);` },
    ],
    hints: [
      '"Only in Q1" means the earliest and the latest sale both fall inside Q1.',
      'Aggregate per product and test MIN and MAX of the sale date in HAVING.',
      'A product with no sales must not appear.',
    ],
    solution: {
      sql: `SELECT p.product_id, p.product_name
FROM Product p
JOIN Sales s ON s.product_id = p.product_id
GROUP BY p.product_id, p.product_name
HAVING MIN(s.sale_date) >= '2019-01-01'
   AND MAX(s.sale_date) <= '2019-03-31';`,
      explain: 'If the first sale is on or after Jan 1 and the last is on or before Mar 31, every sale is inside. The inner join excludes the never-sold Tab D.',
    },
    alternatives: [
      {
        title: 'Count sales outside the window',
        sql: `SELECT p.product_id, p.product_name
FROM Product p
JOIN Sales s ON s.product_id = p.product_id
GROUP BY p.product_id, p.product_name
HAVING SUM(s.sale_date NOT BETWEEN '2019-01-01' AND '2019-03-31') = 0;`,
        explain: 'Conditional aggregation: the number of sales outside Q1 must be zero.',
      },
    ],
    traps: [
      { sql: `SELECT DISTINCT p.product_id, p.product_name FROM Product p JOIN Sales s ON s.product_id = p.product_id WHERE s.sale_date BETWEEN '2019-01-01' AND '2019-03-31';`, why: 'Finds products sold at some point in Q1 — Tab B was also sold in April.' },
      { sql: `SELECT product_id, product_name FROM Product WHERE product_id NOT IN (SELECT product_id FROM Sales WHERE sale_date < '2019-01-01' OR sale_date > '2019-03-31');`, why: 'Also returns Tab D, which was never sold at all.' },
      { sql: `SELECT p.product_id, p.product_name FROM Product p JOIN Sales s ON s.product_id = p.product_id GROUP BY p.product_id, p.product_name HAVING SUM(MONTH(s.sale_date) > 3) = 0;`, why: 'Checks the month but not the year, so sales in the first quarter of 2018 pass too.' },
    ],
  },
  {
    id: 1327,
    module: 'joins',
    sql50: true,
    patterns: ['date range', 'HAVING'],
    task: `Return \`product_name\` and \`unit\` (total units ordered) for every product with **at least 100 units** ordered in **February 2020**. Any order.`,
    schema: `CREATE TABLE Products (product_id INT PRIMARY KEY, product_name VARCHAR(40), product_category VARCHAR(40));
CREATE TABLE Orders (product_id INT, order_date DATE, unit INT);`,
    data: `INSERT INTO Products VALUES (1, 'Sketchbook', 'Paper'), (2, 'Fountain Pen', 'Pens'), (3, 'Desk Lamp', 'Lighting'), (4, 'Ink Bottle', 'Pens'), (5, 'Notebook', 'Paper');
INSERT INTO Orders VALUES
  (1, '2020-02-05', 60), (1, '2020-02-10', 40), (1, '2020-01-18', 30),
  (2, '2020-02-11', 50), (2, '2020-02-12', 49), (2, '2020-03-01', 100),
  (3, '2020-02-02', 120),
  (4, '2020-02-29', 100),
  (5, '2020-01-31', 200), (5, '2020-03-01', 200);`,
    tests: [
      { name: "February of another year", data: `INSERT INTO Products VALUES (1, 'Globe', 'Maps'), (2, 'Atlas', 'Maps'); INSERT INTO Orders VALUES (1, '2019-02-10', 100), (1, '2020-02-01', 50), (2, '2020-02-15', 100), (2, '2021-02-15', 5);` },
    ],
    hints: ['Filter orders to February 2020 — 2020 is a leap year.', 'Sum units per product and keep totals of at least 100.'],
    solution: {
      sql: `SELECT p.product_name, SUM(o.unit) AS unit
FROM Products p
JOIN Orders o ON o.product_id = p.product_id
WHERE o.order_date >= '2020-02-01' AND o.order_date < '2020-03-01'
GROUP BY p.product_id, p.product_name
HAVING SUM(o.unit) >= 100;`,
      explain: 'A half-open range covers the whole month without knowing how many days February has. Sketchbook reaches exactly 100; Fountain Pen stops at 99.',
    },
    alternatives: [
      {
        title: 'DATE_FORMAT',
        sql: `SELECT p.product_name, SUM(o.unit) AS unit
FROM Products p
JOIN Orders o ON o.product_id = p.product_id
WHERE DATE_FORMAT(o.order_date, '%Y-%m') = '2020-02'
GROUP BY p.product_id, p.product_name
HAVING unit >= 100;`,
        explain: 'Readable, though it cannot use an index on `order_date`. MySQL allows the alias `unit` in HAVING.',
      },
    ],
    traps: [
      { sql: `SELECT p.product_name, SUM(o.unit) AS unit FROM Products p JOIN Orders o ON o.product_id = p.product_id WHERE o.order_date BETWEEN '2020-02-01' AND '2020-02-28' GROUP BY p.product_id, p.product_name HAVING SUM(o.unit) >= 100;`, why: 'Misses February 29 — the Ink Bottle order.' },
      { sql: `SELECT p.product_name, SUM(o.unit) AS unit FROM Products p JOIN Orders o ON o.product_id = p.product_id WHERE o.order_date >= '2020-02-01' AND o.order_date < '2020-03-01' GROUP BY p.product_id, p.product_name HAVING SUM(o.unit) > 100;`, why: '"At least 100" includes exactly 100.' },
      { sql: `SELECT p.product_name, SUM(o.unit) AS unit FROM Products p JOIN Orders o ON o.product_id = p.product_id WHERE MONTH(o.order_date) = 2 GROUP BY p.product_id, p.product_name HAVING SUM(o.unit) >= 100;`, why: 'Any February counts, from any year.' },
    ],
  },
];
