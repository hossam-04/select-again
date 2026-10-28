-- The course's sample database: a small electronics company and its online shop.
-- Deliberate edge cases: NULLs (CEO has no department, missing emails/cities),
-- salary ties, a department with no staff, customers who never ordered,
-- a product nobody bought, and prices that changed over time.

CREATE TABLE departments (
  dept_id   INT PRIMARY KEY,
  name      VARCHAR(50) NOT NULL,
  location  VARCHAR(50),
  budget    DECIMAL(12,2)
);

CREATE TABLE employees (
  emp_id      INT PRIMARY KEY,
  first_name  VARCHAR(50) NOT NULL,
  last_name   VARCHAR(50) NOT NULL,
  email       VARCHAR(100),
  dept_id     INT,
  manager_id  INT,
  title       VARCHAR(60),
  salary      DECIMAL(10,2) NOT NULL,
  hire_date   DATE NOT NULL
);

CREATE TABLE customers (
  customer_id  INT PRIMARY KEY,
  name         VARCHAR(60) NOT NULL,
  email        VARCHAR(100),
  city         VARCHAR(50),
  country      VARCHAR(50) NOT NULL,
  signup_date  DATE NOT NULL,
  referred_by  INT
);

CREATE TABLE products (
  product_id  INT PRIMARY KEY,
  name        VARCHAR(60) NOT NULL,
  category    VARCHAR(30) NOT NULL,
  price       DECIMAL(10,2) NOT NULL
);

CREATE TABLE orders (
  order_id     INT PRIMARY KEY,
  customer_id  INT NOT NULL,
  order_date   DATE NOT NULL,
  status       ENUM('pending', 'shipped', 'delivered', 'cancelled') NOT NULL
);

CREATE TABLE order_items (
  order_id    INT,
  product_id  INT,
  quantity    INT NOT NULL,
  unit_price  DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE logins (
  customer_id  INT NOT NULL,
  login_date   DATE NOT NULL
);

INSERT INTO departments VALUES
  (1, 'Engineering', 'Berlin', 900000),
  (2, 'Sales',       'Cairo',  400000),
  (3, 'Marketing',   'London', 250000),
  (4, 'Finance',     'Cairo',  300000),
  (5, 'Legal',       NULL,     150000);

INSERT INTO employees VALUES
  (1,  'Nadia',   'Hassan',  'nadia.hassan@acme.test',   NULL, NULL, 'Chief Executive Officer', 250000, '2016-03-01'),
  (2,  'Omar',    'Farouk',  'omar.farouk@acme.test',    1,    1,    'VP Engineering',          180000, '2017-06-12'),
  (3,  'Lina',    'Chen',    'lina.chen@acme.test',      1,    2,    'Staff Engineer',          150000, '2018-09-03'),
  (4,  'Karim',   'Adel',    'karim.adel@acme.test',     1,    2,    'Senior Engineer',         125000, '2019-11-18'),
  (5,  'Sara',    'Lopez',   'sara.lopez@acme.test',     1,    3,    'Engineer',                110000, '2021-02-01'),
  (6,  'Ben',     'Carter',  'ben.carter@acme.test',     1,    3,    'Engineer',                110000, '2022-07-15'),
  (7,  'Aya',     'Mahmoud', 'aya.mahmoud@acme.test',    1,    4,    'Junior Engineer',          85000, '2024-01-08'),
  (8,  'Youssef', 'Nabil',   'youssef.nabil@acme.test',  2,    1,    'Sales Director',          140000, '2018-01-22'),
  (9,  'Emma',    'Wilson',  'emma.wilson@acme.test',    2,    8,    'Account Executive',        90000, '2020-05-04'),
  (10, 'Hana',    'Saleh',   'hana.saleh@acme.test',     2,    8,    'Account Executive',        90000, '2023-03-13'),
  (11, 'Tom',     'Becker',  'tom.becker@acme.test',     2,    8,    'Sales Associate',          62000, '2024-06-03'),
  (12, 'Mariam',  'Fathy',   'mariam.fathy@acme.test',   3,    1,    'Marketing Lead',          115000, '2019-04-29'),
  (13, 'Leo',     'Martin',  'Leo.Martin@Acme.test',     3,    12,   'Content Specialist',       72000, '2022-10-10'),
  (14, 'Priya',   'Nair',    'priya.nair@acme.test',     4,    1,    'Finance Manager',         120000, '2020-08-17'),
  (15, 'Ahmed',   'Samir',   NULL,                       4,    14,   'Accountant',               78000, '2023-09-25'),
  (16, 'Julia',   'Rossi',   'julia.rossi@acme.test',    4,    14,   'Financial Analyst',        78000, '2025-01-06');

INSERT INTO customers VALUES
  (1,  'Alice Green',   'alice@mail.test',  'London',     'UK',       '2024-01-05', NULL),
  (2,  'Bilal Khan',    'bilal@mail.test',  'Cairo',      'Egypt',    '2024-01-19', 1),
  (3,  'Chloe Dubois',  'chloe@mail.test',  'Paris',      'France',   '2024-02-02', NULL),
  (4,  'Diego Alvarez', NULL,               'Madrid',     'Spain',    '2024-02-14', 2),
  (5,  'Farah Aziz',    'farah@mail.test',  'Cairo',      'Egypt',    '2024-03-08', 2),
  (6,  'George Miller', 'george@mail.test', NULL,         'USA',      '2024-03-21', NULL),
  (7,  'Hiro Tanaka',   'hiro@mail.test',   'Tokyo',      'Japan',    '2024-04-11', 3),
  (8,  'Ines Costa',    'ines@mail.test',   'Lisbon',     'Portugal', '2024-05-30', NULL),
  (9,  'Jamal Idris',   'jamal@mail.test',  'Cairo',      'Egypt',    '2024-07-02', 5),
  (10, 'Kate Novak',    'kate@mail.test',   'Prague',     'Czechia',  '2024-09-17', NULL),
  (11, 'Luis Romero',   'luis@mail.test',   'Madrid',     'Spain',    '2024-11-25', 4),
  (12, 'Mona Adel',     'mona@mail.test',   'Alexandria', 'Egypt',    '2025-01-10', 9);

INSERT INTO products VALUES
  (1,  'Laptop Pro 14',               'Computers',   1899.00),
  (2,  'Laptop Air 13',               'Computers',   1199.00),
  (3,  '4K Monitor',                  'Accessories',  449.00),
  (4,  'Mechanical Keyboard',         'Accessories',  129.00),
  (5,  'Wireless Mouse',              'Accessories',   49.00),
  (6,  'USB-C Hub',                   'Accessories',   59.00),
  (7,  'Noise-Cancelling Headphones', 'Audio',        299.00),
  (8,  'Bluetooth Speaker',           'Audio',         89.00),
  (9,  'Phone X',                     'Phones',       999.00),
  (10, 'Phone Case',                  'Phones',        25.00),
  (11, 'Smart Watch',                 'Wearables',    349.00);

INSERT INTO orders VALUES
  (1,  1,  '2024-01-10', 'delivered'),
  (2,  2,  '2024-01-22', 'delivered'),
  (3,  1,  '2024-02-03', 'delivered'),
  (4,  3,  '2024-02-15', 'cancelled'),
  (5,  4,  '2024-02-28', 'delivered'),
  (6,  5,  '2024-03-12', 'delivered'),
  (7,  2,  '2024-03-30', 'delivered'),
  (8,  6,  '2024-04-05', 'delivered'),
  (9,  7,  '2024-05-02', 'delivered'),
  (10, 3,  '2024-05-20', 'delivered'),
  (11, 8,  '2024-06-11', 'delivered'),
  (12, 5,  '2024-07-04', 'cancelled'),
  (13, 9,  '2024-07-19', 'delivered'),
  (14, 2,  '2024-08-08', 'delivered'),
  (15, 1,  '2024-09-14', 'delivered'),
  (16, 7,  '2024-10-01', 'delivered'),
  (17, 4,  '2024-11-11', 'delivered'),
  (18, 9,  '2024-11-29', 'delivered'),
  (19, 5,  '2024-12-15', 'delivered'),
  (20, 12, '2025-01-12', 'delivered'),
  (21, 1,  '2025-01-25', 'shipped'),
  (22, 8,  '2025-02-07', 'shipped'),
  (23, 9,  '2025-02-21', 'pending'),
  (24, 3,  '2025-03-02', 'pending');

INSERT INTO order_items VALUES
  (1, 1, 1, 1899.00), (1, 5, 1, 49.00),
  (2, 9, 1, 999.00),  (2, 10, 2, 25.00),
  (3, 4, 1, 129.00),  (3, 3, 2, 449.00),
  (4, 2, 1, 1199.00),
  (5, 7, 1, 299.00),
  (6, 9, 1, 949.00),
  (7, 8, 2, 89.00),   (7, 6, 1, 59.00),
  (8, 1, 1, 1899.00), (8, 3, 1, 449.00), (8, 4, 1, 129.00),
  (9, 10, 3, 25.00),
  (10, 5, 2, 49.00),  (10, 6, 2, 59.00),
  (11, 2, 1, 1149.00), (11, 7, 1, 279.00),
  (12, 8, 1, 89.00),
  (13, 9, 2, 949.00),
  (14, 7, 1, 299.00), (14, 5, 1, 49.00),
  (15, 3, 1, 429.00),
  (16, 1, 1, 1799.00), (16, 6, 1, 59.00),
  (17, 4, 2, 119.00),
  (18, 9, 1, 899.00), (18, 10, 1, 19.00), (18, 8, 1, 69.00),
  (19, 2, 1, 1099.00),
  (20, 7, 1, 289.00), (20, 5, 1, 45.00),
  (21, 9, 1, 999.00),
  (22, 3, 1, 449.00), (22, 4, 1, 129.00),
  (23, 1, 1, 1899.00),
  (24, 5, 3, 49.00);

INSERT INTO logins VALUES
  (1, '2025-03-01'), (1, '2025-03-02'), (1, '2025-03-03'), (1, '2025-03-05'), (1, '2025-03-06'), (1, '2025-03-09'),
  (2, '2025-03-01'), (2, '2025-03-03'), (2, '2025-03-04'), (2, '2025-03-05'), (2, '2025-03-06'),
  (3, '2025-03-02'),
  (5, '2025-03-04'), (5, '2025-03-05'), (5, '2025-03-05'), (5, '2025-03-06'), (5, '2025-03-07'),
  (7, '2025-03-08'), (7, '2025-03-09');
