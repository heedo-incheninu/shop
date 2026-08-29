CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99),
  UNIQUE (user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99),
  price INTEGER NOT NULL CHECK (price >= 0),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

INSERT OR IGNORE INTO products (id, name, price, category, description, image_url) VALUES
  (1, '미니멀 토트백', 89000, '잡화', '각을 살린 검정 가죽 토트백', '/products/bag.jpg'),
  (2, '클래식 손목시계', 145000, '잡화', '흰 문자판에 검정 가죽 밴드', '/products/watch.jpg'),
  (3, '시트러스 오드뚜왈렛', 78000, '뷰티', '상쾌한 시트러스 계열 향수', '/products/perfume.jpg'),
  (4, '매트 레드 립스틱', 32000, '뷰티', '발색이 선명한 매트 타입', '/products/lipstick.jpg'),
  (5, '러닝화 블루', 112000, '신발', '쿠션이 두꺼운 남성 러닝화', '/products/shoe.jpg'),
  (6, '러닝화 핑크', 112000, '신발', '같은 모델의 여성 러닝화', '/products/shoe2.jpg'),
  (7, '레드와인 피노타지', 42000, '식품', '남아프리카산 드라이 레드와인', '/products/wine.jpg'),
  (8, '이탈리아 파스타 면', 6500, '식품', '세몰리나 100% 숏 파스타 450g', '/products/pasta.jpg');
