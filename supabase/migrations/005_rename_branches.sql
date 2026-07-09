-- Rename existing branches to reflect real locations
UPDATE branches SET name = 'Ram Nagar' WHERE name LIKE 'Branch 1%';
UPDATE branches SET name = '100 Feet Road' WHERE name LIKE 'Branch 2%';
UPDATE branches SET name = 'Hopes' WHERE name LIKE 'Branch 3%';
