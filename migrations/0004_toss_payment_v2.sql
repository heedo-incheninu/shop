ALTER TABLE users ADD COLUMN toss_customer_key TEXT;
UPDATE users
SET toss_customer_key = 'customer_' || lower(hex(randomblob(16)))
WHERE toss_customer_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_toss_customer_key
  ON users(toss_customer_key)
  WHERE toss_customer_key IS NOT NULL;

ALTER TABLE orders ADD COLUMN toss_order_id TEXT;
UPDATE orders
SET toss_order_id = 'shop-' || id
WHERE toss_order_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_toss_order_id
  ON orders(toss_order_id)
  WHERE toss_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_key
  ON orders(payment_key)
  WHERE payment_key IS NOT NULL;
