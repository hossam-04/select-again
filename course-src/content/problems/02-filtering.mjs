// Module 2: filtering, NULL, LIKE
export default [
  {
    id: 584,
    module: 'filtering',
    sql50: true,
    patterns: ['NULL in comparisons', 'IS NULL'],
    task: `Each customer may have been referred by another customer (\`referee_id\`, NULL when nobody referred them). Return the \`name\` of every customer who was **not** referred by the customer with id 2 — including customers with no referrer at all. Any order.`,
    schema: `CREATE TABLE Customer (id INT PRIMARY KEY, name VARCHAR(25), referee_id INT);`,
    data: `INSERT INTO Customer VALUES
  (1, 'Amira', NULL), (2, 'Bruno', NULL), (3, 'Chen', 2), (4, 'Dana', 1),
  (5, 'Elif', NULL), (6, 'Femi', 2), (7, 'Gus', 3), (8, 'Hana', 2);`,
    tests: [
      { name: 'Everyone was referred by 2', data: `INSERT INTO Customer VALUES (1, 'Ana', NULL), (2, 'Ben', NULL), (3, 'Cy', 2), (4, 'Di', 2);` },
    ],
    hints: [
      'What does `referee_id <> 2` evaluate to when `referee_id` is NULL?',
      'WHERE keeps only rows whose condition is TRUE — UNKNOWN rows are dropped.',
      'Add the NULL case explicitly with `IS NULL`.',
    ],
    solution: {
      sql: `SELECT name
FROM Customer
WHERE referee_id <> 2
   OR referee_id IS NULL;`,
      explain: 'For customers without a referrer, `referee_id <> 2` is UNKNOWN, so the first condition alone drops them. `OR referee_id IS NULL` brings them back.',
    },
    alternatives: [
      {
        title: 'NULL-safe equality',
        sql: `SELECT name
FROM Customer
WHERE NOT (referee_id <=> 2);`,
        explain: '`<=>` never returns UNKNOWN: `NULL <=> 2` is 0 (false), so `NOT` makes it true. PostgreSQL spells this `referee_id IS DISTINCT FROM 2`.',
      },
      {
        title: 'Replace NULL first',
        sql: `SELECT name
FROM Customer
WHERE IFNULL(referee_id, 0) <> 2;`,
        explain: 'Map NULL to a value that can never be a real id, then compare. Works, but wrapping the column in a function prevents index use on large tables.',
      },
    ],
    traps: [
      { sql: `SELECT name FROM Customer WHERE referee_id <> 2;`, why: 'Silently drops every customer whose `referee_id` is NULL.' },
      { sql: `SELECT name FROM Customer WHERE referee_id <> 2 OR referee_id = NULL;`, why: '`= NULL` is never TRUE, so this is the same as the first wrong answer. Use `IS NULL`.' },
    ],
  },
  {
    id: 1527,
    module: 'filtering',
    sql50: true,
    patterns: ['LIKE patterns', 'word prefix'],
    task: `\`conditions\` holds zero or more condition codes separated by single spaces. Type I Diabetes codes always **start with** \`DIAB1\` (for example \`DIAB100\`). Return \`patient_id\`, \`patient_name\` and \`conditions\` for every patient with Type I Diabetes. Any order.

A code merely *containing* \`DIAB1\` (like \`XDIAB100\` or \`+DIAB101\`) does not count.`,
    schema: `CREATE TABLE Patients (patient_id INT PRIMARY KEY, patient_name VARCHAR(30), conditions VARCHAR(100));`,
    data: `INSERT INTO Patients VALUES
  (1, 'Ada', 'FLU ASTH'),
  (2, 'Bea', ''),
  (3, 'Cal', 'DIAB102 ARTH'),
  (4, 'Dov', 'MIGR DIAB100'),
  (5, 'Eli', 'DIAB215'),
  (6, 'Fay', 'XDIAB100'),
  (7, 'Gil', 'ASTH +DIAB101'),
  (8, 'Hal', 'DIAB1'),
  (9, 'Ivy', 'FLU DIAB150 ARTH');`,
    tests: [
      { name: "DIAB1 inside other codes", data: `INSERT INTO Patients VALUES (1, 'Kim', 'SADIAB100 FLU'), (2, 'Lou', 'ACNE DIAB10'), (3, 'Max', 'DIAB1 DIAB2'), (4, 'Ned', 'XX-DIAB1'), (5, 'Ola', 'COLD');` },
    ],
    hints: [
      'A code can sit at the very start of the string, or after a space.',
      'That is two LIKE patterns joined with OR.',
      "`'%DIAB1%'` is too loose — test it against `XDIAB100`.",
    ],
    solution: {
      sql: `SELECT patient_id, patient_name, conditions
FROM Patients
WHERE conditions LIKE 'DIAB1%'
   OR conditions LIKE '% DIAB1%';`,
      explain: 'The first pattern catches a code at the start of the list; the second catches one after a space. Anything else that merely contains the letters is rejected.',
    },
    alternatives: [
      {
        title: 'Regular expression',
        sql: `SELECT patient_id, patient_name, conditions
FROM Patients
WHERE conditions REGEXP '(^| )DIAB1';`,
        explain: '`(^| )` means "start of string or a space". Avoid `\\b` (word boundary) here: it also matches after `+`, which the problem excludes.',
      },
      {
        title: 'Pad with a leading space',
        sql: `SELECT patient_id, patient_name, conditions
FROM Patients
WHERE CONCAT(' ', conditions) LIKE '% DIAB1%';`,
        explain: 'Prefixing a space turns "at the start" into "after a space", so one pattern covers both cases.',
      },
    ],
    traps: [
      { sql: `SELECT patient_id, patient_name, conditions FROM Patients WHERE conditions LIKE '%DIAB1%';`, why: 'Matches `XDIAB100` and `+DIAB101`, whose codes do not start with DIAB1.' },
      { sql: `SELECT patient_id, patient_name, conditions FROM Patients WHERE conditions LIKE 'DIAB1%';`, why: 'Misses patients whose DIAB1 code is not the first one in the list.' },
    ],
  },
];
