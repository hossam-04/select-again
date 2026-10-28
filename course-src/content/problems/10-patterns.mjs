// Module 10: interview patterns
export default [
  {
    id: 185,
    module: 'patterns',
    sql50: true,
    patterns: ['top N distinct per group', 'DENSE_RANK'],
    task: `A **high earner** is an employee whose salary is among the **top three distinct salaries** of their department. Return \`Department\` (name), \`Employee\` (name) and \`Salary\` for every high earner. Any order.`,
    schema: `CREATE TABLE Employee (id INT PRIMARY KEY, name VARCHAR(255), salary INT, departmentId INT);
CREATE TABLE Department (id INT PRIMARY KEY, name VARCHAR(255));`,
    data: `INSERT INTO Department VALUES (1, 'IT'), (2, 'Sales'), (3, 'Legal');
INSERT INTO Employee VALUES
  (1, 'Ana', 95000, 1), (2, 'Ben', 90000, 1), (3, 'Cai', 90000, 1), (4, 'Dev', 85000, 1),
  (5, 'Eli', 80000, 1), (6, 'Fox', 85000, 1), (7, 'Gia', 60000, 2), (8, 'Hub', 70000, 2);`,
    tests: [
      { name: "Few distinct salaries, and a tie for third", data: `INSERT INTO Department VALUES (1, 'Ops'), (2, 'Dev'); INSERT INTO Employee VALUES (1, 'Ari', 100, 1), (2, 'Bea', 100, 1), (3, 'Cyd', 50, 1), (4, 'Dov', 90, 2), (5, 'Eno', 80, 2), (6, 'Fia', 70, 2), (7, 'Gus', 70, 2), (8, 'Hal', 60, 2);` },
    ],
    hints: [
      '"Top three distinct salaries": ties share a place, and the numbering must not skip.',
      'DENSE_RANK per department, ordered by salary descending.',
      'Filter the rank in an outer query (window functions cannot go in WHERE).',
    ],
    solution: {
      sql: `SELECT Department, Employee, Salary
FROM (
  SELECT d.name AS Department, e.name AS Employee, e.salary AS Salary,
         DENSE_RANK() OVER (PARTITION BY e.departmentId ORDER BY e.salary DESC) AS rnk
  FROM Employee e
  JOIN Department d ON d.id = e.departmentId
) ranked
WHERE rnk <= 3;`,
      explain: 'IT\'s distinct salaries are 95k, 90k, 85k, 80k: the top three levels cover five people (two tie at 90k, two at 85k). Sales has only two people, both included.',
    },
    alternatives: [
      {
        title: 'Correlated count (no window functions)',
        sql: `SELECT d.name AS Department, e.name AS Employee, e.salary AS Salary
FROM Employee e
JOIN Department d ON d.id = e.departmentId
WHERE (SELECT COUNT(DISTINCT e2.salary)
       FROM Employee e2
       WHERE e2.departmentId = e.departmentId AND e2.salary > e.salary) < 3;`,
        explain: 'An employee is a high earner if fewer than three distinct salaries in their department are higher than theirs.',
      },
    ],
    traps: [
      { sql: "SELECT Department, Employee, Salary FROM (SELECT d.name AS Department, e.name AS Employee, e.salary AS Salary, RANK() OVER (PARTITION BY e.departmentId ORDER BY e.salary DESC) AS rnk FROM Employee e JOIN Department d ON d.id = e.departmentId) t WHERE rnk <= 3;", why: 'RANK skips after ties (1, 2, 2, 4), so the 85k earners are lost.' },
      { sql: "SELECT Department, Employee, Salary FROM (SELECT d.name AS Department, e.name AS Employee, e.salary AS Salary, ROW_NUMBER() OVER (PARTITION BY e.departmentId ORDER BY e.salary DESC) AS rn FROM Employee e JOIN Department d ON d.id = e.departmentId) t WHERE rn <= 3;", why: 'ROW_NUMBER keeps exactly three people and drops tied colleagues.' },
    ],
  },
  {
    id: 601,
    module: 'patterns',
    order: true,
    patterns: ['gaps and islands', 'consecutive ids'],
    task: `Return every row that belongs to a run of **three or more consecutive ids** in which each row has \`people >= 100\`. Return \`id\`, \`visit_date\`, \`people\`, ordered by \`visit_date\`. Ids can have gaps; a gap breaks a run.`,
    schema: `CREATE TABLE Stadium (id INT PRIMARY KEY, visit_date DATE, people INT);`,
    data: `INSERT INTO Stadium VALUES
  (1, '2024-03-01', 120), (2, '2024-03-02', 130), (3, '2024-03-03', 80), (4, '2024-03-04', 100),
  (5, '2024-03-05', 250), (6, '2024-03-06', 300), (7, '2024-03-07', 90), (8, '2024-03-08', 150),
  (9, '2024-03-09', 160), (11, '2024-03-11', 170), (12, '2024-03-12', 400), (13, '2024-03-13', 500), (14, '2024-03-14', 110);`,
    tests: [
      { name: "Gaps in the ids split runs", data: `INSERT INTO Stadium VALUES (1, '2024-05-01', 100), (2, '2024-05-02', 100), (4, '2024-05-04', 100), (5, '2024-05-05', 200), (6, '2024-05-06', 300), (7, '2024-05-07', 50);` },
    ],
    hints: [
      'Keep only busy rows (people >= 100) first.',
      'Within a run of consecutive ids, `id − ROW_NUMBER()` is constant: that is the run\'s group key.',
      'Keep groups with at least 3 rows. Id 10 is missing, so 8–9 and 11–14 are separate runs.',
    ],
    solution: {
      sql: `WITH busy AS (
  SELECT id, visit_date, people,
         id - ROW_NUMBER() OVER (ORDER BY id) AS grp
  FROM Stadium
  WHERE people >= 100
)
SELECT id, visit_date, people
FROM busy
WHERE grp IN (SELECT grp FROM busy GROUP BY grp HAVING COUNT(*) >= 3)
ORDER BY visit_date;`,
      explain: 'Busy ids 4, 5, 6 have row numbers 3, 4, 5 → group 1; ids 11–14 get group 3. Ids 8 and 9 form group 2 of size two, and the missing id 10 keeps them apart from 11–14.',
    },
    alternatives: [
      {
        title: 'Run length with a window count',
        sql: `WITH busy AS (
  SELECT id, visit_date, people,
         id - ROW_NUMBER() OVER (ORDER BY id) AS grp
  FROM Stadium
  WHERE people >= 100
)
SELECT id, visit_date, people
FROM (SELECT b.*, COUNT(*) OVER (PARTITION BY grp) AS run_len FROM busy b) t
WHERE run_len >= 3
ORDER BY visit_date;`,
        explain: 'Annotate each busy row with its run length instead of filtering through a subquery.',
      },
      {
        title: 'Triple self-join',
        sql: `SELECT DISTINCT s1.id, s1.visit_date, s1.people
FROM Stadium s1, Stadium s2, Stadium s3
WHERE s1.people >= 100 AND s2.people >= 100 AND s3.people >= 100
  AND ((s2.id = s1.id + 1 AND s3.id = s1.id + 2)
    OR (s2.id = s1.id - 1 AND s3.id = s1.id + 1)
    OR (s2.id = s1.id - 2 AND s3.id = s1.id - 1))
ORDER BY s1.visit_date;`,
        explain: 'A row qualifies if it is the first, middle or last of some busy triple. The classic pre-window answer.',
      },
    ],
    traps: [
      { sql: 'WITH busy AS (SELECT id, visit_date, people, id - ROW_NUMBER() OVER (ORDER BY id) AS grp FROM Stadium WHERE people > 100) SELECT id, visit_date, people FROM busy WHERE grp IN (SELECT grp FROM busy GROUP BY grp HAVING COUNT(*) >= 3) ORDER BY visit_date;', why: '`> 100` drops id 4 (exactly 100 people) and breaks its run.' },
      { sql: 'SELECT id, visit_date, people FROM (SELECT s.*, COUNT(*) OVER (PARTITION BY grp) AS run_len FROM (SELECT id, visit_date, people, ROW_NUMBER() OVER (ORDER BY id) - ROW_NUMBER() OVER (PARTITION BY people >= 100 ORDER BY id) AS grp FROM Stadium) s WHERE people >= 100) t WHERE run_len >= 3 ORDER BY visit_date;', why: 'Groups adjacent *rows*, not adjacent ids — rows 9 and 11 look consecutive although id 10 is missing.' },
    ],
  },
  {
    id: 1045,
    module: 'patterns',
    sql50: true,
    patterns: ['relational division'],
    task: `\`Customer\` records purchases (it may contain duplicate rows). Return the \`customer_id\` of every customer who bought **every** product listed in \`Product\`. Any order.`,
    schema: `CREATE TABLE Customer (customer_id INT, product_key INT);
CREATE TABLE Product (product_key INT PRIMARY KEY);`,
    data: `INSERT INTO Product VALUES (10), (20), (30);
INSERT INTO Customer VALUES (1, 10), (1, 20), (1, 20), (1, 30), (2, 10), (2, 10), (2, 10), (3, 20), (3, 30), (3, 10), (4, 10), (4, 20);`,
    tests: [
      { name: "A product nobody bought", data: `INSERT INTO Product VALUES (1), (2); INSERT INTO Customer VALUES (1, 1), (1, 1), (2, 1);` },
    ],
    hints: [
      'Count how many **different** products each customer bought.',
      'Compare with the number of products in the catalog (a scalar subquery).',
    ],
    solution: {
      sql: `SELECT customer_id
FROM Customer
GROUP BY customer_id
HAVING COUNT(DISTINCT product_key) = (SELECT COUNT(*) FROM Product);`,
      explain: 'Customer 2 has three rows but one product; customer 1 has four rows covering all three. Only distinct counts tell them apart.',
    },
    alternatives: [
      {
        title: 'Double NOT EXISTS',
        sql: `SELECT DISTINCT c.customer_id
FROM Customer c
WHERE NOT EXISTS (
  SELECT 1 FROM Product p
  WHERE NOT EXISTS (
    SELECT 1 FROM Customer c2
    WHERE c2.customer_id = c.customer_id AND c2.product_key = p.product_key
  )
);`,
        explain: 'Relational division in pure logic: there is no product that this customer did not buy.',
      },
    ],
    traps: [
      { sql: 'SELECT customer_id FROM Customer GROUP BY customer_id HAVING COUNT(*) = (SELECT COUNT(*) FROM Product);', why: 'Counts purchase rows, so repeat purchases fool it (customer 2 has three rows of the same product).' },
    ],
  },
  {
    id: 1179,
    module: 'patterns',
    lcSkipExample: "LeetCode's example output abbreviates its 13 columns with '...'",
    patterns: ['pivot', 'conditional aggregation'],
    task: `\`Department\` has one row per (\`id\`, \`month\`) with that month's \`revenue\`; months are 'Jan' … 'Dec'. Reformat it to one row per \`id\` with 12 columns \`Jan_Revenue\`, \`Feb_Revenue\`, …, \`Dec_Revenue\` (NULL where there is no data). Any order.`,
    schema: `CREATE TABLE Department (id INT, revenue INT, month VARCHAR(5), PRIMARY KEY (id, month));`,
    data: `INSERT INTO Department VALUES (10, 5200, 'Jan'), (10, 4800, 'Feb'), (10, 6100, 'Dec'), (20, 7300, 'Mar'), (20, 7100, 'Jun'), (30, 900, 'Nov');`,
    tests: [
      { name: "Every month for one department", data: `INSERT INTO Department VALUES (1, 1, 'Jan'), (1, 2, 'Feb'), (1, 3, 'Mar'), (1, 4, 'Apr'), (1, 5, 'May'), (1, 6, 'Jun'), (1, 7, 'Jul'), (1, 8, 'Aug'), (1, 9, 'Sep'), (1, 10, 'Oct'), (1, 11, 'Nov'), (1, 12, 'Dec'), (2, 99, 'Dec');` },
    ],
    hints: [
      'One output column per month: that is conditional aggregation, grouped by id.',
      "`SUM(CASE WHEN month = 'Jan' THEN revenue END)` — no ELSE, so a missing month stays NULL.",
    ],
    solution: {
      sql: `SELECT id,
       SUM(CASE WHEN month = 'Jan' THEN revenue END) AS Jan_Revenue,
       SUM(CASE WHEN month = 'Feb' THEN revenue END) AS Feb_Revenue,
       SUM(CASE WHEN month = 'Mar' THEN revenue END) AS Mar_Revenue,
       SUM(CASE WHEN month = 'Apr' THEN revenue END) AS Apr_Revenue,
       SUM(CASE WHEN month = 'May' THEN revenue END) AS May_Revenue,
       SUM(CASE WHEN month = 'Jun' THEN revenue END) AS Jun_Revenue,
       SUM(CASE WHEN month = 'Jul' THEN revenue END) AS Jul_Revenue,
       SUM(CASE WHEN month = 'Aug' THEN revenue END) AS Aug_Revenue,
       SUM(CASE WHEN month = 'Sep' THEN revenue END) AS Sep_Revenue,
       SUM(CASE WHEN month = 'Oct' THEN revenue END) AS Oct_Revenue,
       SUM(CASE WHEN month = 'Nov' THEN revenue END) AS Nov_Revenue,
       SUM(CASE WHEN month = 'Dec' THEN revenue END) AS Dec_Revenue
FROM Department
GROUP BY id;`,
      explain: 'Each column aggregates only its month\'s rows; the missing ELSE makes other rows NULL, and SUM over only NULLs is NULL — exactly what the problem wants for missing months.',
    },
    alternatives: [
      {
        title: 'MAX(IF(...))',
        sql: `SELECT id,
       MAX(IF(month = 'Jan', revenue, NULL)) AS Jan_Revenue,
       MAX(IF(month = 'Feb', revenue, NULL)) AS Feb_Revenue,
       MAX(IF(month = 'Mar', revenue, NULL)) AS Mar_Revenue,
       MAX(IF(month = 'Apr', revenue, NULL)) AS Apr_Revenue,
       MAX(IF(month = 'May', revenue, NULL)) AS May_Revenue,
       MAX(IF(month = 'Jun', revenue, NULL)) AS Jun_Revenue,
       MAX(IF(month = 'Jul', revenue, NULL)) AS Jul_Revenue,
       MAX(IF(month = 'Aug', revenue, NULL)) AS Aug_Revenue,
       MAX(IF(month = 'Sep', revenue, NULL)) AS Sep_Revenue,
       MAX(IF(month = 'Oct', revenue, NULL)) AS Oct_Revenue,
       MAX(IF(month = 'Nov', revenue, NULL)) AS Nov_Revenue,
       MAX(IF(month = 'Dec', revenue, NULL)) AS Dec_Revenue
FROM Department
GROUP BY id;`,
        explain: 'Since (id, month) is unique there is at most one value per cell, so MAX and SUM agree.',
      },
    ],
    traps: [
      { sql: "SELECT id, SUM(CASE WHEN month = 'Jan' THEN revenue ELSE 0 END) AS Jan_Revenue, SUM(CASE WHEN month = 'Feb' THEN revenue ELSE 0 END) AS Feb_Revenue, SUM(CASE WHEN month = 'Mar' THEN revenue ELSE 0 END) AS Mar_Revenue, SUM(CASE WHEN month = 'Apr' THEN revenue ELSE 0 END) AS Apr_Revenue, SUM(CASE WHEN month = 'May' THEN revenue ELSE 0 END) AS May_Revenue, SUM(CASE WHEN month = 'Jun' THEN revenue ELSE 0 END) AS Jun_Revenue, SUM(CASE WHEN month = 'Jul' THEN revenue ELSE 0 END) AS Jul_Revenue, SUM(CASE WHEN month = 'Aug' THEN revenue ELSE 0 END) AS Aug_Revenue, SUM(CASE WHEN month = 'Sep' THEN revenue ELSE 0 END) AS Sep_Revenue, SUM(CASE WHEN month = 'Oct' THEN revenue ELSE 0 END) AS Oct_Revenue, SUM(CASE WHEN month = 'Nov' THEN revenue ELSE 0 END) AS Nov_Revenue, SUM(CASE WHEN month = 'Dec' THEN revenue ELSE 0 END) AS Dec_Revenue FROM Department GROUP BY id;", why: '`ELSE 0` shows 0 for months without data; the problem wants NULL.' },
    ],
  },
];
