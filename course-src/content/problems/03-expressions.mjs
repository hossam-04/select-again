// Module 3: CASE, strings, numbers, regex
export default [
  {
    id: 610,
    module: 'expressions',
    sql50: true,
    patterns: ['CASE', 'row-wise logic'],
    task: `Each row holds three segment lengths \`x\`, \`y\`, \`z\`. For every row, return \`x\`, \`y\`, \`z\` and a column \`triangle\` that is \`'Yes'\` if the three segments can form a triangle and \`'No'\` otherwise. Any order.

Three lengths form a triangle when **each** pair adds up to strictly more than the third.`,
    schema: `CREATE TABLE Triangle (x INT, y INT, z INT, PRIMARY KEY (x, y, z));`,
    data: `INSERT INTO Triangle VALUES (7, 8, 20), (20, 7, 8), (9, 12, 15), (6, 8, 10), (2, 3, 5), (4, 4, 4), (3, 3, 7), (2, 9, 9);`,
    tests: [
      { name: "Flat and thin triangles", data: `INSERT INTO Triangle VALUES (5, 2, 3), (10, 10, 1), (1, 1, 1), (0, 5, 5);` },
    ],
    hints: [
      'Check all three inequalities: x + y > z, x + z > y and y + z > x.',
      'Strictly greater: 2, 3, 5 lie flat on a line and are not a triangle.',
      'Return the label with `CASE WHEN … THEN \'Yes\' ELSE \'No\' END`.',
    ],
    solution: {
      sql: `SELECT x, y, z,
       CASE WHEN x + y > z AND x + z > y AND y + z > x
            THEN 'Yes' ELSE 'No' END AS triangle
FROM Triangle;`,
      explain: 'The triangle inequality must hold for every side. `CASE` turns the combined condition into the requested label.',
    },
    alternatives: [
      {
        title: 'IF() and the longest side',
        sql: `SELECT x, y, z,
       IF(x + y + z > 2 * GREATEST(x, y, z), 'Yes', 'No') AS triangle
FROM Triangle;`,
        explain: 'Only the longest side can break the rule, so it is enough to check that the sum of all three exceeds twice the longest. `GREATEST` is MySQL/PostgreSQL; SQL Server 2022 added it too.',
      },
    ],
    traps: [
      { sql: `SELECT x, y, z, CASE WHEN x + y > z THEN 'Yes' ELSE 'No' END AS triangle FROM Triangle;`, why: 'Only checks one inequality — (20, 7, 8) passes it but is not a triangle.' },
      { sql: `SELECT x, y, z, CASE WHEN x + y >= z AND x + z >= y AND y + z >= x THEN 'Yes' ELSE 'No' END AS triangle FROM Triangle;`, why: '`>=` accepts degenerate "triangles" such as (2, 3, 5), which are flat lines.' },
    ],
  },
  {
    id: 1873,
    module: 'expressions',
    order: true,
    patterns: ['CASE / IF', 'LIKE prefix'],
    task: `An employee's \`bonus\` equals their \`salary\` if their \`employee_id\` is **odd** and their \`name\` does **not** start with \`'M'\`; otherwise the bonus is 0. Return \`employee_id\` and \`bonus\` for **every** employee, ordered by \`employee_id\`.`,
    schema: `CREATE TABLE Employees (employee_id INT PRIMARY KEY, name VARCHAR(30), salary INT);`,
    data: `INSERT INTO Employees VALUES
  (1, 'Maya', 9000), (2, 'Noor', 5000), (3, 'Oscar', 7000), (4, 'Mike', 6000),
  (5, 'Pedro', 4000), (6, 'Quincy', 3000), (7, 'Mona', 2500), (9, 'Ibrahim', 8000);`,
    tests: [
      { name: "An M in the middle of the name", data: `INSERT INTO Employees VALUES (11, 'Emma', 3000), (12, 'Sam', 2000), (13, 'Adam', 4000), (15, 'Mo', 1000);` },
    ],
    hints: [
      'Everyone appears in the output, so the rule belongs in SELECT, not in WHERE.',
      "Odd: `employee_id % 2 = 1`. Doesn't start with M: `name NOT LIKE 'M%'`.",
    ],
    solution: {
      sql: `SELECT employee_id,
       CASE WHEN employee_id % 2 = 1 AND name NOT LIKE 'M%'
            THEN salary ELSE 0 END AS bonus
FROM Employees
ORDER BY employee_id;`,
      explain: 'A per-row computed column: `CASE` returns the salary when both conditions hold, else 0.',
    },
    alternatives: [
      {
        title: 'IF()',
        sql: `SELECT employee_id,
       IF(employee_id % 2 = 1 AND LEFT(name, 1) <> 'M', salary, 0) AS bonus
FROM Employees
ORDER BY employee_id;`,
        explain: "MySQL's two-branch shorthand, with `LEFT(name, 1)` instead of LIKE.",
      },
      {
        title: 'Multiply by a boolean',
        sql: `SELECT employee_id,
       salary * (employee_id % 2 = 1 AND name NOT LIKE 'M%') AS bonus
FROM Employees
ORDER BY employee_id;`,
        explain: 'In MySQL a condition is 1 or 0, so multiplying by it zeroes the salary when the rule fails. Clever, but CASE says what you mean.',
      },
    ],
    traps: [
      { sql: `SELECT employee_id, salary AS bonus FROM Employees WHERE employee_id % 2 = 1 AND name NOT LIKE 'M%' ORDER BY employee_id;`, why: 'Filtering drops the employees whose bonus should be 0 — every employee must appear.' },
      { sql: `SELECT employee_id, CASE WHEN employee_id % 2 = 1 OR name NOT LIKE 'M%' THEN salary ELSE 0 END AS bonus FROM Employees ORDER BY employee_id;`, why: '`OR` pays a bonus when only one condition holds.' },
    ],
  },
  {
    id: 1667,
    module: 'expressions',
    sql50: true,
    order: true,
    patterns: ['string functions', 'CONCAT'],
    task: `Fix every user's \`name\` so that only the first character is uppercase and the rest are lowercase. Return \`user_id\` and the fixed \`name\`, ordered by \`user_id\`.`,
    schema: `CREATE TABLE Users (user_id INT PRIMARY KEY, name VARCHAR(40));`,
    data: `INSERT INTO Users VALUES (1, 'nOAH'), (2, 'lIV'), (3, 'SAMIRA'), (4, 'jOsE'), (5, 'q'), (6, 'MaRiA');`,
    tests: [
      { name: "Hyphens, apostrophes and one-letter names", data: `INSERT INTO Users VALUES (7, 'ANNA-MARIE'), (8, 'o''BRIEN'), (9, 'x'), (10, 'Already');` },
    ],
    hints: [
      'Split the name into its first character and the rest.',
      '`UPPER(LEFT(name, 1))` and `LOWER(SUBSTRING(name, 2))`, then glue them back together.',
      "In MySQL, `||` is not string concatenation — use CONCAT.",
    ],
    solution: {
      sql: `SELECT user_id,
       CONCAT(UPPER(LEFT(name, 1)), LOWER(SUBSTRING(name, 2))) AS name
FROM Users
ORDER BY user_id;`,
      explain: '`SUBSTRING(name, 2)` is everything from the second character on (an empty string for one-letter names), so single-character names work too.',
    },
    alternatives: [
      {
        title: 'INSERT() into the lower-cased name',
        sql: `SELECT user_id,
       INSERT(LOWER(name), 1, 1, UPPER(LEFT(name, 1))) AS name
FROM Users
ORDER BY user_id;`,
        explain: "MySQL's `INSERT(str, pos, len, new)` replaces `len` characters at `pos` — here, the first character of the lower-cased name.",
      },
    ],
    traps: [
      { sql: `SELECT user_id, CONCAT(UPPER(LEFT(name, 1)), SUBSTRING(name, 2)) AS name FROM Users ORDER BY user_id;`, why: 'The rest of the name keeps its original casing.' },
      { sql: `SELECT user_id, UPPER(LEFT(name, 1)) || LOWER(SUBSTRING(name, 2)) AS name FROM Users ORDER BY user_id;`, why: 'In MySQL `||` is logical OR, so every name becomes 0 or 1.' },
    ],
  },
  {
    id: 1683,
    module: 'expressions',
    sql50: true,
    patterns: ['CHAR_LENGTH'],
    task: `A tweet is **invalid** if its \`content\` has strictly more than 15 characters (spaces count). Return the \`tweet_id\` of every invalid tweet, in any order.`,
    schema: `CREATE TABLE Tweets (tweet_id INT PRIMARY KEY, content VARCHAR(50));`,
    data: `INSERT INTO Tweets VALUES
  (1, 'Coffee first'), (2, 'Weekend plans are on hold again'), (3, 'fifteen chars!!'),
  (4, 'sixteen letters!'), (5, 'Yo'), (6, 'two  spaces ok!');`,
    tests: [
      { name: "Accented letters count once", data: `INSERT INTO Tweets VALUES (7, 'café au lait :)'), (8, 'naïve résumé ok!'), (9, '');` },
    ],
    hints: [
      'Count characters with `CHAR_LENGTH`.',
      '"Strictly more than 15" means `> 15`: a tweet of exactly 15 characters is fine.',
    ],
    solution: {
      sql: `SELECT tweet_id
FROM Tweets
WHERE CHAR_LENGTH(content) > 15;`,
      explain: '`CHAR_LENGTH` counts characters. `LENGTH` counts bytes, which only agrees on plain ASCII text.',
    },
    alternatives: [
      {
        title: 'LIKE with sixteen underscores',
        sql: `SELECT tweet_id
FROM Tweets
WHERE content LIKE '________________%';`,
        explain: 'Each `_` matches exactly one character, so sixteen of them followed by `%` means "at least 16 characters". It works, but `CHAR_LENGTH` says what you mean.',
      },
    ],
    traps: [
      { sql: `SELECT tweet_id FROM Tweets WHERE CHAR_LENGTH(content) >= 15;`, why: 'A tweet with exactly 15 characters is valid.' },
      { sql: `SELECT tweet_id FROM Tweets WHERE LENGTH(content) > 15;`, why: '`LENGTH` counts bytes, not characters. `é` takes two bytes in UTF-8, so a 15-character tweet with accents looks too long. It only agrees with CHAR_LENGTH on plain ASCII.' },
    ],
  },
  {
    id: 1517,
    module: 'expressions',
    sql50: true,
    patterns: ['REGEXP', 'case-sensitive match'],
    task: `Return \`user_id\`, \`name\` and \`mail\` of users whose email is valid. A valid email is a *prefix* followed by the domain \`@leetcode.com\`:

- the prefix **starts with a letter** and contains only letters (either case), digits, underscore \`_\`, period \`.\` and dash \`-\`;
- the domain is **exactly** \`@leetcode.com\`, in lowercase.

Any order.`,
    schema: `CREATE TABLE Users (user_id INT PRIMARY KEY, name VARCHAR(30), mail VARCHAR(60));`,
    data: `INSERT INTO Users VALUES
  (1, 'Nora', 'nora.k@leetcode.com'),
  (2, 'Omar', 'omar_99@leetcode.com'),
  (3, 'Pia', 'pia@leetcode.co'),
  (4, 'Quinn', '9quinn@leetcode.com'),
  (5, 'Rosa', 'rosa-m@leetcode.com'),
  (6, 'Sami', 'sami@LeetCode.com'),
  (7, 'Tara', 'tara#1@leetcode.com'),
  (8, 'Uma', 'Uma.Dev@leetcode.com'),
  (9, 'Vik', 'vik@leetcodeXcom'),
  (10, 'Wes', '_wes@leetcode.com'),
  (11, 'Xia', 'xia@leetcode.com.evil');`,
    tests: [
      { name: "More prefix rules", data: `INSERT INTO Users VALUES (20, 'Ana', 'a@leetcode.com'), (21, 'Ben', '.dot@leetcode.com'), (22, 'Cyd', 'ok@@leetcode.com'), (23, 'Dan', 'Z-9_.x@leetcode.com'), (24, 'Eve', 'q@leetcode.comm');` },
    ],
    hints: [
      'This is a job for a regular expression anchored at both ends: `^…$`.',
      'First character: `[A-Za-z]`. Then any number of `[A-Za-z0-9_.-]`.',
      'A bare `.` in a regex matches any character — escape it (`[.]` or `\\\\.`) in the domain.',
      "MySQL's REGEXP ignores case by default, but the domain must be lowercase. Use `REGEXP_LIKE(mail, pattern, 'c')`.",
    ],
    solution: {
      sql: `SELECT user_id, name, mail
FROM Users
WHERE REGEXP_LIKE(mail, '^[A-Za-z][A-Za-z0-9_.-]*@leetcode[.]com$', 'c');`,
      explain: `- \`^[A-Za-z]\`: must start with a letter.
- \`[A-Za-z0-9_.-]*\`: then any allowed characters (inside brackets \`.\` is literal and a trailing \`-\` is literal).
- \`@leetcode[.]com$\`: the exact domain, anchored at the end.
- \`'c'\`: case-sensitive, so \`@LeetCode.com\` is rejected.`,
    },
    alternatives: [
      {
        title: 'Escaped dot',
        sql: `SELECT user_id, name, mail
FROM Users
WHERE REGEXP_LIKE(mail, '^[a-zA-Z][a-zA-Z0-9_.\\\\-]*@leetcode\\\\.com$', 'c');`,
        explain: "Same pattern with backslash escapes. In a MySQL string literal `'\\\\.'` becomes `\\.` for the regex engine — the double backslash is easy to get wrong, which is why `[.]` is popular.",
      },
    ],
    traps: [
      { sql: `SELECT user_id, name, mail FROM Users WHERE mail REGEXP '^[A-Za-z][A-Za-z0-9_.-]*@leetcode[.]com$';`, why: "Plain REGEXP is case-insensitive in MySQL, so `sami@LeetCode.com` slips through." },
      { sql: `SELECT user_id, name, mail FROM Users WHERE REGEXP_LIKE(mail, '^[A-Za-z][A-Za-z0-9_.-]*@leetcode.com$', 'c');`, why: 'An unescaped `.` matches any character, so `vik@leetcodeXcom` passes.' },
      { sql: `SELECT user_id, name, mail FROM Users WHERE REGEXP_LIKE(mail, '^[A-Za-z][A-Za-z0-9_.-]*@leetcode[.]com', 'c');`, why: 'Without the `$` anchor, anything may follow the domain — `xia@leetcode.com.evil` passes.' },
      { sql: `SELECT user_id, name, mail FROM Users WHERE mail LIKE '%@leetcode.com';`, why: 'LIKE cannot express the prefix rules: it accepts `9quinn`, `tara#1` and `_wes`.' },
    ],
  },
];
