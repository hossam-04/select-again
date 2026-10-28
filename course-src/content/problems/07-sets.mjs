// Module 7: set operations
export default [
  {
    id: 1965,
    module: 'sets',
    order: true,
    patterns: ['symmetric difference', 'FULL JOIN emulation'],
    task: `An employee's information is missing if they have a \`name\` in \`Employees\` but no row in \`Salaries\`, or a row in \`Salaries\` but no row in \`Employees\`. Return the \`employee_id\` of every such employee, ordered by \`employee_id\`.`,
    schema: `CREATE TABLE Employees (employee_id INT PRIMARY KEY, name VARCHAR(30));
CREATE TABLE Salaries (employee_id INT PRIMARY KEY, salary INT);`,
    data: `INSERT INTO Employees VALUES (1, 'Ann'), (3, 'Bram'), (4, 'Cato'), (8, 'Dora');
INSERT INTO Salaries VALUES (1, 5000), (2, 6000), (4, 7000), (9, 8000);`,
    tests: [
      { name: "Salaries with no employees at all", data: `INSERT INTO Salaries VALUES (3, 100), (1, 200);` },
    ],
    hints: [
      'There are two kinds of missing: missing salary and missing name.',
      'Find each with an anti-join and stack the two lists.',
      'Alternatively: stack all ids from both tables and keep those that appear only once.',
    ],
    solution: {
      sql: `SELECT employee_id FROM Employees
WHERE employee_id NOT IN (SELECT employee_id FROM Salaries)
UNION
SELECT employee_id FROM Salaries
WHERE employee_id NOT IN (SELECT employee_id FROM Employees)
ORDER BY employee_id;`,
      explain: 'Each branch is one direction of the anti-join; the trailing ORDER BY sorts the combined list. (NOT IN is safe because both columns are primary keys.)',
    },
    alternatives: [
      {
        title: 'Ids that appear only once',
        sql: `SELECT employee_id
FROM (SELECT employee_id FROM Employees
      UNION ALL
      SELECT employee_id FROM Salaries) t
GROUP BY employee_id
HAVING COUNT(*) = 1
ORDER BY employee_id;`,
        explain: 'An id present in both tables appears twice in the stacked list; a missing-information id appears once.',
      },
    ],
    traps: [
      { sql: `SELECT e.employee_id FROM Employees e LEFT JOIN Salaries s ON s.employee_id = e.employee_id WHERE s.employee_id IS NULL ORDER BY e.employee_id;`, why: 'Only one direction: finds missing salaries but not missing names.' },
      { sql: `SELECT COALESCE(e.employee_id, s.employee_id) AS employee_id FROM Employees e FULL OUTER JOIN Salaries s ON s.employee_id = e.employee_id WHERE e.name IS NULL OR s.salary IS NULL ORDER BY 1;`, why: 'Logically right, but MySQL has no FULL OUTER JOIN, so LeetCode rejects it.' },
    ],
  },
  {
    id: 1795,
    module: 'sets',
    patterns: ['unpivot with UNION ALL'],
    task: `\`Products\` has one price column per store (\`store1\`, \`store2\`, \`store3\`); NULL means the store doesn't sell the product. Rearrange it into rows of (\`product_id\`, \`store\`, \`price\`), where \`store\` is the column's name. Skip the NULL prices. Any order.`,
    schema: `CREATE TABLE Products (product_id INT PRIMARY KEY, store1 INT, store2 INT, store3 INT);`,
    data: `INSERT INTO Products VALUES (10, 50, NULL, 60), (11, 20, 25, 30), (12, NULL, 70, NULL), (13, NULL, NULL, NULL);`,
    tests: [
      { name: "Only one store sells anything", data: `INSERT INTO Products VALUES (1, NULL, NULL, 5), (2, NULL, NULL, NULL);` },
    ],
    hints: ['One SELECT per store column, each labelling its rows with a constant store name.', 'Stack them with UNION ALL and drop NULL prices.'],
    solution: {
      sql: `SELECT product_id, 'store1' AS store, store1 AS price FROM Products WHERE store1 IS NOT NULL
UNION ALL
SELECT product_id, 'store2', store2 FROM Products WHERE store2 IS NOT NULL
UNION ALL
SELECT product_id, 'store3', store3 FROM Products WHERE store3 IS NOT NULL;`,
      explain: 'Each branch turns one column into rows. Column names come from the first branch, so only it needs aliases.',
    },
    alternatives: [
      {
        title: 'Cross join with a list of stores',
        sql: `SELECT product_id, store, price
FROM (
  SELECT p.product_id, s.store,
         CASE s.store WHEN 'store1' THEN p.store1
                      WHEN 'store2' THEN p.store2
                      ELSE p.store3 END AS price
  FROM Products p
  CROSS JOIN (SELECT 'store1' AS store UNION ALL SELECT 'store2' UNION ALL SELECT 'store3') s
) t
WHERE price IS NOT NULL;`,
        explain: 'Pair every product with every store, pick the matching column with CASE, then filter in an outer query — `price` is an alias, so WHERE could not use it at the same level.',
      },
    ],
    traps: [
      { sql: `SELECT product_id, 'store1' AS store, store1 AS price FROM Products UNION ALL SELECT product_id, 'store2', store2 FROM Products UNION ALL SELECT product_id, 'store3', store3 FROM Products;`, why: 'Keeps rows with NULL prices for stores that do not sell the product.' },
    ],
  },
  {
    id: 602,
    module: 'sets',
    sql50: true,
    patterns: ['stack both sides of a relationship'],
    task: `Each row of \`RequestAccepted\` makes the requester and the accepter friends. Find the person with the **most friends** and return \`id\` and \`num\` (their number of friends). Exactly one person has the most.`,
    schema: `CREATE TABLE RequestAccepted (requester_id INT, accepter_id INT, accept_date DATE, PRIMARY KEY (requester_id, accepter_id));`,
    data: `INSERT INTO RequestAccepted VALUES
  (1, 4, '2024-06-03'), (2, 4, '2024-06-05'), (4, 3, '2024-06-08'), (3, 5, '2024-06-09'),
  (6, 4, '2024-06-10'), (5, 6, '2024-06-11'), (2, 5, '2024-06-12');`,
    tests: [
      { name: "The winner never sent a request", data: `INSERT INTO RequestAccepted VALUES (1, 9, '2024-07-01'), (2, 9, '2024-07-02'), (3, 9, '2024-07-03'), (1, 2, '2024-07-04');` },
    ],
    hints: [
      'A friendship counts for both people — whichever column they appear in.',
      'Stack both columns into one list of ids with UNION ALL, then count.',
    ],
    solution: {
      sql: `SELECT id, COUNT(*) AS num
FROM (
  SELECT requester_id AS id FROM RequestAccepted
  UNION ALL
  SELECT accepter_id FROM RequestAccepted
) t
GROUP BY id
ORDER BY num DESC
LIMIT 1;`,
      explain: 'After stacking, each occurrence of an id is one friendship. `UNION ALL` matters: plain UNION would collapse the repeated ids.',
    },
    alternatives: [
      {
        title: 'Handles ties',
        sql: `WITH friends AS (
  SELECT id, COUNT(*) AS num
  FROM (SELECT requester_id AS id FROM RequestAccepted
        UNION ALL
        SELECT accepter_id FROM RequestAccepted) t
  GROUP BY id
)
SELECT id, num FROM friends
WHERE num = (SELECT MAX(num) FROM friends);`,
        explain: 'Returns everyone sharing the top count — the follow-up LeetCode asks about (CTEs are Module 8).',
      },
    ],
    traps: [
      { sql: `SELECT requester_id AS id, COUNT(*) AS num FROM RequestAccepted GROUP BY requester_id ORDER BY num DESC LIMIT 1;`, why: 'Counts only requests someone sent, ignoring friendships they accepted.' },
      { sql: `SELECT id, COUNT(*) AS num FROM (SELECT requester_id AS id FROM RequestAccepted UNION SELECT accepter_id FROM RequestAccepted) t GROUP BY id ORDER BY num DESC LIMIT 1;`, why: 'UNION de-duplicates, leaving each id once — every count becomes 1.' },
    ],
  },
  {
    id: 1341,
    module: 'sets',
    sql50: true,
    patterns: ['parenthesised UNION ALL', 'tie-break ordering'],
    task: `Return a single column \`results\` with two rows:

1. the \`name\` of the user who rated the **most movies** (ties → the alphabetically smaller name);
2. the \`title\` of the movie with the **highest average rating in February 2020** (ties → the alphabetically smaller title).`,
    schema: `CREATE TABLE Movies (movie_id INT PRIMARY KEY, title VARCHAR(30));
CREATE TABLE Users (user_id INT PRIMARY KEY, name VARCHAR(30));
CREATE TABLE MovieRating (movie_id INT, user_id INT, rating INT, created_at DATE, PRIMARY KEY (movie_id, user_id));`,
    data: `INSERT INTO Movies VALUES (1, 'Solaris'), (2, 'Heat'), (3, 'Up'), (4, 'Tenet');
INSERT INTO Users VALUES (1, 'Nadia'), (2, 'Omar'), (3, 'Lea'), (4, 'Tariq');
INSERT INTO MovieRating VALUES
  (1, 1, 2, '2020-01-12'), (1, 2, 5, '2020-02-11'), (1, 3, 1, '2020-02-12'), (1, 4, 3, '2020-01-01'),
  (2, 1, 4, '2020-02-17'), (2, 2, 3, '2020-02-01'), (2, 3, 1, '2020-03-01'),
  (3, 1, 4, '2020-02-22'), (3, 2, 3, '2020-02-25'),
  (4, 3, 5, '2020-01-31'), (4, 4, 5, '2020-02-29');`,
    tests: [
      {
        name: 'A user and a movie share a name',
        data: `INSERT INTO Movies VALUES (1, 'Rebecca'), (2, 'Blade');
INSERT INTO Users VALUES (1, 'Rebecca'), (2, 'Zed');
INSERT INTO MovieRating VALUES (1, 1, 5, '2020-02-02'), (2, 1, 3, '2020-02-03');`,
      },
    ],
    hints: [
      'Two independent questions — write each as its own `ORDER BY … LIMIT 1` query.',
      'Tie-breaks go into ORDER BY as a second key: `ORDER BY COUNT(*) DESC, name`.',
      'Combine with `UNION ALL` and parentheses around each branch. Why not plain UNION?',
      'February 2020 has 29 days.',
    ],
    solution: {
      sql: `(SELECT u.name AS results
 FROM MovieRating r
 JOIN Users u ON u.user_id = r.user_id
 GROUP BY u.user_id, u.name
 ORDER BY COUNT(*) DESC, u.name
 LIMIT 1)
UNION ALL
(SELECT m.title
 FROM MovieRating r
 JOIN Movies m ON m.movie_id = r.movie_id
 WHERE r.created_at >= '2020-02-01' AND r.created_at < '2020-03-01'
 GROUP BY m.movie_id, m.title
 ORDER BY AVG(r.rating) DESC, m.title
 LIMIT 1);`,
      explain: 'Parentheses let each branch have its own ORDER BY and LIMIT. `UNION ALL` keeps two rows even when the user\'s name equals the movie\'s title (the hidden test).',
    },
    alternatives: [],
    traps: [
      { sql: `(SELECT u.name AS results FROM MovieRating r JOIN Users u ON u.user_id = r.user_id GROUP BY u.user_id, u.name ORDER BY COUNT(*) DESC, u.name LIMIT 1) UNION (SELECT m.title FROM MovieRating r JOIN Movies m ON m.movie_id = r.movie_id WHERE r.created_at >= '2020-02-01' AND r.created_at < '2020-03-01' GROUP BY m.movie_id, m.title ORDER BY AVG(r.rating) DESC, m.title LIMIT 1);`, why: 'UNION collapses the two rows into one when the name and the title are equal.' },
      { sql: `(SELECT u.name AS results FROM MovieRating r JOIN Users u ON u.user_id = r.user_id GROUP BY u.user_id, u.name ORDER BY COUNT(*) DESC, u.name LIMIT 1) UNION ALL (SELECT m.title FROM MovieRating r JOIN Movies m ON m.movie_id = r.movie_id WHERE r.created_at BETWEEN '2020-02-01' AND '2020-02-28' GROUP BY m.movie_id, m.title ORDER BY AVG(r.rating) DESC, m.title LIMIT 1);`, why: 'Stops at Feb 28 and misses the leap-day rating that makes Tenet the top movie.' },
    ],
  },
  {
    id: 1789,
    module: 'sets',
    sql50: true,
    patterns: ['UNION of two cases'],
    task: `An employee can belong to several departments, one of which is flagged primary (\`primary_flag = 'Y'\`). An employee who belongs to a **single** department has it flagged 'N'. Return \`employee_id\` and \`department_id\` of each employee's primary department — or their only department. Any order.`,
    schema: `CREATE TABLE Employee (employee_id INT, department_id INT, primary_flag ENUM('Y', 'N'), PRIMARY KEY (employee_id, department_id));`,
    data: `INSERT INTO Employee VALUES (1, 2, 'N'), (2, 3, 'N'), (2, 5, 'Y'), (3, 7, 'N'), (4, 1, 'Y'), (4, 2, 'N'), (4, 6, 'N'), (5, 4, 'N');`,
    tests: [
      { name: "Everyone has a single department", data: `INSERT INTO Employee VALUES (1, 10, 'N'), (2, 20, 'N');` },
    ],
    hints: [
      'Two disjoint cases: rows flagged Y, and employees with exactly one row.',
      'Answer each case with its own SELECT and stack them.',
      'In the grouped branch, `department_id` is neither grouped nor aggregated — MySQL will complain.',
    ],
    solution: {
      sql: `SELECT employee_id, department_id
FROM Employee
WHERE primary_flag = 'Y'
UNION
SELECT employee_id, MAX(department_id) AS department_id
FROM Employee
GROUP BY employee_id
HAVING COUNT(*) = 1;`,
      explain: 'The grouped branch finds single-department employees; `MAX(department_id)` is just a legal way to fetch the only value (ONLY_FULL_GROUP_BY rejects the bare column).',
    },
    alternatives: [
      {
        title: 'Window count',
        sql: `SELECT employee_id, department_id
FROM (
  SELECT e.*, COUNT(*) OVER (PARTITION BY employee_id) AS n
  FROM Employee e
) t
WHERE primary_flag = 'Y' OR n = 1;`,
        explain: 'Annotate each row with how many departments its employee has, then keep primary rows and only-rows in one pass.',
      },
    ],
    traps: [
      { sql: `SELECT employee_id, department_id FROM Employee WHERE primary_flag = 'Y' UNION SELECT employee_id, department_id FROM Employee GROUP BY employee_id HAVING COUNT(*) = 1;`, why: 'Returns the right rows, but MySQL rejects the bare `department_id` in the grouped branch (ONLY_FULL_GROUP_BY).' },
      { sql: `SELECT employee_id, department_id FROM Employee WHERE primary_flag = 'Y';`, why: 'Misses employees who belong to a single department (flagged N).' },
    ],
  },
  {
    id: 1907,
    module: 'sets',
    sql50: true,
    patterns: ['fixed category list', 'zero rows at zero count'],
    task: `Count the accounts in each salary category and return \`category\` and \`accounts_count\`:

- \`'Low Salary'\`: income strictly below 20000;
- \`'Average Salary'\`: income from 20000 to 50000 inclusive;
- \`'High Salary'\`: income strictly above 50000.

All three categories must appear, with 0 when empty. Any order.`,
    schema: `CREATE TABLE Accounts (account_id INT PRIMARY KEY, income INT);`,
    data: `INSERT INTO Accounts VALUES (1, 19999), (2, 20000), (3, 50000), (4, 50001), (5, 70000), (6, 120000);`,
    tests: [
      { name: 'No average salaries', data: `INSERT INTO Accounts VALUES (1, 5000), (2, 90000);` },
      { name: 'No accounts at all', data: `` },
    ],
    hints: [
      'GROUP BY only creates groups that have rows — an empty category would vanish.',
      'Produce each category row yourself: one SELECT per category, stacked with UNION ALL.',
      'Count with something that yields 0 (not NULL) on an empty table.',
    ],
    solution: {
      sql: `SELECT 'Low Salary' AS category, COUNT(CASE WHEN income < 20000 THEN 1 END) AS accounts_count FROM Accounts
UNION ALL
SELECT 'Average Salary', COUNT(CASE WHEN income BETWEEN 20000 AND 50000 THEN 1 END) FROM Accounts
UNION ALL
SELECT 'High Salary', COUNT(CASE WHEN income > 50000 THEN 1 END) FROM Accounts;`,
      explain: 'Each branch is an aggregate without GROUP BY, so it always returns exactly one row — even when no account matches, or the table is empty (COUNT gives 0 where SUM would give NULL).',
    },
    alternatives: [
      {
        title: 'Category list + LEFT JOIN',
        sql: `SELECT c.category, COUNT(a.account_id) AS accounts_count
FROM (SELECT 'Low Salary' AS category UNION ALL SELECT 'Average Salary' UNION ALL SELECT 'High Salary') c
LEFT JOIN Accounts a
       ON c.category = CASE WHEN a.income < 20000 THEN 'Low Salary'
                            WHEN a.income <= 50000 THEN 'Average Salary'
                            ELSE 'High Salary' END
GROUP BY c.category;`,
        explain: 'Build the list of categories, then attach accounts to their category; empty categories keep a NULL-padded row and count 0.',
      },
    ],
    traps: [
      { sql: `SELECT CASE WHEN income < 20000 THEN 'Low Salary' WHEN income <= 50000 THEN 'Average Salary' ELSE 'High Salary' END AS category, COUNT(*) AS accounts_count FROM Accounts GROUP BY category;`, why: 'Categories with no accounts disappear instead of showing 0.' },
      { sql: `SELECT 'Low Salary' AS category, SUM(income < 20000) AS accounts_count FROM Accounts UNION ALL SELECT 'Average Salary', SUM(income BETWEEN 20000 AND 50000) FROM Accounts UNION ALL SELECT 'High Salary', SUM(income > 50000) FROM Accounts;`, why: 'Works until the table is empty: SUM over zero rows is NULL, not 0.' },
      { sql: `SELECT 'Low Salary' AS category, COUNT(CASE WHEN income < 20000 THEN 1 END) AS accounts_count FROM Accounts UNION ALL SELECT 'Average Salary', COUNT(CASE WHEN income > 20000 AND income < 50000 THEN 1 END) FROM Accounts UNION ALL SELECT 'High Salary', COUNT(CASE WHEN income > 50000 THEN 1 END) FROM Accounts;`, why: 'The average range is inclusive at both ends: 20000 and 50000 belong in it.' },
    ],
  },
];
