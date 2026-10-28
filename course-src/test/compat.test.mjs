// Behavioural tests: MySQL-syntax queries run through rewrite + UDFs on sql.js
// must return what MySQL 8 returns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { engine } from '../lib/engine-node.mjs';

const one = (sql, setup) => {
  const db = engine.open(setup || '');
  const r = engine.run(db, sql);
  db.close();
  if (r.error) throw new Error(r.error.message + '\n--- rewritten:\n' + r.rewritten);
  return r;
};
const val = (sql, setup) => one(sql, setup).last.rows[0][0];
const rows = (sql, setup) => one(sql, setup).last.rows;
const cols = (sql, setup) => one(sql, setup).last.columns;

test('tokenizer round-trips text exactly', () => {
  const src = "SELECT `a`, \"b\", 'c''d', 1.5e3, @v, x<=>y -- hi\n/* c */ # m\nFROM t;";
  const toks = globalThis.SQLTok.tokenize(src);
  assert.equal(toks.map((t) => t.text).join(''), src);
});

test('decimal division like MySQL', () => {
  assert.equal(val('SELECT 5/2'), 2.5);
  assert.equal(val('SELECT 1/4 * 100'), 25);
  assert.equal(val('SELECT ROUND(2/3, 2)'), 0.67);
  assert.equal(val('SELECT 7 DIV 2'), 3);
  assert.equal(val('SELECT 7 MOD 3'), 1);
  assert.equal(val('SELECT MOD(7, 3)'), 1);
  assert.equal(val('SELECT 5/0'), null);
  assert.deepEqual(cols('SELECT 5/2, 5/2 AS half'), ['5/2', 'half']);
});

test('ROUND is decimal-correct, half away from zero', () => {
  assert.equal(val('SELECT ROUND(1.005, 2)'), 1.01);
  assert.equal(val('SELECT ROUND(2.675, 2)'), 2.68);
  assert.equal(val('SELECT ROUND(-2.5)'), -3);
  assert.equal(val('SELECT ROUND(2.5)'), 3);
  assert.equal(val('SELECT ROUND(1234.5678, -2)'), 1200);
  assert.equal(val('SELECT TRUNCATE(1.999, 1)'), 1.9);
});

test('strings: quotes, escapes, CONCAT NULL semantics', () => {
  assert.equal(val('SELECT "double quoted"'), 'double quoted');
  assert.equal(val("SELECT 'it\\'s'"), "it's");
  assert.equal(val("SELECT 'a\\\\b'"), 'a\\b');
  assert.equal(val("SELECT CONCAT('a', NULL, 'b')"), null);
  assert.equal(val("SELECT CONCAT('a', 1, 'b')"), 'a1b');
  assert.equal(val("SELECT CONCAT_WS('-', 'a', NULL, 'b')"), 'a-b');
  assert.equal(val("SELECT LEFT('abcdef', 2)"), 'ab');
  assert.equal(val("SELECT RIGHT('abcdef', 2)"), 'ef');
  assert.equal(val("SELECT SUBSTRING('abcdef', 2, 3)"), 'bcd');
  assert.equal(val("SELECT SUBSTRING('abcdef', -2)"), 'ef');
  assert.equal(val("SELECT SUBSTRING('abcdef', 0)"), '');
  assert.equal(val("SELECT SUBSTRING('abcdef' FROM 2 FOR 2)"), 'bc');
  assert.equal(val("SELECT SUBSTRING_INDEX('a.b.c', '.', 2)"), 'a.b');
  assert.equal(val("SELECT SUBSTRING_INDEX('a.b.c', '.', -1)"), 'c');
  assert.equal(val("SELECT LPAD('7', 3, '0')"), '007');
  assert.equal(val("SELECT CHAR_LENGTH('héllo'), LENGTH('héllo')"), 5);
  assert.deepEqual(rows("SELECT CHAR_LENGTH('héllo'), LENGTH('héllo')")[0], [5, 6]);
  assert.equal(val("SELECT UPPER('straße')"), 'STRAßE'); // MySQL maps case 1:1 per character
  assert.equal(val("SELECT LOCATE('b', 'abcb')"), 2);
  assert.equal(val("SELECT LOCATE('b', 'abcb', 3)"), 4);
  assert.equal(val("SELECT POSITION('c' IN 'abc')"), 3);
  assert.equal(val("SELECT TRIM(LEADING 'x' FROM 'xxaxx')"), 'axx');
  assert.equal(val("SELECT TRIM(BOTH 'x' FROM 'xxaxx')"), 'a');
  assert.equal(val("SELECT REPLACE('aaa', 'a', 'b')"), 'bbb');
  assert.equal(val("SELECT REVERSE('abc')"), 'cba');
  assert.equal(val("SELECT FORMAT(1234567.891, 2)"), '1,234,567.89');
  assert.equal(val("SELECT FIND_IN_SET('b', 'a,b,c')"), 2);
});

test('case-insensitive comparisons on text columns (MySQL default collation)', () => {
  const setup = "CREATE TABLE p (id INT PRIMARY KEY, name VARCHAR(20)); INSERT INTO p VALUES (1, 'Alice'), (2, 'alice'), (3, 'Bob');";
  assert.equal(val("SELECT COUNT(*) FROM p WHERE name = 'ALICE'", setup), 2);
  assert.equal(val('SELECT COUNT(DISTINCT name) FROM p', setup), 2);
  assert.equal(val("SELECT COUNT(*) FROM p WHERE BINARY name = 'alice'", setup), 1);
  assert.equal(val("SELECT COUNT(*) FROM p WHERE name LIKE 'a%'", setup), 2);
});

test('LIKE with backslash escapes', () => {
  const setup = "CREATE TABLE s (v VARCHAR(20)); INSERT INTO s VALUES ('a_b'), ('axb');";
  assert.equal(val("SELECT COUNT(*) FROM s WHERE v LIKE 'a\\_b'", setup), 1);
  assert.equal(val("SELECT COUNT(*) FROM s WHERE v LIKE 'a_b'", setup), 2);
});

test('REGEXP family (case-insensitive by default, like MySQL)', () => {
  assert.equal(val("SELECT 'Hello' REGEXP '^h'"), 1);
  assert.equal(val("SELECT 'Hello' REGEXP BINARY '^h'"), 0);
  assert.equal(val("SELECT 'Hello' RLIKE 'L+O$'"), 1);
  assert.equal(val("SELECT 'Hello' NOT REGEXP '^x'"), 1);
  assert.equal(val("SELECT REGEXP_LIKE('Hello', '^h', 'c')"), 0);
  assert.equal(val("SELECT REGEXP_LIKE('Hello', '^h')"), 1);
  assert.equal(val("SELECT 'a1' REGEXP '^[[:alpha:]][[:digit:]]$'"), 1);
  assert.equal(val("SELECT 'x.com' REGEXP '\\\\.com$'"), 1);
  assert.equal(val("SELECT REGEXP_REPLACE('a1b22', '[0-9]+', '#')"), 'a#b#');
  assert.equal(val("SELECT REGEXP_SUBSTR('abc123def', '[0-9]+')"), '123');
});

test('dates: DATEDIFF, DATE_ADD/SUB, INTERVAL arithmetic', () => {
  assert.equal(val("SELECT DATEDIFF('2024-03-01', '2024-02-01')"), 29);
  assert.equal(val("SELECT DATEDIFF('2024-03-01 23:00:00', '2024-03-01 01:00:00')"), 0);
  assert.equal(val("SELECT DATE_ADD('2024-01-31', INTERVAL 1 MONTH)"), '2024-02-29');
  assert.equal(val("SELECT DATE_SUB('2024-03-01', INTERVAL 1 DAY)"), '2024-02-29');
  assert.equal(val("SELECT '2019-07-27' - INTERVAL 29 DAY"), '2019-06-28');
  assert.equal(val("SELECT DATE('2024-01-01') + INTERVAL 1 DAY"), '2024-01-02');
  assert.equal(val("SELECT DATE_ADD('2024-01-01 10:00:00', INTERVAL 90 MINUTE)"), '2024-01-01 11:30:00');
  assert.equal(val("SELECT ADDDATE('2024-01-01', 10)"), '2024-01-11');
  assert.equal(val("SELECT DATE_ADD('2024-01-01', INTERVAL -1 YEAR)"), '2023-01-01');
  const setup = "CREATE TABLE w (id INT, d DATE, n INT); INSERT INTO w VALUES (1, '2024-01-01', 3), (2, '2024-01-02', 4);";
  assert.deepEqual(rows('SELECT b.id FROM w a JOIN w b ON b.d = a.d + INTERVAL 1 DAY', setup), [[2]]);
  assert.deepEqual(rows('SELECT DATE_ADD(d, INTERVAL n DAY) FROM w ORDER BY id', setup), [['2024-01-04'], ['2024-01-06']]);
  assert.deepEqual(rows('SELECT id FROM w WHERE d BETWEEN DATE_SUB(\'2024-01-02\', INTERVAL 0 DAY) AND \'2024-01-02\'', setup), [[2]]);
});

test('dates: parts, formatting, TIMESTAMPDIFF, EXTRACT', () => {
  assert.deepEqual(rows("SELECT YEAR('2024-05-06'), MONTH('2024-05-06'), DAY('2024-05-06'), DAYOFMONTH('2024-05-06')")[0], [2024, 5, 6, 6]);
  assert.equal(val("SELECT DATE_FORMAT('2024-05-06', '%Y-%m')"), '2024-05');
  assert.equal(val("SELECT DATE_FORMAT('2024-05-06 14:03:09', '%W %M %D %Y %H:%i:%s %p')"), 'Monday May 6th 2024 14:03:09 PM');
  assert.equal(val("SELECT DAYNAME('2024-05-06')"), 'Monday');
  assert.equal(val("SELECT DAYOFWEEK('2024-05-05')"), 1);
  assert.equal(val("SELECT WEEKDAY('2024-05-05')"), 6);
  assert.equal(val("SELECT QUARTER('2024-05-06')"), 2);
  assert.equal(val("SELECT LAST_DAY('2024-02-10')"), '2024-02-29');
  assert.equal(val("SELECT WEEK('2024-01-01')"), 0);
  assert.equal(val("SELECT WEEK('2024-01-07')"), 1);
  assert.equal(val("SELECT WEEKOFYEAR('2024-12-30')"), 1);
  assert.equal(val("SELECT YEARWEEK('2024-12-30', 3)"), 202501);
  assert.equal(val("SELECT TIMESTAMPDIFF(DAY, '2024-01-01', '2024-01-31')"), 30);
  assert.equal(val("SELECT TIMESTAMPDIFF(MONTH, '2024-01-31', '2024-02-29')"), 0);
  assert.equal(val("SELECT TIMESTAMPDIFF(MONTH, '2024-01-15', '2024-03-15')"), 2);
  assert.equal(val("SELECT TIMESTAMPDIFF(MINUTE, '2024-01-01 10:00:00', '2024-01-01 11:30:00')"), 90);
  assert.equal(val("SELECT TIMESTAMPDIFF(YEAR, '2000-06-15', '2024-06-14')"), 23);
  assert.equal(val("SELECT EXTRACT(YEAR FROM '2024-05-06')"), 2024);
  assert.equal(val("SELECT EXTRACT(MONTH FROM DATE '2024-05-06')"), 5);
  assert.equal(val("SELECT STR_TO_DATE('06/05/2024', '%d/%m/%Y')"), '2024-05-06');
  assert.equal(val("SELECT TIMEDIFF('2024-01-01 12:00:00', '2024-01-01 10:30:15')"), '01:29:45');
  assert.equal(val("SELECT TO_DAYS('2024-01-01') - TO_DAYS('2023-12-31')"), 1);
  assert.equal(val("SELECT CAST('2024-05-06 10:11:12' AS DATE)"), '2024-05-06');
});

test('CAST / CONVERT', () => {
  assert.equal(val("SELECT CAST('12' AS SIGNED) + 1"), 13);
  assert.equal(val('SELECT CAST(3.7 AS SIGNED)'), 4);
  assert.equal(val('SELECT CAST(2/3 AS DECIMAL(10,2))'), 0.67);
  assert.equal(val('SELECT CAST(12 AS CHAR)'), '12');
  assert.equal(val("SELECT CONVERT('5', UNSIGNED)"), 5);
});

test('IF, IFNULL, ISNULL, <=>, GREATEST/LEAST, &&', () => {
  assert.equal(val("SELECT IF(1 > 2, 'yes', 'no')"), 'no');
  assert.equal(val('SELECT IFNULL(NULL, 0)'), 0);
  assert.equal(val('SELECT ISNULL(NULL)'), 1);
  assert.equal(val('SELECT NULL <=> NULL'), 1);
  assert.equal(val('SELECT 1 <=> NULL'), 0);
  assert.equal(val('SELECT GREATEST(3, 7, 5)'), 7);
  assert.equal(val('SELECT LEAST(3, 7, 5)'), 3);
  assert.equal(val('SELECT 1 && 0'), 0);
});

test('GROUP_CONCAT with ORDER BY / SEPARATOR / DISTINCT', () => {
  const setup = "CREATE TABLE a (d DATE, p VARCHAR(10)); INSERT INTO a VALUES ('2020-01-01','b'),('2020-01-01','a'),('2020-01-01','b'),('2020-01-02','c');";
  assert.deepEqual(
    rows("SELECT d, COUNT(DISTINCT p) n, GROUP_CONCAT(DISTINCT p ORDER BY p SEPARATOR ',') ps FROM a GROUP BY d ORDER BY d", setup),
    [['2020-01-01', 2, 'a,b'], ['2020-01-02', 1, 'c']],
  );
  assert.equal(val("SELECT GROUP_CONCAT(p ORDER BY p DESC SEPARATOR ' | ') FROM a", setup), 'c | b | b | a');
  assert.equal(val("SELECT GROUP_CONCAT(DISTINCT p ORDER BY p SEPARATOR ';') FROM a", setup), 'a;b;c');
  assert.equal(val('SELECT GROUP_CONCAT(p) FROM a WHERE p = \'c\'', setup), 'c');
});

test('COUNT(DISTINCT a, b) and bitwise XOR', () => {
  const setup = "CREATE TABLE a (p INT, d DATE); INSERT INTO a VALUES (1,'2020-01-01'),(1,'2020-01-01'),(1,'2020-01-02'),(2,NULL);";
  assert.equal(val('SELECT COUNT(DISTINCT p, d) FROM a', setup), 2);
  assert.equal(val("SELECT CHAR(ASCII('f') ^ ASCII('m') ^ ASCII('m'))"), 'f');
  assert.equal(val('SELECT 5 ^ 3'), 6);
});

test('parenthesised SELECTs around UNION (LeetCode 1341 style)', () => {
  const setup = "CREATE TABLE t (n INT, s VARCHAR(5)); INSERT INTO t VALUES (1,'x'),(2,'y'),(3,'z');";
  assert.deepEqual(
    rows('(SELECT s AS results FROM t ORDER BY n LIMIT 1) UNION ALL (SELECT s FROM t ORDER BY n DESC LIMIT 1)', setup),
    [['x'], ['z']],
  );
  assert.deepEqual(cols('(SELECT s AS results FROM t ORDER BY n LIMIT 1) UNION ALL (SELECT s FROM t ORDER BY n DESC LIMIT 1)', setup), ['results']);
});

test('multi-table DELETE and UPDATE ... JOIN', () => {
  const setup = "CREATE TABLE Person (id INT PRIMARY KEY, email VARCHAR(50)); INSERT INTO Person VALUES (1,'a@x.com'),(2,'b@x.com'),(3,'a@x.com');";
  assert.deepEqual(
    rows('DELETE p1 FROM Person p1, Person p2 WHERE p1.email = p2.email AND p1.id > p2.id; SELECT id FROM Person ORDER BY id', setup),
    [[1], [2]],
  );
  assert.deepEqual(
    rows('DELETE p1 FROM Person p1 JOIN Person p2 ON p1.email = p2.email AND p1.id > p2.id; SELECT id FROM Person ORDER BY id', setup),
    [[1], [2]],
  );
  const s2 = 'CREATE TABLE e (id INT, d INT, sal INT); CREATE TABLE b (d INT, pct INT); INSERT INTO e VALUES (1,1,100),(2,2,100); INSERT INTO b VALUES (1,10);';
  assert.deepEqual(
    rows('UPDATE e JOIN b ON e.d = b.d SET e.sal = e.sal + e.sal * b.pct / 100; SELECT id, sal FROM e ORDER BY id', s2),
    [[1, 110], [2, 100]],
  );
});

test('upserts and INSERT IGNORE', () => {
  const setup = 'CREATE TABLE k (id INT PRIMARY KEY, n INT);';
  assert.deepEqual(
    rows('INSERT INTO k VALUES (1, 1); INSERT INTO k VALUES (1, 5) ON DUPLICATE KEY UPDATE n = n + VALUES(n); SELECT * FROM k', setup),
    [[1, 6]],
  );
  assert.deepEqual(rows('INSERT INTO k VALUES (1, 1); INSERT IGNORE INTO k VALUES (1, 9); SELECT * FROM k', setup), [[1, 1]]);
});

test('MySQL DDL: AUTO_INCREMENT, ENUM, inline KEY, table options', () => {
  const ddl = `CREATE TABLE users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      email VARCHAR(100) NOT NULL COMMENT 'login',
      role ENUM('admin','member') DEFAULT 'member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_email (email),
      KEY idx_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
  assert.deepEqual(
    rows(`${ddl} INSERT INTO users (email) VALUES ('a@x'), ('b@x'); SELECT id, email, role FROM users ORDER BY id`),
    [[1, 'a@x', 'member'], [2, 'b@x', 'member']],
  );
  const r = one(`${ddl} SHOW INDEX FROM users`);
  assert.ok(r.last.rows.some((row) => row.includes('idx_role')));
});

test('utility statements: SHOW TABLES, DESCRIBE, EXPLAIN, transactions, FROM DUAL', () => {
  const setup = 'CREATE TABLE t1 (id INT PRIMARY KEY, x TEXT); CREATE TABLE t2 (id INT);';
  assert.deepEqual(rows('SHOW TABLES', setup), [['t1'], ['t2']]);
  assert.deepEqual(rows('DESCRIBE t1', setup).map((r) => r[0]), ['id', 'x']);
  assert.ok(String(val('EXPLAIN SELECT * FROM t1 WHERE id = 1', setup)).includes('t1'));
  assert.equal(val('SELECT 1 + 1 FROM DUAL'), 2);
  assert.deepEqual(rows('START TRANSACTION; INSERT INTO t2 VALUES (1); ROLLBACK; SELECT COUNT(*) FROM t2', setup), [[0]]);
});

test('window frame RANGE with INTERVAL (LeetCode 1321 style)', () => {
  const setup = "CREATE TABLE c (d DATE, amt INT); INSERT INTO c VALUES ('2024-01-01',1),('2024-01-02',2),('2024-01-05',4),('2024-01-09',8);";
  assert.deepEqual(
    rows('SELECT d, SUM(amt) OVER (ORDER BY d RANGE BETWEEN INTERVAL 6 DAY PRECEDING AND CURRENT ROW) s FROM c ORDER BY d', setup),
    [['2024-01-01', 1], ['2024-01-02', 3], ['2024-01-05', 7], ['2024-01-09', 12]],
  );
});

test('column names are kept as written when the rewrite changes an expression', () => {
  assert.deepEqual(cols("SELECT DATE_ADD('2024-01-01', INTERVAL 1 DAY), IF(1,2,3), 10/4"), ["DATE_ADD('2024-01-01', INTERVAL 1 DAY)", 'IF(1,2,3)', '10/4']);
});

test('warnings for syntax MySQL would reject', () => {
  const setup = 'CREATE TABLE a (x INT); CREATE TABLE b (x INT);';
  assert.ok(one('SELECT * FROM a FULL OUTER JOIN b ON a.x = b.x', setup).warnings.some((w) => /FULL OUTER JOIN/.test(w)));
  assert.ok(one("SELECT strftime('%Y', '2024-01-01')").warnings.some((w) => /DATE_FORMAT/.test(w)));
  assert.ok(one('SELECT MAX(1, 2)').warnings.some((w) => /GREATEST/.test(w)));
  assert.ok(one('DELETE FROM a WHERE x NOT IN (SELECT MIN(x) FROM a GROUP BY x)', setup).warnings.some((w) => /1093/.test(w)));
  assert.equal(one('DELETE FROM a WHERE x NOT IN (SELECT m FROM (SELECT MIN(x) m FROM a GROUP BY x) t)', setup).warnings.length, 0);
  assert.ok(one("SELECT 'a' || 'b'").warnings.some((w) => /CONCAT/.test(w)));
});

test('friendly errors', () => {
  const db = engine.open('CREATE TABLE emp (id INT, salary INT);');
  const e1 = engine.run(db, "SELECT DATE_TRUNC('month', '2024-01-01')").error;
  assert.match(e1.hint, /DATE_FORMAT/);
  const e2 = engine.run(db, 'SELECT id FROM emp WHERE ROW_NUMBER() OVER (ORDER BY salary) = 1').error;
  assert.match(e2.hint, /subquery|CTE/);
  const e3 = engine.run(db, 'SELECT salry FROM emp').error;
  assert.match(e3.hint, /salary/);
  const e4 = engine.run(db, 'SET @r := 0').error;
  assert.match(e4.hint, /variable/i);
  db.close();
});

test('stored function harness (LeetCode 177)', () => {
  const setup = 'CREATE TABLE Employee (id INT, salary INT); INSERT INTO Employee VALUES (1,100),(2,200),(3,300),(4,200);';
  const fn = `CREATE FUNCTION getNthHighestSalary(N INT) RETURNS INT
BEGIN
  SET N = N - 1;
  RETURN (
      SELECT DISTINCT salary FROM Employee ORDER BY salary DESC LIMIT 1 OFFSET N
  );
END`;
  const db = engine.open(setup);
  const r2 = engine.callFunction(db, fn, 'getNthHighestSalary', [2]);
  assert.deepEqual(r2.last.columns, ['getNthHighestSalary(2)']);
  assert.deepEqual(r2.last.rows, [[200]]);
  assert.deepEqual(engine.callFunction(db, fn, 'getNthHighestSalary', [5]).last.rows, [[null]]);
  const fn2 = `CREATE FUNCTION getNthHighestSalary(N INT) RETURNS INT
BEGIN
  DECLARE M INT;
  SET M = N - 1;
  RETURN (SELECT DISTINCT salary FROM Employee ORDER BY salary DESC LIMIT M, 1);
END`;
  assert.deepEqual(engine.callFunction(db, fn2, 'getNthHighestSalary', [1]).last.rows, [[300]]);
  const fn3 = `CREATE FUNCTION getNthHighestSalary(N INT) RETURNS INT
BEGIN
  RETURN (
    SELECT salary FROM (SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) r FROM Employee) t
    WHERE r = N LIMIT 1
  );
END`;
  assert.deepEqual(engine.callFunction(db, fn3, 'getNthHighestSalary', [3]).last.rows, [[100]]);
  db.close();
});

test('ONLY_FULL_GROUP_BY lint: flags real violations, allows PK dependence', () => {
  const setup = `CREATE TABLE d (dept_id INT PRIMARY KEY, name VARCHAR(20));
    CREATE TABLE e (emp_id INT PRIMARY KEY, dept_id INT, name VARCHAR(20), salary INT);
    INSERT INTO d VALUES (1, 'Eng'); INSERT INTO e VALUES (1, 1, 'a', 10), (2, 1, 'b', 20);`;
  const w = (sql) => one(sql, setup).warnings;
  assert.ok(w('SELECT dept_id, name, COUNT(*) FROM e GROUP BY dept_id').some((x) => /1055/.test(x)));
  assert.ok(w('SELECT name, MAX(salary) FROM e').some((x) => /1140/.test(x)));
  assert.equal(w('SELECT dept_id, COUNT(*) FROM e GROUP BY dept_id').length, 0);
  assert.equal(w('SELECT d.dept_id, d.name, COUNT(*) FROM d JOIN e ON e.dept_id = d.dept_id GROUP BY d.dept_id').length, 0);
  assert.equal(w('SELECT d.name, COUNT(*) FROM e JOIN d ON e.dept_id = d.dept_id GROUP BY e.dept_id').length, 0);
  assert.equal(w("SELECT DATE_FORMAT('2024-01-01', '%Y-%m') AS m, COUNT(*) FROM e GROUP BY m").length, 0);
  assert.equal(w('SELECT emp_id, name, salary FROM e GROUP BY emp_id').length, 0);
  assert.equal(w('SELECT dept_id, COUNT(*) AS n FROM e GROUP BY 1 HAVING n > 1').length, 0);
  assert.equal(w('SELECT dept_id, SUM(salary) / COUNT(*) AS avg_sal FROM e GROUP BY dept_id').length, 0);
});

test('HAVING resolves SELECT aliases before columns, like MySQL', () => {
  const setup = 'CREATE TABLE o (p INT, unit INT); INSERT INTO o VALUES (1, 60), (1, 40), (2, 99);';
  assert.deepEqual(rows('SELECT p, SUM(unit) AS unit FROM o GROUP BY p HAVING unit >= 100', setup), [[1, 100]]);
});

test('ANY / SOME / ALL with MySQL NULL and empty-set semantics', () => {
  const setup = 'CREATE TABLE t (x INT); CREATE TABLE u (y INT); INSERT INTO t VALUES (1), (5), (9); INSERT INTO u VALUES (2), (6);';
  assert.deepEqual(rows('SELECT x FROM t WHERE x > ALL (SELECT y FROM u) ORDER BY x', setup), [[9]]);
  assert.deepEqual(rows('SELECT x FROM t WHERE x > ANY (SELECT y FROM u) ORDER BY x', setup), [[5], [9]]);
  assert.deepEqual(rows('SELECT x FROM t WHERE x + 4 > SOME (SELECT y FROM u) ORDER BY x', setup), [[1], [5], [9]]);
  assert.equal(val('SELECT 1 > ALL (SELECT y FROM u WHERE y > 100)', setup), 1);
  assert.equal(val('SELECT 1 > ANY (SELECT y FROM u WHERE y > 100)', setup), 0);
  assert.equal(val('SELECT 10 > ALL (SELECT NULL UNION ALL SELECT 2)', setup), null);
  assert.deepEqual(rows('SELECT COUNT(*) FROM t GROUP BY x HAVING COUNT(*) >= ALL (SELECT COUNT(*) FROM t GROUP BY x) ORDER BY 1', setup), [[1], [1], [1]]);
});

test('IN (SELECT …) followed by UNION is left alone', () => {
  const setup = 'CREATE TABLE t (x INT); INSERT INTO t VALUES (1), (2);';
  assert.deepEqual(rows('SELECT x FROM t WHERE x IN (SELECT 1) UNION ALL SELECT 7 ORDER BY 1', setup), [[1], [7]]);
});

test('reserved window-function names used as identifiers are flagged', () => {
  const setup = 'CREATE TABLE s (score INT); INSERT INTO s VALUES (1);';
  assert.ok(one('SELECT score, DENSE_RANK() OVER (ORDER BY score DESC) AS rank FROM s', setup).warnings.some((w) => /reserved/.test(w)));
  assert.equal(one('SELECT score, DENSE_RANK() OVER (ORDER BY score DESC) AS `rank` FROM s', setup).warnings.length, 0);
});

test('error 1093 lint only looks at subqueries of the same DML statement', () => {
  const setup = 'CREATE TABLE a (x INT); INSERT INTO a VALUES (1), (2);';
  assert.equal(one('UPDATE a SET x = x + 1 WHERE x > 0; SELECT x FROM a', setup).warnings.length, 0);
  assert.ok(one('SELECT 1; UPDATE a SET x = 0 WHERE x = (SELECT MAX(x) FROM a)', setup).warnings.some((w) => /1093/.test(w)));
});

test('DATE / DATETIME / TIME operands of arithmetic become numbers, like MySQL', () => {
  const setup = "CREATE TABLE w (id INT PRIMARY KEY, d DATE, ts DATETIME, t TIME, s VARCHAR(10)); " +
    "INSERT INTO w VALUES (1, '2024-01-31', '2024-01-31 10:00:00', '09:30:00', '2024-01-31'), (2, '2024-02-01', '2024-02-01 00:00:05', '10:00:00', '2024-02-01');";
  assert.deepEqual(rows('SELECT d + 1, d - 1, d + 0 FROM w ORDER BY id', setup), [[20240132, 20240130, 20240131], [20240202, 20240200, 20240201]]);
  assert.equal(val('SELECT b.d - a.d FROM w a JOIN w b ON b.id = a.id + 1', setup), 70);
  assert.equal(val('SELECT ts + 0 FROM w WHERE id = 1', setup), 20240131100000);
  assert.equal(val('SELECT t + 0 FROM w WHERE id = 1', setup), 93000);
  assert.equal(val('SELECT MAX(d) - MIN(d) FROM w', setup), 70);
  assert.equal(val("SELECT DATE('2024-03-01') - 1", setup), 20240300);
  assert.equal(val('SELECT d DIV 100 FROM w WHERE id = 1', setup), 202401);
  // strings stay strings (numeric prefix), and INTERVAL arithmetic stays date arithmetic
  assert.equal(val('SELECT s + 1 FROM w WHERE id = 1', setup), 2025);
  assert.equal(val('SELECT d + INTERVAL 1 DAY FROM w WHERE id = 1', setup), '2024-02-01');
  assert.equal(val('SELECT INTERVAL 1 DAY + d FROM w WHERE id = 1', setup), '2024-02-01');
  assert.equal(val("SELECT DATEDIFF(b.d, a.d) FROM w a JOIN w b ON b.id = a.id + 1", setup), 1);
  assert.deepEqual(cols('SELECT d + 1 FROM w', setup), ['d + 1']);
});

test('ranking functions are BIGINT UNSIGNED: negative arithmetic is error 1690', () => {
  const setup = 'CREATE TABLE w (id INT PRIMARY KEY, num INT); INSERT INTO w VALUES (1, 5), (2, 5), (3, 1), (4, 1), (5, 1);';
  const err = (sql) => { const db = engine.open(setup); const r = engine.run(db, sql); db.close(); return r.error; };
  assert.deepEqual(rows('SELECT id - ROW_NUMBER() OVER (ORDER BY id) FROM w', setup), [[0], [0], [0], [0], [0]]);
  assert.deepEqual(cols('SELECT id - ROW_NUMBER() OVER (ORDER BY id) FROM w', setup), ['id - ROW_NUMBER() OVER (ORDER BY id)']);
  assert.match(err('SELECT ROW_NUMBER() OVER (ORDER BY id) - id - 1 FROM w').message, /BIGINT UNSIGNED value is out of range/);
  assert.match(err('SELECT num - DENSE_RANK() OVER (PARTITION BY num ORDER BY id) AS g FROM w').hint, /1690/);
  assert.ok(err('WITH r AS (SELECT id, RANK() OVER (ORDER BY id) AS rn FROM w) SELECT a.id FROM r a JOIN r b ON a.rn - b.rn = 1'));
  // CAST(... AS SIGNED), division and multiplication are fine
  assert.deepEqual(rows('SELECT num - CAST(ROW_NUMBER() OVER (PARTITION BY num ORDER BY id) AS SIGNED) FROM w WHERE id < 3', setup), [[4], [3]]);
  assert.deepEqual(rows('SELECT ROW_NUMBER() OVER (ORDER BY id) / 2 FROM w WHERE id < 3', setup), [[0.5], [1]]);
  assert.deepEqual(rows('SELECT ROW_NUMBER() OVER (ORDER BY id) - ROW_NUMBER() OVER (PARTITION BY num ORDER BY id) AS g FROM w ORDER BY id', setup), [[0], [0], [2], [2], [2]]);
});

test('errors thrown inside MySQL functions keep their message', () => {
  const db = engine.open("CREATE TABLE t (s VARCHAR(10)); INSERT INTO t VALUES ('abc');");
  assert.match(engine.run(db, 'SELECT LEFT(s) FROM t').error.message, /Incorrect parameter count/);
  assert.equal(engine.run(db, "SELECT s REGEXP '(' FROM t").error.message, "Invalid regular expression '(': Unterminated group");
  db.close();
});

test('integer-valued MySQL functions stay integers (DIV, GROUP_CONCAT, CAST AS CHAR, LIKE)', () => {
  const setup = "CREATE TABLE t (d DATE, s VARCHAR(20)); INSERT INTO t VALUES ('2024-01-31', 'hello'), ('2024-02-10', 'hi');";
  assert.equal(val("SELECT GROUP_CONCAT(DATEDIFF(d, '2024-01-01') ORDER BY d) FROM t", setup), '30,40');
  assert.deepEqual(rows("SELECT CHAR_LENGTH(s) DIV 2, DATEDIFF(d, '2024-01-01') DIV 7, YEAR(d) DIV 10 FROM t ORDER BY d", setup), [[2, 4, 202], [1, 5, 202]]);
  assert.deepEqual(rows('SELECT CAST(CHAR_LENGTH(s) AS CHAR), CAST(2.7 AS SIGNED), ROUND(2.4), CONCAT(ROUND(2.5), \'\') FROM t ORDER BY d', setup)[0], ['5', 3, 2, '3']);
  assert.equal(val("SELECT CHAR_LENGTH(s) LIKE '5' FROM t ORDER BY d", setup), 1);
  assert.equal(val("SELECT GROUP_CONCAT(ROUND(x) ORDER BY x) FROM (SELECT 1.4 AS x UNION ALL SELECT 2.6) q"), '1,3');
});

test('string vs number comparisons follow MySQL (numeric) rules', () => {
  const setup = "CREATE TABLE t (id INT, d DATE, s VARCHAR(20), n INT); INSERT INTO t VALUES (1, '2024-01-31', '123abc', 7), (2, '2025-06-01', 'x', 12);";
  assert.deepEqual(rows("SELECT YEAR(d) = '2024', MONTH(d) IN ('1', '2'), LEFT(s, 3) = 123, CHAR_LENGTH(s) > '5', n = '7' FROM t WHERE id = 1", setup), [[1, 1, 1, 1, 1]]);
  assert.equal(val("SELECT COUNT(*) FROM t WHERE YEAR(d) = '2024'", setup), 1);
  assert.equal(val("SELECT COUNT(*) FROM t WHERE DATE_FORMAT(d, '%Y') = 2025", setup), 1);
  assert.equal(val("SELECT COUNT(*) FROM t WHERE YEAR(d) BETWEEN '2020' AND '2024'", setup), 1);
  assert.equal(val("SELECT COUNT(*) FROM t WHERE d = 20240131", setup), 1);
  assert.equal(val("SELECT COUNT(*) FROM t GROUP BY n HAVING COUNT(*) >= '1' ORDER BY 1 LIMIT 1", setup), 1);
  assert.deepEqual(rows("SELECT 10 > '9', '10' > 9, '10' > '9'"), [[1, 1, 0]]);
  // text-to-text and column comparisons are unchanged; LEFT/RIGHT joins aren't mistaken for functions
  assert.equal(val("SELECT COUNT(*) FROM t WHERE LEFT(s, 1) = '1'", setup), 1);
  assert.equal(val("SELECT COUNT(*) FROM t a LEFT JOIN t b ON a.id = b.n WHERE a.n = 7", setup), 1);
  assert.equal(val("SELECT CASE WHEN n > 10 THEN 'big' ELSE 'small' END = 'big' FROM t WHERE id = 2", setup), 1);
  assert.deepEqual(cols("SELECT YEAR(d) = '2024' FROM t", setup), ["YEAR(d) = '2024'"]);
});

test('a DATE compared with a numeric expression compares as YYYYMMDD, like MySQL', () => {
  const setup = "CREATE TABLE w (id INT, d DATE); INSERT INTO w VALUES (1, '2024-01-30'), (2, '2024-01-31'), (3, '2024-02-01');";
  // within a month the join works; across the month boundary 20240131 + 1 = 20240132 matches nothing
  assert.deepEqual(rows('SELECT a.id, b.id FROM w a JOIN w b ON b.d = a.d + 1 ORDER BY a.id', setup), [[1, 2]]);
  assert.deepEqual(rows('SELECT a.id, b.id FROM w a JOIN w b ON b.d - a.d = 1 ORDER BY a.id', setup), [[1, 2]]);
  assert.deepEqual(rows('SELECT a.id, b.id FROM w a JOIN w b ON DATEDIFF(b.d, a.d) = 1 ORDER BY a.id', setup), [[1, 2], [2, 3]]);
});
