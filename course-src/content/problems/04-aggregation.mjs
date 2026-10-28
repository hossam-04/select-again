// Module 4: GROUP BY, HAVING, conditional aggregation
export default [
  {
    id: 182,
    module: 'aggregation',
    patterns: ['GROUP BY + HAVING'],
    task: `Report every email address that appears in more than one row of \`Person\`. Each duplicated email should appear **once**, in a column named \`Email\`. Emails are never NULL and are all lowercase. Any order.`,
    schema: `CREATE TABLE Person (id INT PRIMARY KEY, email VARCHAR(255));`,
    data: `INSERT INTO Person VALUES (1, 'ana@x.io'), (2, 'bo@x.io'), (3, 'ana@x.io'), (4, 'cy@x.io'), (5, 'bo@x.io'), (6, 'bo@x.io'), (7, 'dee@x.io');`,
    tests: [{ name: 'No duplicates', data: `INSERT INTO Person VALUES (1, 'a@b.c'), (2, 'd@e.f');` }],
    hints: [
      'Group the rows by email and count each group.',
      'Keep only groups with a count above 1 — that is a HAVING condition.',
      'Name the output column exactly `Email`.',
    ],
    solution: {
      sql: `SELECT email AS Email
FROM Person
GROUP BY email
HAVING COUNT(*) > 1;`,
      explain: 'One group per email; HAVING keeps the groups with more than one row. `bo@x.io` appears three times but, being one group, is reported once.',
    },
    alternatives: [
      {
        title: 'Self-join',
        sql: `SELECT DISTINCT p1.email AS Email
FROM Person p1
JOIN Person p2 ON p1.email = p2.email AND p1.id <> p2.id;`,
        explain: 'Pairs each row with a *different* row that has the same email. DISTINCT is essential: an email that appears three times forms six pairs.',
      },
    ],
    traps: [
      { sql: `SELECT email AS Email FROM Person GROUP BY email HAVING COUNT(*) = 2;`, why: 'Misses emails that appear three or more times.' },
      { sql: `SELECT p1.email AS Email FROM Person p1 JOIN Person p2 ON p1.email = p2.email AND p1.id <> p2.id;`, why: 'Without DISTINCT the self-join returns each duplicated email once per matching pair.' },
    ],
  },
  {
    id: 596,
    module: 'aggregation',
    sql50: true,
    patterns: ['GROUP BY + HAVING'],
    task: `Each row of \`Courses\` enrolls one student in one class (the pair is unique). Return every \`class\` that has **at least five** students. Any order.`,
    schema: `CREATE TABLE Courses (student VARCHAR(30), class VARCHAR(30), PRIMARY KEY (student, class));`,
    data: `INSERT INTO Courses VALUES
  ('A', 'Math'), ('B', 'Math'), ('C', 'Math'), ('D', 'Math'), ('E', 'Math'),
  ('A', 'English'), ('F', 'English'), ('G', 'English'),
  ('B', 'Biology'), ('C', 'Biology'), ('D', 'Biology'), ('E', 'Biology'), ('F', 'Biology'), ('G', 'Biology'),
  ('H', 'Art'), ('I', 'Art'), ('J', 'Art'), ('K', 'Art');`,
    tests: [
      { name: "Nobody reaches five", data: `INSERT INTO Courses VALUES ('A', 'Chem'), ('B', 'Chem'), ('C', 'Chem'), ('D', 'Chem'), ('A', 'Art');` },
    ],
    hints: ['Count students per class.', '"At least five" is `>= 5` — Math has exactly five.'],
    solution: {
      sql: `SELECT class
FROM Courses
GROUP BY class
HAVING COUNT(*) >= 5;`,
      explain: 'Because (student, class) is unique, `COUNT(*)` per class is the number of students.',
    },
    alternatives: [
      {
        title: 'Aggregate in a derived table',
        sql: `SELECT class
FROM (SELECT class, COUNT(student) AS n FROM Courses GROUP BY class) t
WHERE n >= 5;`,
        explain: 'Compute the count first, then filter it with an ordinary WHERE in the outer query. HAVING is just shorthand for this shape.',
      },
    ],
    traps: [
      { sql: `SELECT class FROM Courses GROUP BY class HAVING COUNT(*) > 5;`, why: 'Excludes classes with exactly five students.' },
    ],
  },
  {
    id: 2356,
    module: 'aggregation',
    sql50: true,
    patterns: ['COUNT(DISTINCT)'],
    task: `A teacher can teach the same subject in several departments. For each \`teacher_id\`, return \`cnt\`: the number of **different** subjects they teach. Any order.`,
    schema: `CREATE TABLE Teacher (teacher_id INT, subject_id INT, dept_id INT, PRIMARY KEY (subject_id, dept_id));`,
    data: `INSERT INTO Teacher VALUES (10, 4, 1), (10, 4, 2), (10, 6, 1), (11, 1, 3), (11, 2, 3), (11, 3, 3), (11, 5, 3), (12, 7, 2), (12, 7, 5);`,
    tests: [
      { name: "One subject in many departments", data: `INSERT INTO Teacher VALUES (20, 1, 1), (20, 1, 2), (20, 1, 3), (21, 2, 1), (21, 3, 2);` },
    ],
    hints: ['One output row per teacher.', 'Count distinct subjects, not rows.'],
    solution: {
      sql: `SELECT teacher_id, COUNT(DISTINCT subject_id) AS cnt
FROM Teacher
GROUP BY teacher_id;`,
      explain: 'Teacher 10 has three rows but only two subjects (subject 4 is taught in two departments).',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT teacher_id, COUNT(*) AS cnt FROM Teacher GROUP BY teacher_id;`, why: 'Counts (subject, department) rows, so a subject taught in two departments counts twice.' },
    ],
  },
  {
    id: 1729,
    module: 'aggregation',
    sql50: true,
    order: true,
    patterns: ['GROUP BY', 'ORDER BY'],
    task: `Each row of \`Followers\` says \`follower_id\` follows \`user_id\`. For each user, return \`user_id\` and \`followers_count\`, **ordered by \`user_id\`**.`,
    schema: `CREATE TABLE Followers (user_id INT, follower_id INT, PRIMARY KEY (user_id, follower_id));`,
    data: `INSERT INTO Followers VALUES (1, 4), (1, 7), (2, 1), (4, 1), (4, 2), (4, 7), (7, 3), (9, 4);`,
    tests: [
      { name: "Users inserted out of order", data: `INSERT INTO Followers VALUES (12, 3), (5, 12), (5, 3), (3, 5);` },
    ],
    hints: ['Who is being followed? That column is the group.', 'Count rows per group and sort.'],
    solution: {
      sql: `SELECT user_id, COUNT(follower_id) AS followers_count
FROM Followers
GROUP BY user_id
ORDER BY user_id;`,
      explain: 'Group by the followed user; each row in the group is one follower.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT follower_id AS user_id, COUNT(*) AS followers_count FROM Followers GROUP BY follower_id ORDER BY follower_id;`, why: 'Grouping by `follower_id` counts how many people each user *follows*, not their followers.' },
    ],
  },
  {
    id: 586,
    module: 'aggregation',
    patterns: ['ORDER BY aggregate + LIMIT'],
    task: `Find the \`customer_number\` of the customer who placed the most orders. Exactly one customer has more orders than everyone else.

*Follow-up:* how would you return all tied customers if several shared the maximum?`,
    schema: `CREATE TABLE Orders (order_number INT PRIMARY KEY, customer_number INT);`,
    data: `INSERT INTO Orders VALUES (1, 7), (2, 3), (3, 7), (4, 5), (5, 3), (6, 7), (7, 9), (8, 5);`,
    tests: [
      { name: "A single order", data: `INSERT INTO Orders VALUES (1, 42);` },
    ],
    hints: ['Count orders per customer.', 'Sort those counts from high to low and keep the first row.'],
    solution: {
      sql: `SELECT customer_number
FROM Orders
GROUP BY customer_number
ORDER BY COUNT(*) DESC
LIMIT 1;`,
      explain: 'ORDER BY can sort groups by an aggregate that is not even in the SELECT list. `LIMIT 1` is safe here only because the problem guarantees a single winner.',
    },
    alternatives: [
      {
        title: 'Handles ties: compare with the maximum count',
        sql: `SELECT customer_number
FROM Orders
GROUP BY customer_number
HAVING COUNT(*) = (
  SELECT MAX(cnt) FROM (SELECT COUNT(*) AS cnt FROM Orders GROUP BY customer_number) t
);`,
        explain: 'Aggregates cannot nest (`MAX(COUNT(*))`), so compute the counts in a derived table and take their MAX. Every customer matching it is returned — the answer to the follow-up.',
      },
    ],
    traps: [
      { sql: `SELECT customer_number FROM Orders GROUP BY customer_number ORDER BY COUNT(*) LIMIT 1;`, why: 'Ascending order returns the customer with the fewest orders.' },
    ],
  },
  {
    id: 511,
    module: 'aggregation',
    patterns: ['MIN per group'],
    task: `Each row of \`Activity\` is one day a player logged in. Return \`player_id\` and \`first_login\` — the player's earliest login date. Any order.`,
    schema: `CREATE TABLE Activity (player_id INT, device_id INT, event_date DATE, games_played INT, PRIMARY KEY (player_id, event_date));`,
    data: `INSERT INTO Activity VALUES
  (4, 1, '2023-11-05', 2), (4, 3, '2023-09-18', 7),
  (6, 2, '2024-02-29', 1), (6, 2, '2024-01-15', 0),
  (9, 5, '2023-12-31', 3), (9, 5, '2024-01-01', 4);`,
    tests: [
      { name: "Logins across years", data: `INSERT INTO Activity VALUES (1, 1, '2022-01-01', 0), (1, 2, '2021-12-31', 5), (2, 1, '2020-02-29', 1);` },
    ],
    hints: ['One row per player.', 'The earliest date is the MIN of the dates.'],
    solution: {
      sql: `SELECT player_id, MIN(event_date) AS first_login
FROM Activity
GROUP BY player_id;`,
      explain: 'MIN works on dates. Rows are not stored in date order, so "the first row per player" would be meaningless — use an aggregate.',
    },
    alternatives: [
      {
        title: 'Window function',
        sql: `SELECT DISTINCT player_id,
       FIRST_VALUE(event_date) OVER (PARTITION BY player_id ORDER BY event_date) AS first_login
FROM Activity;`,
        explain: 'Overkill here, but the same idea generalizes when you need other columns from the first row (Module 9).',
      },
    ],
    traps: [
      { sql: `SELECT player_id, MAX(event_date) AS first_login FROM Activity GROUP BY player_id;`, why: 'MAX gives the most recent login.' },
    ],
  },
  {
    id: 1693,
    module: 'aggregation',
    patterns: ['COUNT(DISTINCT)', 'multi-column GROUP BY'],
    task: `\`DailySales\` may contain duplicate rows. For each \`date_id\` and \`make_name\`, return \`unique_leads\` (distinct \`lead_id\`s) and \`unique_partners\` (distinct \`partner_id\`s). Any order.`,
    schema: `CREATE TABLE DailySales (date_id DATE, make_name VARCHAR(20), lead_id INT, partner_id INT);`,
    data: `INSERT INTO DailySales VALUES
  ('2024-05-01', 'kia', 1, 10), ('2024-05-01', 'kia', 1, 10), ('2024-05-01', 'kia', 2, 10),
  ('2024-05-01', 'ford', 1, 11),
  ('2024-05-02', 'kia', 3, 12), ('2024-05-02', 'kia', 3, 13),
  ('2024-05-02', 'ford', 4, 11), ('2024-05-02', 'ford', 5, 11), ('2024-05-02', 'ford', 4, 14);`,
    tests: [
      { name: "One make, heavy duplicates", data: `INSERT INTO DailySales VALUES ('2024-06-01', 'audi', 1, 1), ('2024-06-01', 'audi', 1, 1), ('2024-06-01', 'audi', 1, 1), ('2024-06-01', 'audi', 2, 1);` },
    ],
    hints: ['The grain is (date, make) — group by both.', 'Count distinct values of each id column.'],
    solution: {
      sql: `SELECT date_id, make_name,
       COUNT(DISTINCT lead_id)    AS unique_leads,
       COUNT(DISTINCT partner_id) AS unique_partners
FROM DailySales
GROUP BY date_id, make_name;`,
      explain: 'Two independent distinct counts over the same group.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT date_id, make_name, COUNT(lead_id) AS unique_leads, COUNT(partner_id) AS unique_partners FROM DailySales GROUP BY date_id, make_name;`, why: 'Counts rows, including duplicates and repeated ids.' },
    ],
  },
  {
    id: 1741,
    module: 'aggregation',
    patterns: ['SUM of an expression'],
    task: `An employee can enter and leave the office several times a day; each row is one visit with \`in_time\` and \`out_time\` in minutes. For each day and employee, return \`day\` (the \`event_day\`), \`emp_id\` and \`total_time\` — the sum of \`out_time - in_time\`. Any order.`,
    schema: `CREATE TABLE Employees (emp_id INT, event_day DATE, in_time INT, out_time INT, PRIMARY KEY (emp_id, event_day, in_time));`,
    data: `INSERT INTO Employees VALUES
  (7, '2024-03-11', 10, 70), (7, '2024-03-11', 100, 250), (7, '2024-03-14', 5, 45),
  (8, '2024-03-11', 30, 90), (8, '2024-03-20', 600, 660),
  (9, '2024-03-20', 1, 2), (9, '2024-03-20', 5, 25);`,
    tests: [
      { name: "Many short visits in a day", data: `INSERT INTO Employees VALUES (1, '2024-04-01', 0, 1), (1, '2024-04-01', 2, 3), (1, '2024-04-01', 4, 10), (2, '2024-04-02', 0, 1439);` },
    ],
    hints: ['The grain is (day, employee).', 'Aggregate the expression `out_time - in_time`.'],
    solution: {
      sql: `SELECT event_day AS day, emp_id,
       SUM(out_time - in_time) AS total_time
FROM Employees
GROUP BY event_day, emp_id;`,
      explain: 'Aggregates accept any per-row expression; the subtraction happens per visit, then SUM adds the visits of each (day, employee) group.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT MIN(event_day) AS day, emp_id, SUM(out_time - in_time) AS total_time FROM Employees GROUP BY emp_id;`, why: 'Grouping only by employee adds up time across different days.' },
    ],
  },
  {
    id: 1890,
    module: 'aggregation',
    patterns: ['MAX per group', 'date range filter'],
    task: `\`Logins\` records each login as a \`time_stamp\` (DATETIME). For every user who logged in during **2020**, return \`user_id\` and \`last_stamp\` — their latest login in 2020. Users with no 2020 login don't appear. Any order.`,
    schema: `CREATE TABLE Logins (user_id INT, time_stamp DATETIME, PRIMARY KEY (user_id, time_stamp));`,
    data: `INSERT INTO Logins VALUES
  (3, '2020-03-15 08:00:00'), (3, '2020-11-02 19:45:10'), (3, '2021-01-01 00:00:01'),
  (5, '2019-12-31 23:59:59'), (5, '2021-02-02 10:00:00'),
  (7, '2020-01-01 00:00:00'),
  (9, '2020-12-31 23:59:59'), (9, '2020-06-01 12:00:00'), (9, '2019-05-05 05:05:05');`,
    tests: [
      { name: "Logins right at the year boundaries", data: `INSERT INTO Logins VALUES (1, '2020-12-31 23:59:59'), (1, '2021-01-01 00:00:00'), (2, '2020-01-01 00:00:00'), (2, '2019-12-31 23:59:59'), (4, '2021-06-01 10:00:00');` },
    ],
    hints: ['Filter to 2020 first (WHERE), then aggregate.', 'Careful with the last day of the year: these are timestamps, not dates.'],
    solution: {
      sql: `SELECT user_id, MAX(time_stamp) AS last_stamp
FROM Logins
WHERE time_stamp >= '2020-01-01' AND time_stamp < '2021-01-01'
GROUP BY user_id;`,
      explain: 'A half-open range covers every instant of 2020, including 23:59:59 on Dec 31. Filtering happens before grouping, so users with no 2020 rows form no group at all.',
    },
    alternatives: [
      {
        title: 'YEAR()',
        sql: `SELECT user_id, MAX(time_stamp) AS last_stamp
FROM Logins
WHERE YEAR(time_stamp) = 2020
GROUP BY user_id;`,
        explain: 'Reads nicely, but wrapping the column in a function prevents MySQL from using an index on `time_stamp` (Module 13). The range form is the habit to build.',
      },
    ],
    traps: [
      { sql: `SELECT user_id, MAX(time_stamp) AS last_stamp FROM Logins WHERE time_stamp BETWEEN '2020-01-01' AND '2020-12-31' GROUP BY user_id;`, why: "The upper bound means Dec 31 at 00:00:00, so user 9's login at 23:59:59 that day is lost." },
      { sql: `SELECT user_id, MAX(time_stamp) AS last_stamp FROM Logins GROUP BY user_id HAVING YEAR(MAX(time_stamp)) = 2020;`, why: "Takes each user's overall latest login first — user 3's latest is in 2021, so user 3 disappears." },
    ],
  },
  {
    id: 1050,
    module: 'aggregation',
    patterns: ['GROUP BY pair', 'HAVING'],
    task: `Each row of \`ActorDirector\` is one collaboration. Return every (\`actor_id\`, \`director_id\`) pair that worked together **at least three times**. Any order.`,
    schema: 'CREATE TABLE ActorDirector (actor_id INT, director_id INT, `timestamp` INT PRIMARY KEY);',
    data: `INSERT INTO ActorDirector VALUES (4, 7, 0), (4, 7, 1), (4, 7, 2), (4, 8, 3), (4, 8, 4), (5, 7, 5), (5, 7, 6), (5, 7, 7), (5, 7, 8), (6, 9, 9), (6, 9, 10);`,
    tests: [
      { name: "Five films, split across directors", data: `INSERT INTO ActorDirector VALUES (1, 1, 0), (1, 1, 1), (1, 2, 2), (1, 2, 3), (1, 2, 4), (2, 1, 5), (2, 1, 6);` },
    ],
    hints: ['The group is the pair: group by both columns.', '"At least three" is `>= 3`.'],
    solution: {
      sql: `SELECT actor_id, director_id
FROM ActorDirector
GROUP BY actor_id, director_id
HAVING COUNT(*) >= 3;`,
      explain: 'Grouping by two columns makes one group per distinct pair.',
    },
    alternatives: [],
    traps: [
      { sql: `SELECT actor_id, director_id FROM ActorDirector GROUP BY actor_id, director_id HAVING COUNT(*) > 3;`, why: 'Drops pairs with exactly three collaborations.' },
    ],
  },
  {
    id: 1484,
    module: 'aggregation',
    lcIgnoreCase: true, // LeetCode's example input says 'T-Shirt' but its output says 'T-shirt'
    sql50: true,
    order: true,
    patterns: ['GROUP_CONCAT', 'COUNT(DISTINCT)'],
    task: `\`Activities\` lists products sold per date and may contain duplicates. For each \`sell_date\`, return \`num_sold\` (the number of **different** products) and \`products\`: their names, sorted alphabetically and joined with commas. Order by \`sell_date\`.`,
    schema: `CREATE TABLE Activities (sell_date DATE, product VARCHAR(30));`,
    data: `INSERT INTO Activities VALUES
  ('2024-06-01', 'Stapler'), ('2024-06-01', 'Eraser'), ('2024-06-01', 'Stapler'),
  ('2024-06-02', 'Ruler'), ('2024-06-03', 'Binder'), ('2024-06-03', 'Tape'),
  ('2024-06-03', 'Glue'), ('2024-06-03', 'Binder'), ('2024-06-02', 'Ruler');`,
    tests: [
      { name: "One product a day, dates out of order", data: `INSERT INTO Activities VALUES ('2024-07-03', 'Pen'), ('2024-07-01', 'Ink'), ('2024-07-01', 'Ink'), ('2024-07-02', 'Clip');` },
    ],
    hints: [
      'Group by date.',
      '`GROUP_CONCAT` builds the list; it accepts `DISTINCT`, `ORDER BY` and `SEPARATOR` inside the parentheses.',
    ],
    solution: {
      sql: `SELECT sell_date,
       COUNT(DISTINCT product) AS num_sold,
       GROUP_CONCAT(DISTINCT product ORDER BY product SEPARATOR ',') AS products
FROM Activities
GROUP BY sell_date
ORDER BY sell_date;`,
      explain: "DISTINCT removes the repeated `Stapler`; ORDER BY inside `GROUP_CONCAT` sorts the names within each group (the outer ORDER BY only sorts the rows). ',' is MySQL's default separator; writing it out documents the intent.",
    },
    alternatives: [],
    traps: [
      { sql: `SELECT sell_date, COUNT(DISTINCT product) AS num_sold, GROUP_CONCAT(product ORDER BY product) AS products FROM Activities GROUP BY sell_date ORDER BY sell_date;`, why: 'Without DISTINCT the list repeats products sold more than once that day.' },
      { sql: `SELECT sell_date, COUNT(DISTINCT product) AS num_sold, GROUP_CONCAT(DISTINCT product) AS products FROM Activities GROUP BY sell_date ORDER BY sell_date;`, why: 'Without ORDER BY inside GROUP_CONCAT the names come in whatever order the rows were read.' },
      { sql: `SELECT sell_date, COUNT(product) AS num_sold, GROUP_CONCAT(DISTINCT product ORDER BY product) AS products FROM Activities GROUP BY sell_date ORDER BY sell_date;`, why: '`COUNT(product)` counts duplicates too.' },
    ],
  },
  {
    id: 1141,
    module: 'aggregation',
    sql50: true,
    patterns: ['date window', 'COUNT(DISTINCT)'],
    task: `For the **30-day period ending 2019-07-27** (inclusive), return each \`day\` that had activity and \`active_users\`: the number of distinct users with at least one activity that day. Days without activity don't appear. Any order.`,
    schema: `CREATE TABLE Activity (user_id INT, session_id INT, activity_date DATE, activity_type ENUM('open_session', 'end_session', 'scroll_down', 'send_message'));`,
    data: `INSERT INTO Activity VALUES
  (1, 10, '2019-06-27', 'open_session'),
  (1, 11, '2019-06-28', 'open_session'), (2, 12, '2019-06-28', 'scroll_down'), (2, 12, '2019-06-28', 'end_session'),
  (3, 13, '2019-07-15', 'send_message'), (1, 14, '2019-07-15', 'open_session'),
  (4, 15, '2019-07-27', 'open_session'), (4, 15, '2019-07-27', 'end_session'),
  (5, 16, '2019-07-28', 'open_session');`,
    tests: [
      { name: "Activity on the edges of the window", data: `INSERT INTO Activity VALUES (1, 1, '2019-06-28', 'open_session'), (2, 2, '2019-06-28', 'end_session'), (3, 3, '2019-07-27', 'send_message'), (3, 4, '2019-06-27', 'open_session'), (3, 5, '2019-07-28', 'open_session');` },
    ],
    hints: [
      '30 days ending on the 27th, counting both ends, starts on 2019-06-28 — not the 27th.',
      'Make sure dates *after* the end are excluded too.',
      'A user with several events in a day counts once.',
    ],
    solution: {
      sql: `SELECT activity_date AS day, COUNT(DISTINCT user_id) AS active_users
FROM Activity
WHERE activity_date BETWEEN '2019-06-28' AND '2019-07-27'
GROUP BY activity_date;`,
      explain: 'Inclusive on both ends: June 28 … July 27 is exactly 30 days. `BETWEEN` is safe here because `activity_date` is a DATE, not a DATETIME.',
    },
    alternatives: [
      {
        title: 'Compute the window with DATE_SUB',
        sql: `SELECT activity_date AS day, COUNT(DISTINCT user_id) AS active_users
FROM Activity
WHERE activity_date > DATE_SUB('2019-07-27', INTERVAL 30 DAY)
  AND activity_date <= '2019-07-27'
GROUP BY activity_date;`,
        explain: 'Deriving the start date avoids off-by-one mistakes when the window length changes: 30 days back is June 27, and the window starts *after* it.',
      },
    ],
    traps: [
      { sql: `SELECT activity_date AS day, COUNT(DISTINCT user_id) AS active_users FROM Activity WHERE activity_date BETWEEN '2019-06-27' AND '2019-07-27' GROUP BY activity_date;`, why: 'That is 31 days: June 27 is one day too early.' },
      { sql: `SELECT activity_date AS day, COUNT(DISTINCT user_id) AS active_users FROM Activity WHERE DATEDIFF('2019-07-27', activity_date) < 30 GROUP BY activity_date;`, why: 'No upper bound: days after July 27 have a negative difference and slip in.' },
      { sql: `SELECT activity_date AS day, COUNT(user_id) AS active_users FROM Activity WHERE activity_date BETWEEN '2019-06-28' AND '2019-07-27' GROUP BY activity_date;`, why: 'Counts events, not distinct users.' },
    ],
  },
  {
    id: 1211,
    module: 'aggregation',
    sql50: true,
    patterns: ['AVG of a ratio', 'conditional percentage'],
    task: `For each \`query_name\`, return:

- \`quality\`: the average of \`rating / position\` over its rows;
- \`poor_query_percentage\`: the percentage of its rows with \`rating\` below 3.

Round both to **2 decimal places**. Any order.`,
    schema: `CREATE TABLE Queries (query_name VARCHAR(30), result VARCHAR(50), position INT, rating INT);`,
    data: `INSERT INTO Queries VALUES
  ('Fox', 'Red Fox', 1, 4), ('Fox', 'Arctic Fox', 4, 2), ('Fox', 'Fennec', 8, 5), ('Fox', 'Kit Fox', 10, 1),
  ('Owl', 'Barn Owl', 3, 3), ('Owl', 'Snowy Owl', 6, 4), ('Owl', 'Eagle Owl', 9, 5),
  ('Emu', 'Emu', 2, 1);`,
    tests: [
      { name: "One result per query", data: `INSERT INTO Queries VALUES ('Yak', 'Yak A', 3, 2), ('Ant', 'Ant B', 7, 5);` },
    ],
    hints: [
      'Compute `rating / position` per row, then average it per query.',
      'A percentage of rows meeting a condition is `100 * AVG(condition)` in MySQL.',
      'Round at the very end.',
    ],
    solution: {
      sql: `SELECT query_name,
       ROUND(AVG(rating / position), 2)   AS quality,
       ROUND(100 * AVG(rating < 3), 2)    AS poor_query_percentage
FROM Queries
GROUP BY query_name;`,
      explain: '`AVG(rating < 3)` is the fraction of rows where the condition is 1. Rounding once at the end avoids accumulating rounding error.',
    },
    alternatives: [
      {
        title: 'Portable CASE form',
        sql: `SELECT query_name,
       ROUND(AVG(rating * 1.0 / position), 2) AS quality,
       ROUND(100.0 * SUM(CASE WHEN rating < 3 THEN 1 ELSE 0 END) / COUNT(*), 2) AS poor_query_percentage
FROM Queries
GROUP BY query_name;`,
        explain: 'Works in PostgreSQL and SQL Server too, where `rating / position` on integers would truncate and booleans are not numbers.',
      },
    ],
    traps: [
      { sql: `SELECT query_name, ROUND(AVG(rating) / AVG(position), 2) AS quality, ROUND(100 * AVG(rating < 3), 2) AS poor_query_percentage FROM Queries GROUP BY query_name;`, why: 'The ratio of averages is not the average of ratios.' },
      { sql: `SELECT query_name, ROUND(AVG(rating / position), 2) AS quality, ROUND(AVG(rating < 3), 2) AS poor_query_percentage FROM Queries GROUP BY query_name;`, why: 'Returns a fraction (0.5), not a percentage (50.00).' },
    ],
  },
  {
    id: 1193,
    module: 'aggregation',
    sql50: true,
    patterns: ['conditional aggregation', 'GROUP BY month'],
    task: `For each month (\`YYYY-MM\`) and \`country\`, return: \`trans_count\` (all transactions), \`approved_count\`, \`trans_total_amount\` (sum of all amounts) and \`approved_total_amount\`. Column order: \`month\`, \`country\`, \`trans_count\`, \`approved_count\`, \`trans_total_amount\`, \`approved_total_amount\`. Any row order. A \`country\` can be NULL — treat NULL as its own group.`,
    schema: `CREATE TABLE Transactions (id INT PRIMARY KEY, country VARCHAR(4), state ENUM('approved', 'declined'), amount INT, trans_date DATE);`,
    data: `INSERT INTO Transactions VALUES
  (201, 'FR', 'approved', 1500, '2024-12-03'), (202, 'FR', 'declined', 400, '2024-12-09'),
  (208, 'JP', 'declined', 250, '2024-12-30'),
  (203, 'FR', 'approved', 900, '2025-01-02'), (207, 'FR', 'declined', 600, '2025-01-28'),
  (204, 'JP', 'approved', 1200, '2025-01-05'), (205, 'JP', 'declined', 300, '2025-01-19'),
  (206, NULL, 'approved', 450, '2025-01-22');`,
    tests: [
      { name: "A month with nothing approved", data: `INSERT INTO Transactions VALUES (301, 'DE', 'declined', 100, '2025-02-10'), (302, 'DE', 'declined', 50, '2025-02-11'), (303, NULL, 'declined', 70, '2025-02-12');` },
    ],
    hints: [
      'Month: `DATE_FORMAT(trans_date, \'%Y-%m\')`. Group by month and country.',
      'Counting approved rows: `SUM(state = \'approved\')` — not COUNT.',
      "Summing approved amounts: `SUM(IF(state = 'approved', amount, 0))`.",
    ],
    solution: {
      sql: `SELECT DATE_FORMAT(trans_date, '%Y-%m') AS month,
       country,
       COUNT(*)                                  AS trans_count,
       SUM(state = 'approved')                   AS approved_count,
       SUM(amount)                               AS trans_total_amount,
       SUM(IF(state = 'approved', amount, 0))    AS approved_total_amount
FROM Transactions
GROUP BY month, country;`,
      explain: 'Conditional aggregation: four measures from one pass over each (month, country) group. The NULL country forms its own group automatically.',
    },
    alternatives: [
      {
        title: 'CASE expressions',
        sql: `SELECT LEFT(trans_date, 7) AS month,
       country,
       COUNT(*) AS trans_count,
       COUNT(CASE WHEN state = 'approved' THEN 1 END) AS approved_count,
       SUM(amount) AS trans_total_amount,
       SUM(CASE WHEN state = 'approved' THEN amount ELSE 0 END) AS approved_total_amount
FROM Transactions
GROUP BY LEFT(trans_date, 7), country;`,
        explain: "`COUNT(CASE … THEN 1 END)` works because the missing ELSE is NULL, which COUNT skips. `LEFT(date, 7)` is another way to get 'YYYY-MM'.",
      },
    ],
    traps: [
      { sql: `SELECT DATE_FORMAT(trans_date, '%Y-%m') AS month, country, COUNT(*) AS trans_count, COUNT(state = 'approved') AS approved_count, SUM(amount) AS trans_total_amount, SUM(IF(state = 'approved', amount, 0)) AS approved_total_amount FROM Transactions GROUP BY month, country;`, why: '`COUNT(condition)` counts the 0s too, so approved_count equals trans_count.' },
      { sql: `SELECT DATE_FORMAT(trans_date, '%Y-%m') AS month, country, COUNT(*) AS trans_count, COUNT(*) AS approved_count, SUM(amount) AS trans_total_amount, SUM(amount) AS approved_total_amount FROM Transactions WHERE state = 'approved' GROUP BY month, country;`, why: 'Filtering in WHERE removes declined transactions from every measure, and drops groups with no approvals.' },
      { sql: `SELECT DATE_FORMAT(trans_date, '%Y-%m') AS month, country, COUNT(*) AS trans_count, SUM(state = 'approved') AS approved_count, SUM(amount) AS trans_total_amount, SUM(CASE WHEN state = 'approved' THEN amount END) AS approved_total_amount FROM Transactions GROUP BY month, country;`, why: 'A CASE without ELSE is NULL for declined rows, so a group with no approvals sums to NULL instead of 0.' },
    ],
  },
  {
    id: 1393,
    module: 'aggregation',
    patterns: ['signed SUM'],
    task: `\`Stocks\` records each 'Buy' and 'Sell' of a stock with its \`price\`; every buy is later matched by a sell. For each \`stock_name\`, return \`capital_gain_loss\`: the total of all sell prices minus all buy prices. Any order.`,
    schema: `CREATE TABLE Stocks (stock_name VARCHAR(15), operation ENUM('Sell', 'Buy'), operation_day INT, price INT, PRIMARY KEY (stock_name, operation_day));`,
    data: `INSERT INTO Stocks VALUES
  ('Acme', 'Buy', 1, 500), ('Acme', 'Sell', 3, 800), ('Acme', 'Buy', 5, 700), ('Acme', 'Sell', 8, 600),
  ('Bolt', 'Buy', 2, 1200), ('Bolt', 'Sell', 4, 900),
  ('Cirr', 'Buy', 1, 50), ('Cirr', 'Sell', 2, 50);`,
    tests: [
      { name: "Several round trips", data: `INSERT INTO Stocks VALUES ('Dyno', 'Buy', 1, 100), ('Dyno', 'Sell', 2, 90), ('Dyno', 'Buy', 3, 100), ('Dyno', 'Sell', 4, 90), ('Echo', 'Buy', 5, 10), ('Echo', 'Sell', 9, 1000);` },
    ],
    hints: ['Give each price a sign: + for Sell, − for Buy.', 'Then SUM per stock.'],
    solution: {
      sql: `SELECT stock_name,
       SUM(CASE WHEN operation = 'Sell' THEN price ELSE -price END) AS capital_gain_loss
FROM Stocks
GROUP BY stock_name;`,
      explain: 'Turning each row into a signed amount makes the whole history one SUM, however many buy/sell cycles there were.',
    },
    alternatives: [
      {
        title: 'Two conditional sums',
        sql: `SELECT stock_name,
       SUM(IF(operation = 'Sell', price, 0)) - SUM(IF(operation = 'Buy', price, 0)) AS capital_gain_loss
FROM Stocks
GROUP BY stock_name;`,
        explain: 'Same result, spelled as "total sells minus total buys".',
      },
    ],
    traps: [
      { sql: `SELECT stock_name, MAX(price) - MIN(price) AS capital_gain_loss FROM Stocks GROUP BY stock_name;`, why: 'Price range is not profit: it ignores which prices were buys and which were sells, and how many cycles happened.' },
    ],
  },
];
