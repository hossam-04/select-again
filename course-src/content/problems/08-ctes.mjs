// Module 8: CTEs and recursion
export default [
  {
    id: 262,
    module: 'ctes',
    patterns: ['filter both joined users', 'rate per day', 'CTE'],
    task: `A trip counts only if **both** its client and its driver are unbanned. For each day from **2013-10-01 to 2013-10-03** that has at least one counted trip, return \`Day\` and \`Cancellation Rate\`: the share of counted trips whose status is a cancellation (by client or driver), rounded to 2 decimals. Any order.

Note the output column name contains a space.`,
    schema: `CREATE TABLE Trips (id INT PRIMARY KEY, client_id INT, driver_id INT, city_id INT, status ENUM('completed', 'cancelled_by_driver', 'cancelled_by_client'), request_at VARCHAR(50));
CREATE TABLE Users (users_id INT PRIMARY KEY, banned VARCHAR(50), role ENUM('client', 'driver', 'partner'));`,
    data: `INSERT INTO Users VALUES
  (21, 'No', 'client'), (22, 'Yes', 'client'), (23, 'No', 'client'), (24, 'No', 'client'),
  (31, 'No', 'driver'), (32, 'No', 'driver'), (33, 'No', 'driver'), (34, 'Yes', 'driver');
INSERT INTO Trips VALUES
  (1, 21, 31, 5, 'completed', '2013-10-01'), (2, 22, 32, 5, 'cancelled_by_driver', '2013-10-01'),
  (3, 23, 33, 7, 'cancelled_by_client', '2013-10-01'), (4, 24, 34, 7, 'completed', '2013-10-01'),
  (5, 21, 32, 5, 'completed', '2013-10-01'),
  (6, 22, 31, 7, 'completed', '2013-10-02'), (7, 23, 32, 7, 'cancelled_by_driver', '2013-10-02'), (8, 24, 31, 9, 'cancelled_by_client', '2013-10-02'),
  (9, 23, 31, 9, 'completed', '2013-10-03'), (10, 24, 32, 9, 'cancelled_by_driver', '2013-10-03'),
  (11, 21, 33, 9, 'completed', '2013-10-03'), (12, 22, 34, 9, 'cancelled_by_client', '2013-10-03'),
  (13, 21, 31, 5, 'cancelled_by_client', '2013-10-04'), (14, 23, 32, 5, 'cancelled_by_driver', '2013-09-30');`,
    tests: [
      {
        name: 'A day where every trip involves a banned user',
        data: `INSERT INTO Users VALUES (21, 'No', 'client'), (22, 'Yes', 'client'), (31, 'No', 'driver');
INSERT INTO Trips VALUES (1, 21, 31, 1, 'cancelled_by_client', '2013-10-01'), (2, 22, 31, 1, 'completed', '2013-10-02');`,
      },
    ],
    hints: [
      'Join Users twice — once as the client, once as the driver — and require both to be unbanned.',
      'Restrict to the three days, then group by day.',
      "The rate is the average of `status <> 'completed'` over the counted trips.",
      'Quote the output name with backticks: `` `Cancellation Rate` ``.',
    ],
    solution: {
      sql: `WITH counted AS (             -- one row per trip with two unbanned users
  SELECT t.request_at, t.status
  FROM Trips t
  JOIN Users c ON c.users_id = t.client_id AND c.banned = 'No'
  JOIN Users d ON d.users_id = t.driver_id AND d.banned = 'No'
  WHERE t.request_at BETWEEN '2013-10-01' AND '2013-10-03'
)
SELECT request_at AS Day,
       ROUND(AVG(status <> 'completed'), 2) AS \`Cancellation Rate\`
FROM counted
GROUP BY request_at;`,
      explain: 'Joining Users under two aliases applies the ban check to each role. Days whose trips were all excluded produce no group at all, which is what the problem wants.',
    },
    alternatives: [
      {
        title: 'NOT IN banned users',
        sql: `SELECT request_at AS Day,
       ROUND(SUM(status LIKE 'cancelled%') / COUNT(*), 2) AS \`Cancellation Rate\`
FROM Trips
WHERE request_at BETWEEN '2013-10-01' AND '2013-10-03'
  AND client_id NOT IN (SELECT users_id FROM Users WHERE banned = 'Yes')
  AND driver_id NOT IN (SELECT users_id FROM Users WHERE banned = 'Yes')
GROUP BY request_at;`,
        explain: 'Exclude trips touching any banned id. NOT IN is safe here — users_id is a primary key.',
      },
    ],
    traps: [
      { sql: "SELECT t.request_at AS Day, ROUND(AVG(t.status <> 'completed'), 2) AS `Cancellation Rate` FROM Trips t JOIN Users c ON c.users_id = t.client_id AND c.banned = 'No' WHERE t.request_at BETWEEN '2013-10-01' AND '2013-10-03' GROUP BY t.request_at;", why: 'Only checks the client; trip 4 has a banned driver and must be excluded.' },
      { sql: "SELECT t.request_at AS Day, ROUND(AVG(t.status <> 'completed'), 2) AS `Cancellation Rate` FROM Trips t JOIN Users c ON c.users_id = t.client_id AND c.banned = 'No' JOIN Users d ON d.users_id = t.driver_id AND d.banned = 'No' GROUP BY t.request_at;", why: 'Forgets the date range, so Sep 30 and Oct 4 appear.' },
      { sql: "SELECT t.request_at AS Day, ROUND(AVG(t.status = 'cancelled_by_driver'), 2) AS `Cancellation Rate` FROM Trips t JOIN Users c ON c.users_id = t.client_id AND c.banned = 'No' JOIN Users d ON d.users_id = t.driver_id AND d.banned = 'No' WHERE t.request_at BETWEEN '2013-10-01' AND '2013-10-03' GROUP BY t.request_at;", why: 'Counts only driver cancellations; client cancellations count too.' },
    ],
  },
  {
    id: 3482,
    module: 'ctes',
    order: true,
    patterns: ['recursive CTE', 'hierarchy levels', 'subtree totals'],
    task: `\`Employees\` is an org chart: each row has a \`manager_id\` (NULL for the CEO). For **every** employee return:

- \`employee_id\`, \`employee_name\`;
- \`level\`: 1 for the CEO, 2 for their direct reports, and so on;
- \`team_size\`: how many people are under them, directly or indirectly;
- \`budget\`: their own salary plus the salaries of everyone under them.

Order by \`level\` ascending, then \`budget\` descending, then \`employee_name\` ascending.`,
    schema: `CREATE TABLE Employees (employee_id INT PRIMARY KEY, employee_name VARCHAR(100), manager_id INT, salary INT, department VARCHAR(50));`,
    data: `INSERT INTO Employees VALUES
  (1, 'Ada', NULL, 20000, 'Executive'),
  (2, 'Ben', 1, 12000, 'Sales'), (3, 'Cid', 1, 12000, 'Engineering'),
  (4, 'Dee', 2, 8000, 'Sales'), (5, 'Eva', 2, 7000, 'Sales'), (6, 'Fox', 3, 9000, 'Engineering'),
  (7, 'Hal', 6, 5000, 'Engineering'), (8, 'Gil', 6, 5000, 'Engineering'), (9, 'Ivy', 4, 6000, 'Sales');`,
    tests: [
      { name: "A straight chain", data: `INSERT INTO Employees VALUES (1, 'Ana', NULL, 100, 'X'), (2, 'Ben', 1, 50, 'X'), (3, 'Cy', 2, 25, 'X'), (4, 'Dov', 3, 10, 'X');` },
    ],
    hints: [
      'Levels: a recursive CTE that starts at the CEO (level 1) and adds 1 per step down.',
      'Team size and budget need every (manager, member) pair at any depth — another recursive CTE that starts from each employee paired with themselves.',
      'Aggregate the pairs per manager: COUNT(*) − 1 people under them, SUM(salary) including their own.',
    ],
    solution: {
      sql: `WITH RECURSIVE levels AS (          -- one row per employee, with depth
  SELECT employee_id, employee_name, 1 AS level
  FROM Employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.employee_id, e.employee_name, l.level + 1
  FROM Employees e
  JOIN levels l ON e.manager_id = l.employee_id
),
pairs AS (                           -- (root, member) for every member of root's subtree, root included
  SELECT employee_id AS root_id, employee_id AS member_id, salary
  FROM Employees
  UNION ALL
  SELECT p.root_id, e.employee_id, e.salary
  FROM pairs p
  JOIN Employees e ON e.manager_id = p.member_id
)
SELECT l.employee_id, l.employee_name, l.level,
       COUNT(*) - 1  AS team_size,
       SUM(p.salary) AS budget
FROM levels l
JOIN pairs p ON p.root_id = l.employee_id
GROUP BY l.employee_id, l.employee_name, l.level
ORDER BY l.level, budget DESC, l.employee_name;`,
      explain: 'Two recursions over the same tree: `levels` walks down from the root counting depth; `pairs` walks down from **every** node, so each employee ends up paired with everyone beneath them (and themselves). Aggregating the pairs gives both totals at once.',
    },
    alternatives: [],
    traps: [
      { sql: "WITH RECURSIVE levels AS (SELECT employee_id, employee_name, 1 AS level FROM Employees WHERE manager_id IS NULL UNION ALL SELECT e.employee_id, e.employee_name, l.level + 1 FROM Employees e JOIN levels l ON e.manager_id = l.employee_id) SELECT l.employee_id, l.employee_name, l.level, COUNT(r.employee_id) AS team_size, x.salary + IFNULL(SUM(r.salary), 0) AS budget FROM levels l JOIN Employees x ON x.employee_id = l.employee_id LEFT JOIN Employees r ON r.manager_id = l.employee_id GROUP BY l.employee_id, l.employee_name, l.level, x.salary ORDER BY l.level, budget DESC, l.employee_name;", why: 'Counts only direct reports; indirect reports (Fox\'s team under Cid) are missed.' },
    ],
  },
];
