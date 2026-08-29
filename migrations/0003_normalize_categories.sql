CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
INSERT OR IGNORE INTO categories (name) VALUES ('잡화'), ('뷰티'), ('신발'), ('식품');

CREATE TABLE products_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  description TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
INSERT INTO products_new (id, name, price, description, category_id, image_url)
SELECT p.id, p.name, p.price, p.description, c.id, p.image_url
FROM products p JOIN categories c ON c.name = p.category;
CREATE TABLE cart_items_backup AS SELECT * FROM cart_items;
CREATE TABLE order_items_backup AS SELECT * FROM order_items;
DROP TABLE cart_items;
DROP TABLE order_items;
DROP TABLE products;
ALTER TABLE products_new RENAME TO products;
CREATE TABLE cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99), UNIQUE (user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (product_id) REFERENCES products(id)
);
INSERT INTO cart_items SELECT * FROM cart_items_backup;
DROP TABLE cart_items_backup;
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99), price INTEGER NOT NULL CHECK (price >= 0),
  FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (product_id) REFERENCES products(id)
);
INSERT INTO order_items SELECT * FROM order_items_backup;
DROP TABLE order_items_backup;
CREATE INDEX IF NOT EXISTS idx_cart_items_user_id ON cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON cart_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
