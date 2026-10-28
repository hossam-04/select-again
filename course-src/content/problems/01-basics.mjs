// Module 1: SELECT, WHERE, ORDER BY, DISTINCT
export default [
  {
    id: 1757,
    module: 'basics',
    sql50: true,
    patterns: ['WHERE with AND'],
    task: `Return the \`product_id\` of every product that is **both** low fat (\`low_fats = 'Y'\`) and recyclable (\`recyclable = 'Y'\`). Any row order.`,
    schema: `CREATE TABLE Products (product_id INT PRIMARY KEY, low_fats ENUM('Y','N'), recyclable ENUM('Y','N'));`,
    data: `INSERT INTO Products VALUES (10,'N','Y'), (11,'Y','Y'), (12,'Y','N'), (13,'N','N'), (14,'Y','Y'), (15,'N','Y'), (16,'Y','Y');`,
    tests: [
      { name: 'Nothing qualifies', data: `INSERT INTO Products VALUES (1,'Y','N'), (2,'N','Y'), (3,'N','N');` },
    ],
    hints: [
      'Both conditions have to hold on the same row. Which logical operator is that?',
      "The ENUM columns hold the strings 'Y' and 'N' — compare them like any text column.",
    ],
    solution: {
      sql: `SELECT product_id
FROM Products
WHERE low_fats = 'Y'
  AND recyclable = 'Y';`,
      explain: `A pure row filter: \`WHERE\` keeps a row only when the whole condition is TRUE, and \`AND\` needs both sides TRUE. ENUM values compare as strings.`,
    },
    alternatives: [
      {
        title: 'Row constructor',
        sql: `SELECT product_id
FROM Products
WHERE (low_fats, recyclable) = ('Y', 'Y');`,
        explain: 'MySQL can compare tuples: `(a, b) = (x, y)` means `a = x AND b = y`. Handy when you match on several columns at once.',
      },
    ],
    traps: [
      { sql: `SELECT product_id FROM Products WHERE low_fats = 'Y' OR recyclable = 'Y';`, why: '`OR` keeps products that satisfy just one of the two conditions.' },
    ],
  },
  {
    id: 595,
    module: 'basics',
    sql50: true,
    patterns: ['WHERE with OR', 'boundary values'],
    task: `A country is **big** if its \`area\` is at least 3,000,000 km² **or** its \`population\` is at least 25,000,000. Return \`name\`, \`population\` and \`area\` of every big country, in any order.`,
    schema: `CREATE TABLE World (name VARCHAR(255) PRIMARY KEY, continent VARCHAR(255), area INT, population INT, gdp BIGINT);`,
    data: `INSERT INTO World VALUES
  ('Brazil',     'South America', 8515767, 203062512, 2126809000000),
  ('Nepal',      'Asia',           147516,  29164578,   40828000000),
  ('Mongolia',   'Asia',          1564116,   3398366,   19872000000),
  ('Iceland',    'Europe',         103000,    387758,   31020000000),
  ('Edgeland',   'Europe',        3000000,   1200000,    5000000000),
  ('Quorum',     'Oceania',         42000,  25000000,    1500000000),
  ('Nearlyland', 'Africa',        2999999,  24999999,     900000000);`,
    tests: [
      { name: "Missing figures", data: `INSERT INTO World VALUES ('Unmapped', 'Asia', NULL, 26000000, 1000), ('Tinyland', 'Europe', 50, NULL, 10), ('Atoll', 'Oceania', 12, 11000, 5);` },
    ],
    hints: [
      '"At least" includes the boundary value itself.',
      'Either condition is enough on its own.',
      'Try the data rows sitting exactly on 3,000,000 and 25,000,000 — are they in your result?',
    ],
    solution: {
      sql: `SELECT name, population, area
FROM World
WHERE area >= 3000000
   OR population >= 25000000;`,
      explain: '"At least" is `>=`, and "either condition" is `OR`. The rows *Edgeland* and *Quorum* sit exactly on the thresholds and must be included; *Nearlyland* is one unit short on both.',
    },
    alternatives: [
      {
        title: 'UNION of two filters',
        sql: `SELECT name, population, area FROM World WHERE area >= 3000000
UNION
SELECT name, population, area FROM World WHERE population >= 25000000;`,
        explain: '`UNION` removes the duplicate rows for countries that pass both tests. With an index on each column, MySQL can run each half as an index range scan — a classic reason people write it this way.',
      },
    ],
    traps: [
      { sql: `SELECT name, population, area FROM World WHERE area > 3000000 OR population > 25000000;`, why: '`>` drops the countries sitting exactly on the thresholds.' },
      {
        sql: `SELECT name, population, area FROM World WHERE area >= 3000000
UNION ALL
SELECT name, population, area FROM World WHERE population >= 25000000;`,
        why: '`UNION ALL` keeps duplicates, so a country that is big by both measures appears twice.',
      },
    ],
  },
  {
    id: 1148,
    module: 'basics',
    sql50: true,
    order: true,
    patterns: ['DISTINCT', 'ORDER BY'],
    task: `Each row of \`Views\` says a viewer looked at an article on a date; the table can contain **duplicate rows**, and \`author_id = viewer_id\` means the same person. Find every author who viewed at least one of their own articles. Return a single column named \`id\`, **sorted ascending**.`,
    schema: `CREATE TABLE Views (article_id INT, author_id INT, viewer_id INT, view_date DATE);`,
    data: `INSERT INTO Views VALUES
  (11, 5, 5, '2024-05-02'), (11, 5, 5, '2024-05-02'), (11, 5, 8, '2024-05-03'),
  (12, 2, 9, '2024-05-01'), (12, 2, 4, '2024-05-04'),
  (13, 5, 3, '2024-04-28'),
  (14, 8, 8, '2024-04-30'), (14, 8, 8, '2024-04-30'),
  (15, 6, 1, '2024-04-29'),
  (16, 1, 1, '2024-05-06'),
  (17, 3, 6, '2024-05-05');`,
    tests: [
      { name: "Nobody reads their own articles", data: `INSERT INTO Views VALUES (1, 3, 4, '2024-06-01'), (1, 3, 4, '2024-06-01'), (2, 4, 3, '2024-06-02');` },
    ],
    hints: [
      'An author viewed their own article when `author_id` and `viewer_id` are equal on the same row.',
      'The same author can match many rows — and the table has exact duplicates.',
      'Rename the column to `id` and sort.',
    ],
    solution: {
      sql: `SELECT DISTINCT author_id AS id
FROM Views
WHERE author_id = viewer_id
ORDER BY id;`,
      explain: '`WHERE` finds self-views, `DISTINCT` collapses repeats to one row per author, and `ORDER BY id` can use the alias because ORDER BY runs after SELECT.',
    },
    alternatives: [
      {
        title: 'GROUP BY instead of DISTINCT',
        sql: `SELECT author_id AS id
FROM Views
WHERE author_id = viewer_id
GROUP BY author_id
ORDER BY id;`,
        explain: 'Grouping by the only selected column produces the same set as `DISTINCT`.',
      },
    ],
    traps: [
      { sql: `SELECT author_id AS id FROM Views WHERE author_id = viewer_id ORDER BY id;`, why: 'Without DISTINCT each self-view is a separate row, so authors repeat.' },
      { sql: `SELECT DISTINCT author_id AS id FROM Views WHERE author_id = viewer_id;`, why: 'The problem asks for ascending order; without ORDER BY the row order is whatever the engine produces.' },
    ],
  },
  {
    id: 620,
    module: 'basics',
    sql50: true,
    order: true,
    patterns: ['modulo', 'ORDER BY DESC'],
    task: `Report the movies whose \`id\` is **odd** and whose \`description\` is not \`'boring'\`. Return all columns, **ordered by \`rating\` descending**.`,
    schema: `CREATE TABLE Cinema (id INT PRIMARY KEY, movie VARCHAR(255), description VARCHAR(255), rating FLOAT);`,
    data: `INSERT INTO Cinema VALUES
  (1, 'Tidal Lines',   'drama',    7.8),
  (2, 'Glass Orchard', 'boring',   5.2),
  (3, 'Night Ledger',  'thriller', 8.6),
  (4, 'Paper Moons',   'comedy',   6.9),
  (5, 'Static Bloom',  'boring',   4.1),
  (6, 'Low Tide',      'romance',  7.1),
  (7, 'Iron Choir',    'musical',  9.1),
  (9, 'Salt Road',     'boring',   6.0),
  (11, 'Quiet Engine', 'sci-fi',   8.2);`,
    tests: [
      { name: "Odd ids, mostly boring", data: `INSERT INTO Cinema VALUES (1, 'Dust', 'boring', 5.0), (2, 'Echo', 'fun', 9.0), (3, 'Flint', 'great', 6.5), (8, 'Grove', 'epic', 8.0), (13, 'Haze', 'boring', 7.0), (15, 'Isle', 'calm', 9.5);` },
    ],
    hints: [
      'An id is odd when dividing by 2 leaves a remainder of 1: `id % 2 = 1` or `MOD(id, 2) = 1`.',
      "Exclude the description with `<> 'boring'` (or `!=`).",
      'Highest rating first.',
    ],
    solution: {
      sql: `SELECT *
FROM Cinema
WHERE id % 2 = 1
  AND description <> 'boring'
ORDER BY rating DESC;`,
      explain: '`%` (or `MOD()`) gives the remainder; odd ids leave 1. `DESC` flips the sort so the best-rated film comes first.',
    },
    alternatives: [
      {
        title: 'MOD() and !=',
        sql: `SELECT id, movie, description, rating
FROM Cinema
WHERE MOD(id, 2) = 1 AND description != 'boring'
ORDER BY rating DESC;`,
        explain: 'Same logic with the function form of modulo and the other spelling of "not equal". Listing columns beats `SELECT *` in real code.',
      },
    ],
    traps: [
      { sql: `SELECT * FROM Cinema WHERE id % 2 = 1 AND description <> 'boring' ORDER BY rating;`, why: 'Ascending order puts the worst movie first; the task wants descending.' },
      { sql: `SELECT * FROM Cinema WHERE id % 2 = 0 AND description <> 'boring' ORDER BY rating DESC;`, why: 'A remainder of 0 means even ids.' },
    ],
  },
];
