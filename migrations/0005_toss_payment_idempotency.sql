ALTER TABLE orders ADD COLUMN payment_idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_idempotency_key
  ON orders(payment_idempotency_key)
  WHERE payment_idempotency_key IS NOT NULL;
