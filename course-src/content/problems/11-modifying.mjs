// Module 11: UPDATE / DELETE
export default [
  {
    id: 627,
    module: 'modifying',
    kind: 'dml',
    after: 'SELECT * FROM Salary',
    patterns: ['UPDATE with CASE'],
    task: `Swap every \`'m'\` and \`'f'\` in the \`sex\` column using a **single UPDATE statement** (no SELECT, no temporary table). The checker runs your statement and then looks at the whole \`Salary\` table.`,
    schema: `CREATE TABLE Salary (id INT PRIMARY KEY, name VARCHAR(100), sex ENUM('m', 'f'), salary INT);`,
    data: `INSERT INTO Salary VALUES (1, 'Ola', 'm', 2500), (2, 'Pat', 'f', 1500), (3, 'Raj', 'm', 5500), (4, 'Sue', 'f', 500), (5, 'Tim', 'm', 3000);`,
    tests: [
      { name: "Everyone starts as m", data: `INSERT INTO Salary VALUES (1, 'Ana', 'm', 100), (2, 'Bo', 'm', 200);` },
    ],
    hints: [
      'One UPDATE can set different values on different rows — let the new value depend on the old one.',
      "`SET sex = CASE sex WHEN 'm' THEN 'f' ELSE 'm' END`",
      'Two separate UPDATEs do not work: the second undoes the first.',
    ],
    solution: {
      sql: `UPDATE Salary
SET sex = CASE sex WHEN 'm' THEN 'f' ELSE 'm' END;`,
      explain: 'SET expressions see each row\'s *old* values, so every row flips exactly once in a single pass.',
    },
    alternatives: [
      {
        title: 'IF()',
        sql: `UPDATE Salary
SET sex = IF(sex = 'm', 'f', 'm');`,
        explain: 'The two-branch shorthand.',
      },
      {
        title: 'XOR trick',
        sql: `UPDATE Salary
SET sex = CHAR(ASCII('m') ^ ASCII('f') ^ ASCII(sex));`,
        explain: "`x ^ a ^ b` turns a into b and b into a. Cute for interviews, unreadable in production.",
      },
    ],
    traps: [
      { sql: "UPDATE Salary SET sex = 'f' WHERE sex = 'm'; UPDATE Salary SET sex = 'm' WHERE sex = 'f';", why: 'The second statement also flips the rows the first one just changed — everybody ends up m.' },
    ],
  },
  {
    id: 196,
    module: 'modifying',
    kind: 'dml',
    sql50: true,
    after: 'SELECT * FROM Person',
    patterns: ['self-join DELETE', 'dedupe'],
    task: `Write a **DELETE** that removes duplicate emails from \`Person\`, keeping for each email only the row with the **smallest \`id\`**. The checker runs your statement and then looks at the whole table (row order does not matter).`,
    schema: `CREATE TABLE Person (id INT PRIMARY KEY, email VARCHAR(255));`,
    data: `INSERT INTO Person VALUES (7, 'dee@x.io'), (1, 'ana@x.io'), (2, 'bo@x.io'), (3, 'ana@x.io'), (4, 'cy@x.io'), (5, 'dee@x.io'), (6, 'bo@x.io'), (8, 'ana@x.io');`,
    tests: [
      { name: "One email three times", data: `INSERT INTO Person VALUES (5, 'x@y.z'), (2, 'x@y.z'), (9, 'x@y.z'), (4, 'solo@y.z');` },
    ],
    hints: [
      'A row must go if another row has the same email and a smaller id.',
      "MySQL's multi-table DELETE: `DELETE p1 FROM Person p1 JOIN Person p2 ON …` deletes the rows of p1 that find a partner.",
      'A subquery on `Person` inside `DELETE FROM Person` triggers MySQL error 1093 unless you wrap it in a derived table.',
    ],
    solution: {
      sql: `DELETE p1
FROM Person p1
JOIN Person p2
  ON p1.email = p2.email
 AND p1.id > p2.id;`,
      explain: 'Every row that has a same-email partner with a smaller id is deleted; the smallest id per email has no such partner and survives. (For dee@x.io, id 5 survives even though row 7 was inserted first.)',
    },
    alternatives: [
      {
        title: 'Comma join',
        sql: `DELETE p1
FROM Person p1, Person p2
WHERE p1.email = p2.email
  AND p1.id > p2.id;`,
        explain: 'The same multi-table DELETE with the old join syntax — the version most LeetCode answers use.',
      },
      {
        title: 'Keep list in a derived table',
        sql: `DELETE FROM Person
WHERE id NOT IN (
  SELECT id FROM (SELECT MIN(id) AS id FROM Person GROUP BY email) AS keep
);`,
        explain: 'Selecting the survivors through a derived table materializes it first, which sidesteps MySQL error 1093.',
      },
    ],
    traps: [
      { sql: 'DELETE FROM Person WHERE id NOT IN (SELECT MIN(id) FROM Person GROUP BY email);', why: "Logically right, but MySQL refuses to read `Person` in a subquery while deleting from it (error 1093)." },
      { sql: 'DELETE p1 FROM Person p1 JOIN Person p2 ON p1.email = p2.email AND p1.id < p2.id;', why: 'Keeps the largest id per email instead of the smallest.' },
    ],
  },
];
