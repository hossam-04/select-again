// Module 9: window functions
export default [
  {
    id: 178,
    module: 'windows',
    order: true,
    patterns: ['DENSE_RANK', 'reserved word alias'],
    task: `Rank the scores from highest to lowest. Equal scores share a rank, and ranks have **no gaps** after ties (1, 2, 2, 3). Return \`score\` and \`rank\`, ordered by \`score\` descending.`,
    schema: `CREATE TABLE Scores (id INT PRIMARY KEY, score DECIMAL(3,2));`,
    data: `INSERT INTO Scores VALUES (1, 3.20), (2, 4.10), (3, 3.75), (4, 4.10), (5, 2.95), (6, 3.75), (7, 3.40);`,
    tests: [
      { name: "Everyone ties but one", data: `INSERT INTO Scores VALUES (1, 3.50), (2, 3.50), (3, 3.50), (4, 1.00);` },
    ],
    hints: [
      'Ranking with shared ranks and no gaps is exactly DENSE_RANK.',
      '`rank` is a reserved word in MySQL 8 — quote the alias with backticks.',
    ],
    solution: {
      sql: `SELECT score,
       DENSE_RANK() OVER (ORDER BY score DESC) AS \`rank\`
FROM Scores
ORDER BY score DESC;`,
      explain: 'DENSE_RANK gives tied scores the same rank and continues with the next integer. The backticks are required: RANK became a reserved word in MySQL 8.0.2.',
    },
    alternatives: [
      {
        title: 'Without window functions',
        sql: `SELECT s.score,
       (SELECT COUNT(DISTINCT s2.score) FROM Scores s2 WHERE s2.score >= s.score) AS \`rank\`
FROM Scores s
ORDER BY s.score DESC;`,
        explain: 'A score\'s dense rank is the number of distinct scores greater than or equal to it — the classic pre-MySQL-8 answer.',
      },
    ],
    traps: [
      { sql: "SELECT score, RANK() OVER (ORDER BY score DESC) AS `rank` FROM Scores ORDER BY score DESC;", why: 'RANK leaves gaps after ties (1, 1, 3), the problem wants none.' },
      { sql: 'SELECT score, DENSE_RANK() OVER (ORDER BY score DESC) AS rank FROM Scores ORDER BY score DESC;', why: 'Correct numbers, but MySQL 8 rejects the unquoted alias `rank` (reserved word).' },
    ],
  },
  {
    id: 180,
    module: 'windows',
    sql50: true,
    patterns: ['consecutive rows', 'LAG / self-join'],
    task: `\`Logs\` has ids 1, 2, 3, … in order. Return every \`num\` that appears **at least three times in a row** (consecutive ids), each once, in a column \`ConsecutiveNums\`. Any order.`,
    schema: `CREATE TABLE Logs (id INT PRIMARY KEY, num VARCHAR(10));`,
    data: `INSERT INTO Logs VALUES
  (1, '7'), (2, '7'), (3, '7'), (4, '3'), (5, '7'), (6, '3'), (7, '3'), (8, '3'), (9, '3'),
  (10, '5'), (11, '5'), (12, '7'), (13, '7'), (14, '7'), (15, '5');`,
    tests: [
      { name: "The run is at the very end", data: `INSERT INTO Logs VALUES (1, '1'), (2, '2'), (3, '2'), (4, '1'), (5, '1'), (6, '1');` },
    ],
    hints: [
      'Compare each row with the two rows before it.',
      'LAG(num, 1) and LAG(num, 2) — or join the table to itself on id + 1 and id + 2.',
      'A run can appear more than once, and a run of four contains two runs of three: de-duplicate.',
    ],
    solution: {
      sql: `SELECT DISTINCT num AS ConsecutiveNums
FROM (
  SELECT num,
         LAG(num, 1) OVER (ORDER BY id) AS prev1,
         LAG(num, 2) OVER (ORDER BY id) AS prev2
  FROM Logs
) t
WHERE num = prev1 AND num = prev2;`,
      explain: 'A row whose value equals the two previous values ends a run of at least three. DISTINCT collapses repeated runs (the 7s run twice, the 3s form a run of four).',
    },
    alternatives: [
      {
        title: 'Self-join on consecutive ids',
        sql: `SELECT DISTINCT l1.num AS ConsecutiveNums
FROM Logs l1
JOIN Logs l2 ON l2.id = l1.id + 1 AND l2.num = l1.num
JOIN Logs l3 ON l3.id = l1.id + 2 AND l3.num = l1.num;`,
        explain: 'Works because ids have no gaps. For "at least N in a row" with larger N, the gaps-and-islands pattern in Module 10 scales better.',
      },
    ],
    traps: [
      { sql: 'SELECT num AS ConsecutiveNums FROM Logs GROUP BY num HAVING COUNT(*) >= 3;', why: 'Counts total occurrences, not consecutive ones — the 5s appear three times but never three in a row.' },
      { sql: 'SELECT l1.num AS ConsecutiveNums FROM Logs l1 JOIN Logs l2 ON l2.id = l1.id + 1 AND l2.num = l1.num JOIN Logs l3 ON l3.id = l1.id + 2 AND l3.num = l1.num;', why: 'Without DISTINCT, a number is repeated once per qualifying window.' },
    ],
  },
  {
    id: 1204,
    module: 'windows',
    sql50: true,
    patterns: ['running total', 'last row under a limit'],
    task: `People board a bus in \`turn\` order; the bus holds at most **1000 kg** in total. Return the \`person_name\` of the last person who can board without the running total exceeding the limit. The first person always fits.`,
    schema: `CREATE TABLE Queue (person_id INT PRIMARY KEY, person_name VARCHAR(30), weight INT, turn INT);`,
    data: `INSERT INTO Queue VALUES
  (3, 'Nora', 300, 1), (1, 'Owen', 180, 2), (6, 'Pia', 220, 3), (2, 'Quin', 260, 4),
  (5, 'Ravi', 90, 5), (4, 'Sofi', 30, 6);`,
    tests: [{ name: 'Exactly 1000 kg', data: `INSERT INTO Queue VALUES (1, 'Ana', 300, 1), (2, 'Ben', 700, 2), (3, 'Cy', 1, 3);` }],
    hints: [
      'Compute the cumulative weight in boarding order: SUM(weight) OVER (ORDER BY turn).',
      'Keep people whose cumulative weight is at most 1000, and take the one with the largest turn.',
    ],
    solution: {
      sql: `SELECT person_name
FROM (
  SELECT person_name, turn,
         SUM(weight) OVER (ORDER BY turn) AS total_weight
  FROM Queue
) t
WHERE total_weight <= 1000
ORDER BY turn DESC
LIMIT 1;`,
      explain: 'The running total is a window SUM ordered by `turn`. "At most 1000" includes exactly 1000 (the hidden test).',
    },
    alternatives: [
      {
        title: 'Self-join running total',
        sql: `SELECT q1.person_name
FROM Queue q1
JOIN Queue q2 ON q2.turn <= q1.turn
GROUP BY q1.turn, q1.person_name
HAVING SUM(q2.weight) <= 1000
ORDER BY q1.turn DESC
LIMIT 1;`,
        explain: 'Each person joined with everyone who boards before (or with) them; the sum of that group is their running total. O(n²), but it shows what the window does.',
      },
    ],
    traps: [
      { sql: 'SELECT person_name FROM (SELECT person_name, turn, SUM(weight) OVER (ORDER BY turn) AS total_weight FROM Queue) t WHERE total_weight < 1000 ORDER BY turn DESC LIMIT 1;', why: 'Excludes the person who brings the total to exactly 1000.' },
      { sql: 'SELECT person_name FROM (SELECT person_name, person_id, SUM(weight) OVER (ORDER BY person_id) AS total_weight FROM Queue) t WHERE total_weight <= 1000 ORDER BY person_id DESC LIMIT 1;', why: 'Boards in person_id order instead of turn order.' },
    ],
  },
  {
    id: 1321,
    module: 'windows',
    sql50: true,
    order: true,
    patterns: ['moving window', 'aggregate first'],
    task: `The restaurant has customers every day. For each day that has a **full 7-day window** behind it (that day and the 6 days before), return \`visited_on\`, \`amount\` (the total paid over those 7 days) and \`average_amount\` (that total ÷ 7, rounded to 2 decimals). Order by \`visited_on\`.`,
    schema: `CREATE TABLE Customer (customer_id INT, name VARCHAR(20), visited_on DATE, amount INT, PRIMARY KEY (customer_id, visited_on));`,
    data: `INSERT INTO Customer VALUES
  (1, 'Ann', '2024-01-01', 90), (2, 'Bo', '2024-01-02', 120), (3, 'Cal', '2024-01-03', 60),
  (4, 'Dia', '2024-01-04', 150), (5, 'Eli', '2024-01-05', 75), (6, 'Fay', '2024-01-06', 200),
  (7, 'Gus', '2024-01-07', 110), (8, 'Hal', '2024-01-08', 95), (9, 'Ida', '2024-01-09', 130),
  (1, 'Ann', '2024-01-10', 80), (3, 'Cal', '2024-01-10', 140), (2, 'Bo', '2024-01-04', 40);`,
    tests: [
      { name: "Exactly one full window", data: `INSERT INTO Customer VALUES (1, 'Ari', '2024-02-01', 10), (2, 'Bea', '2024-02-02', 20), (3, 'Cy', '2024-02-03', 30), (4, 'Dov', '2024-02-04', 40), (5, 'Eno', '2024-02-04', 5), (6, 'Fia', '2024-02-05', 50), (7, 'Gus', '2024-02-06', 60), (8, 'Hal', '2024-02-07', 70);` },
    ],
    hints: [
      'Several customers can visit on one day: total per day first.',
      'Then a window SUM over "this row and the 6 before" — `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW`.',
      'Skip the first 6 days, whose window is incomplete.',
    ],
    solution: {
      sql: `WITH daily AS (                 -- one row per day
  SELECT visited_on, SUM(amount) AS amount
  FROM Customer
  GROUP BY visited_on
),
windowed AS (
  SELECT visited_on,
         SUM(amount) OVER (ORDER BY visited_on ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS amount,
         ROW_NUMBER() OVER (ORDER BY visited_on) AS day_no
  FROM daily
)
SELECT visited_on, amount, ROUND(amount / 7, 2) AS average_amount
FROM windowed
WHERE day_no >= 7
ORDER BY visited_on;`,
      explain: 'Aggregating per day first makes one row per day, so "6 rows before" really means "6 days before" (the problem guarantees every day has customers).',
    },
    alternatives: [
      {
        title: 'RANGE frame with a date interval',
        sql: `WITH daily AS (
  SELECT visited_on, SUM(amount) AS amount
  FROM Customer
  GROUP BY visited_on
)
SELECT visited_on, amount, average_amount
FROM (
  SELECT visited_on,
         SUM(amount) OVER (ORDER BY visited_on RANGE BETWEEN INTERVAL 6 DAY PRECEDING AND CURRENT ROW) AS amount,
         ROUND(SUM(amount) OVER (ORDER BY visited_on RANGE BETWEEN INTERVAL 6 DAY PRECEDING AND CURRENT ROW) / 7, 2) AS average_amount
  FROM daily
) t
WHERE visited_on >= (SELECT MIN(visited_on) FROM Customer) + INTERVAL 6 DAY
ORDER BY visited_on;`,
        explain: 'MySQL can frame by date distance instead of row count, which stays correct even if a day were missing.',
      },
      {
        title: 'Self-join on a date range',
        sql: `SELECT d.visited_on,
       SUM(c.amount) AS amount,
       ROUND(SUM(c.amount) / 7, 2) AS average_amount
FROM (SELECT DISTINCT visited_on FROM Customer) d
JOIN Customer c
  ON c.visited_on BETWEEN DATE_SUB(d.visited_on, INTERVAL 6 DAY) AND d.visited_on
WHERE d.visited_on >= (SELECT MIN(visited_on) FROM Customer) + INTERVAL 6 DAY
GROUP BY d.visited_on
ORDER BY d.visited_on;`,
        explain: 'Each day joined with every visit in its 7-day range, then summed.',
      },
    ],
    traps: [
      { sql: 'SELECT visited_on, amount, average_amount FROM (SELECT visited_on, SUM(amount) OVER (ORDER BY visited_on ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS amount, ROUND(AVG(amount) OVER (ORDER BY visited_on ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS average_amount, ROW_NUMBER() OVER (ORDER BY visited_on) AS n FROM Customer) t WHERE n >= 7 ORDER BY visited_on;', why: 'Windows over raw visits, not days: with two visits on a day, "6 rows before" is fewer than 6 days.' },
      { sql: 'WITH daily AS (SELECT visited_on, SUM(amount) AS amount FROM Customer GROUP BY visited_on) SELECT visited_on, SUM(amount) OVER (ORDER BY visited_on ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS amount, ROUND(AVG(amount) OVER (ORDER BY visited_on ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS average_amount FROM daily ORDER BY visited_on;', why: 'Includes the first six days, whose windows are not full.' },
    ],
  },
  {
    id: 177,
    module: 'windows',
    kind: 'function',
    fn: { name: 'getNthHighestSalary', args: [2] },
    patterns: ['stored function', 'N-th highest distinct', 'LIMIT arithmetic'],
    task: `Write the body of the MySQL function \`getNthHighestSalary(N)\`: it returns the **N-th highest distinct** salary in \`Employee\`, or NULL if there are fewer than N distinct salaries. The checker calls it with several values of N.`,
    starter: `CREATE FUNCTION getNthHighestSalary(N INT) RETURNS INT
BEGIN
  RETURN (
    -- your query here
    SELECT NULL
  );
END`,
    schema: `CREATE TABLE Employee (id INT PRIMARY KEY, salary INT);`,
    data: `INSERT INTO Employee VALUES (1, 100), (2, 300), (3, 300), (4, 200), (5, 50);`,
    tests: [
      { name: 'Same data, N = 1, 4, 5', data: `INSERT INTO Employee VALUES (1, 100), (2, 300), (3, 300), (4, 200), (5, 50);`, argsList: [[1], [4], [5]] },
      { name: 'One employee, N = 1, 2', data: `INSERT INTO Employee VALUES (1, 100);`, argsList: [[1], [2]] },
    ],
    hints: [
      'Distinct salaries, sorted descending; skip N − 1 of them and take one.',
      "MySQL's LIMIT/OFFSET accepts only literals or variables, not expressions like `N - 1`. Compute it first with `SET N = N - 1;`.",
      'Or rank with DENSE_RANK and pick rank N — no arithmetic in LIMIT at all.',
    ],
    solution: {
      sql: `CREATE FUNCTION getNthHighestSalary(N INT) RETURNS INT
BEGIN
  SET N = N - 1;
  RETURN (
    SELECT DISTINCT salary
    FROM Employee
    ORDER BY salary DESC
    LIMIT 1 OFFSET N
  );
END`,
      explain: 'The subquery returns the N-th distinct salary, or no row — which RETURN turns into NULL. `SET N = N - 1` is there because `OFFSET N - 1` is a syntax error in MySQL.',
    },
    alternatives: [
      {
        title: 'DENSE_RANK',
        sql: `CREATE FUNCTION getNthHighestSalary(N INT) RETURNS INT
BEGIN
  RETURN (
    SELECT MAX(salary)
    FROM (SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS rnk FROM Employee) t
    WHERE rnk = N
  );
END`,
        explain: 'DENSE_RANK numbers distinct salary levels 1, 2, 3…; MAX over the rows with rank N gives the value or NULL.',
      },
    ],
    traps: [
      {
        sql: `CREATE FUNCTION getNthHighestSalary(N INT) RETURNS INT
BEGIN
  RETURN (SELECT DISTINCT salary FROM Employee ORDER BY salary DESC LIMIT 1 OFFSET N - 1);
END`,
        why: 'MySQL does not allow an expression in OFFSET, even inside a function.',
      },
      {
        sql: `CREATE FUNCTION getNthHighestSalary(N INT) RETURNS INT
BEGIN
  SET N = N - 1;
  RETURN (SELECT salary FROM Employee ORDER BY salary DESC LIMIT 1 OFFSET N);
END`,
        why: 'Without DISTINCT the duplicate 300 takes two places, so N = 2 returns 300.',
      },
    ],
  },
];
