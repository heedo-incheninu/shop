import { compare, hash } from 'bcryptjs';

const SESSION_COOKIE = 'shop_sid';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const CATEGORIES = ['잡화', '뷰티', '신발', '식품'];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function readCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function sessionCookie(value) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax`;
}

async function sessionUser(request, env) {
  let sid = readCookie(request, SESSION_COOKIE);
  let setCookie = null;
  if (!sid || !/^[a-f0-9-]{20,80}$/i.test(sid)) {
    sid = crypto.randomUUID();
    setCookie = sessionCookie(sid);
  }
  const existingSession = await env.DB.prepare(
    `SELECT s.user_id AS userId
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?1 AND u.email NOT LIKE '%@local.invalid' AND u.password_hash != '!guest-session!'`,
  ).bind(sid).first();
  return { userId: existingSession?.userId || null, sid, setCookie, authenticated: Boolean(existingSession) };
}

function requireAuth(session) {
  return session.authenticated && session.userId ? null : json({ error: '로그인이 필요합니다.' }, 401);
}

function withCookie(response, cookie) {
  if (!cookie) return response;
  const headers = new Headers(response.headers);
  headers.append('set-cookie', cookie);
  return new Response(response.body, { status: response.status, headers });
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validProductId(value) {
  const id = Number(typeof value === 'string' ? value.trim() : value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validQty(value) {
  const qty = Number(value);
  return Number.isInteger(qty) && qty >= 1 && qty <= 99 ? qty : null;
}

function randomCustomerKey() {
  return `customer_${crypto.randomUUID().replaceAll('-', '')}`;
}

function randomTossOrderId() {
  return `shop-${crypto.randomUUID()}`;
}

function validTossOrderId(value) {
  const orderId = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{6,64}$/.test(orderId) ? orderId : null;
}

function validPaymentKey(value) {
  const paymentKey = typeof value === 'string' ? value.trim() : '';
  return paymentKey.length >= 1 && paymentKey.length <= 200 ? paymentKey : null;
}

function paymentMatches(payment, paymentKey, tossOrderId, amount) {
  return payment?.paymentKey === paymentKey
    && payment.orderId === tossOrderId
    && Number(payment.totalAmount) === amount;
}

async function releasePaymentReservation(env, orderId, userId, paymentKey, idempotencyKey) {
  await env.DB.prepare(
    "UPDATE orders SET payment_key = NULL, payment_idempotency_key = NULL WHERE id = ?1 AND user_id = ?2 AND status = 'pending' AND payment_key = ?3 AND payment_idempotency_key = ?4",
  ).bind(orderId, userId, paymentKey, idempotencyKey).run();
}

async function cartRows(env, userId) {
  const result = await env.DB.prepare(
    `SELECT c.product_id AS productId, c.qty, p.name, p.price, p.description, cat.name AS category, p.image_url AS imageUrl,
            (c.qty * p.price) AS subtotal
       FROM cart_items c JOIN products p ON p.id = c.product_id JOIN categories cat ON cat.id = p.category_id
      WHERE c.user_id = ?1 ORDER BY c.id`,
  ).bind(userId).all();
  const items = result.results || [];
  return { items, total: items.reduce((sum, item) => sum + item.subtotal, 0) };
}

async function api(request, env, url) {
  if (!env.DB) return json({ error: 'D1 DB binding is not configured.' }, 500);
  const session = await sessionUser(request, env);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const parts = path ? path.split('/').map((part) => decodeURIComponent(part)) : [];

  if (request.method === 'GET' && parts[0] === 'session') {
    const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?1').bind(session.userId).first();
    return withCookie(json({ ok: true, user }), session.setCookie);
  }

  if (request.method === 'GET' && parts[0] === 'config') {
    const denied = requireAuth(session); if (denied) return denied;
    const user = await env.DB.prepare('SELECT toss_customer_key AS tossCustomerKey FROM users WHERE id = ?1').bind(session.userId).first();
    if (!user) return json({ error: '회원 정보를 찾을 수 없습니다.' }, 404);
    let customerKey = user.tossCustomerKey;
    if (!customerKey) {
      const candidate = randomCustomerKey();
      await env.DB.prepare('UPDATE users SET toss_customer_key = ?1 WHERE id = ?2 AND toss_customer_key IS NULL').bind(candidate, session.userId).run();
      const updated = await env.DB.prepare('SELECT toss_customer_key AS tossCustomerKey FROM users WHERE id = ?1').bind(session.userId).first();
      customerKey = updated?.tossCustomerKey;
    }
    if (!env.TOSS_CLIENT_KEY || !customerKey) return json({ error: '결제 설정을 불러올 수 없습니다.' }, 503);
    return withCookie(json({ tossClientKey: env.TOSS_CLIENT_KEY, customerKey }), session.setCookie);
  }
  if (request.method === 'POST' && parts[0] === 'register') {
    const data = await body(request);
    if (!data?.email || !/^\S+@\S+\.\S+$/.test(data.email) || String(data.password || '').length < 8 || !data.name) return json({ error: '이메일, 이름과 8자 이상 비밀번호를 입력해 주세요.' }, 400);
    try { await env.DB.prepare('INSERT INTO users (email, password_hash, name, toss_customer_key) VALUES (?1, ?2, ?3, ?4)').bind(data.email.trim().toLowerCase(), await hash(data.password, 12), String(data.name).trim(), randomCustomerKey()).run(); } catch { return json({ error: '이미 가입된 이메일입니다.' }, 409); }
    return json({ ok: true }, 201);
  }
  if (request.method === 'POST' && parts[0] === 'login') {
    const data = await body(request); const user = await env.DB.prepare('SELECT id, email, name, password_hash AS passwordHash FROM users WHERE email = ?1').bind(String(data?.email || '').trim().toLowerCase()).first();
    if (!user || !await compare(String(data?.password || ''), user.passwordHash)) return json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);
    const sid = crypto.randomUUID(); await env.DB.prepare('INSERT INTO sessions (id, user_id) VALUES (?1, ?2)').bind(sid, user.id).run();
    return withCookie(json({ user: { id: user.id, email: user.email, name: user.name } }), sessionCookie(sid));
  }
  if (request.method === 'POST' && parts[0] === 'logout') {
    const sid = readCookie(request, SESSION_COOKIE); if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(sid).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` } });
  }

  if (request.method === 'GET' && parts[0] === 'products' && !parts[1]) {
    const category = url.searchParams.get('category');
    if (category && !CATEGORIES.includes(category)) return json({ error: '잘못된 분류입니다.' }, 400);
    const query = category
      ? 'SELECT p.id, p.name, p.price, p.description, c.name AS category, p.image_url AS imageUrl FROM products p JOIN categories c ON c.id = p.category_id WHERE c.name = ?1 ORDER BY p.id'
      : 'SELECT p.id, p.name, p.price, p.description, c.name AS category, p.image_url AS imageUrl FROM products p JOIN categories c ON c.id = p.category_id ORDER BY p.id';
    const result = category ? await env.DB.prepare(query).bind(category).all() : await env.DB.prepare(query).all();
    return withCookie(json({ products: result.results || [], categories: CATEGORIES }), session.setCookie);
  }

  if (request.method === 'GET' && parts[0] === 'products' && parts[1]) {
    const id = validProductId(parts[1]);
    if (!id) return json({ error: '잘못된 상품 번호입니다.' }, 400);
    const product = await env.DB.prepare(
      'SELECT p.id, p.name, p.price, p.description, c.name AS category, p.image_url AS imageUrl FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?1',
    ).bind(id).first();
    return product ? withCookie(json({ product }), session.setCookie) : json({ error: '상품을 찾을 수 없습니다.' }, 404);
  }

  if (parts[0] === 'cart' && parts.length === 1 && request.method === 'GET') {
    const denied = requireAuth(session); if (denied) return denied;
    return withCookie(json(await cartRows(env, session.userId)), session.setCookie);
  }

  if (parts[0] === 'cart' && parts.length === 1 && request.method === 'POST') {
    const denied = requireAuth(session); if (denied) return denied;
    const data = await body(request);
    const productId = validProductId(data?.productId);
    const qty = validQty(data?.qty);
    if (!productId || !qty) return json({ error: '상품 번호와 수량(1~99)을 확인해 주세요.' }, 400);
    const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?1').bind(productId).first();
    if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    await env.DB.prepare(
      `INSERT INTO cart_items (user_id, product_id, qty) VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id, product_id) DO UPDATE SET qty = MIN(99, cart_items.qty + excluded.qty)`,
    ).bind(session.userId, productId, qty).run();
    return withCookie(json(await cartRows(env, session.userId), 201), session.setCookie);
  }

  if (parts[0] === 'cart' && parts.length === 2 && ['PATCH', 'DELETE'].includes(request.method)) {
    const denied = requireAuth(session); if (denied) return denied;
    const productId = validProductId(parts[1]);
    if (!productId) return json({ error: '잘못된 상품 번호입니다.' }, 400);
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM cart_items WHERE user_id = ?1 AND product_id = ?2').bind(session.userId, productId).run();
    } else {
      const data = await body(request);
      const qty = validQty(data?.qty);
      if (!qty) return json({ error: '수량은 1~99 사이여야 합니다.' }, 400);
      await env.DB.prepare('UPDATE cart_items SET qty = ?1 WHERE user_id = ?2 AND product_id = ?3').bind(qty, session.userId, productId).run();
    }
    return withCookie(json(await cartRows(env, session.userId)), session.setCookie);
  }

  if (parts[0] === 'orders' && parts.length === 1 && request.method === 'POST') {
    const denied = requireAuth(session); if (denied) return denied;
    const cart = await cartRows(env, session.userId);
    if (!cart.items.length) return json({ error: '장바구니가 비어 있습니다.' }, 400);
    const tossOrderId = randomTossOrderId();
    const orderResult = await env.DB.prepare(
      "INSERT INTO orders (user_id, total, status, toss_order_id) VALUES (?1, ?2, 'pending', ?3)",
    ).bind(session.userId, cart.total, tossOrderId).run();
    const orderId = orderResult.meta.last_row_id;
    const statements = cart.items.map((item) => env.DB.prepare(
      'INSERT INTO order_items (order_id, product_id, qty, price) VALUES (?1, ?2, ?3, ?4)',
    ).bind(orderId, item.productId, item.qty, item.price));
    statements.push(env.DB.prepare('DELETE FROM cart_items WHERE user_id = ?1').bind(session.userId));
    await env.DB.batch(statements);
    return withCookie(json({ order: { id: orderId, tossOrderId, total: cart.total, status: 'pending', items: cart.items } }, 201), session.setCookie);
  }

  if (parts[0] === 'orders' && parts.length === 1 && request.method === 'GET') {
    const denied = requireAuth(session); if (denied) return denied;
    const result = await env.DB.prepare('SELECT id, total, status, created_at AS createdAt FROM orders WHERE user_id = ?1 ORDER BY id DESC').bind(session.userId).all();
    return withCookie(json({ orders: result.results || [] }), session.setCookie);
  }

  if (parts[0] === 'payments' && parts[1] === 'confirm' && request.method === 'POST') {
    const denied = requireAuth(session); if (denied) return denied;
    const data = await body(request);
    const tossOrderId = validTossOrderId(data?.orderId);
    const paymentKey = validPaymentKey(data?.paymentKey);
    const amount = Number(data?.amount);
    if (!tossOrderId || !paymentKey || !Number.isSafeInteger(amount) || amount < 1) return json({ error: '결제 정보를 확인해 주세요.' }, 400);

    const order = await env.DB.prepare(
      'SELECT id, total, status, payment_key AS paymentKey, payment_idempotency_key AS paymentIdempotencyKey, toss_order_id AS tossOrderId FROM orders WHERE toss_order_id = ?1 AND user_id = ?2',
    ).bind(tossOrderId, session.userId).first();
    if (!order) return json({ error: '주문을 찾을 수 없습니다.' }, 404);
    if (Number(order.total) !== amount) return json({ error: '주문 금액을 확인해 주세요.' }, 400);
    if (order.status === 'paid') {
      return order.paymentKey === paymentKey
        ? json({ ok: true, orderId: order.id })
        : json({ error: '이미 다른 결제 정보로 승인된 주문입니다.' }, 409);
    }
    if (!env.TOSS_SECRET_KEY) return json({ error: '결제 승인 설정이 완료되지 않았습니다.' }, 503);

    if (order.paymentKey && order.paymentKey !== paymentKey) return json({ error: '다른 결제 승인이 진행 중인 주문입니다.' }, 409);
    let idempotencyKey = order.paymentIdempotencyKey;
    if (!order.paymentKey) {
      try {
        const candidate = crypto.randomUUID();
        const reserved = await env.DB.prepare(
          "UPDATE orders SET payment_key = ?1, payment_idempotency_key = ?2 WHERE id = ?3 AND user_id = ?4 AND toss_order_id = ?5 AND total = ?6 AND status = 'pending' AND payment_key IS NULL",
        ).bind(paymentKey, candidate, order.id, session.userId, tossOrderId, amount).run();
        if (reserved.meta.changes) idempotencyKey = candidate;
        if (!reserved.meta.changes) {
          const current = await env.DB.prepare('SELECT status, payment_key AS paymentKey, payment_idempotency_key AS paymentIdempotencyKey FROM orders WHERE id = ?1 AND user_id = ?2').bind(order.id, session.userId).first();
          if (current?.status === 'paid' && current.paymentKey === paymentKey) return json({ ok: true, orderId: order.id });
          if (current?.status !== 'pending' || current.paymentKey !== paymentKey) return json({ error: '다른 결제 승인이 진행 중인 주문입니다.' }, 409);
          idempotencyKey = current.paymentIdempotencyKey;
        }
      } catch (error) {
        console.error('Payment reservation failed', error);
        return json({ error: '이미 다른 주문에 사용된 결제 정보입니다.' }, 409);
      }
    }

    if (!idempotencyKey) {
      const candidate = crypto.randomUUID();
      await env.DB.prepare(
        "UPDATE orders SET payment_idempotency_key = ?1 WHERE id = ?2 AND user_id = ?3 AND status = 'pending' AND payment_key = ?4 AND payment_idempotency_key IS NULL",
      ).bind(candidate, order.id, session.userId, paymentKey).run();
      const current = await env.DB.prepare('SELECT payment_idempotency_key AS paymentIdempotencyKey FROM orders WHERE id = ?1 AND user_id = ?2 AND payment_key = ?3').bind(order.id, session.userId, paymentKey).first();
      idempotencyKey = current?.paymentIdempotencyKey;
    }
    if (!idempotencyKey) return json({ error: '결제 승인 요청을 준비하지 못했습니다.' }, 409);

    const authorization = btoa(`${env.TOSS_SECRET_KEY}:`);
    let tossResponse;
    try {
      tossResponse = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
        method: 'POST',
        headers: {
          authorization: `Basic ${authorization}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ paymentKey, orderId: tossOrderId, amount }),
      });
    } catch (error) {
      console.error('Toss payment confirmation request failed', error);
      return json({ error: '결제 승인 서버에 연결하지 못했습니다.' }, 502);
    }

    let payment = await tossResponse.json().catch(() => ({}));
    if (!tossResponse.ok) {
      const confirmationError = payment;
      const confirmationWasAmbiguous = tossResponse.status >= 500 || [408, 409, 429].includes(tossResponse.status);
      let lookupResponse;
      try {
        lookupResponse = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`, {
          headers: { authorization: `Basic ${authorization}` },
        });
      } catch (error) {
        console.error('Toss payment lookup request failed', error);
        return json({ error: '결제 상태를 확인하지 못했습니다.' }, 502);
      }

      const lookupPayment = await lookupResponse.json().catch(() => ({}));
      if (lookupResponse.ok && paymentMatches(lookupPayment, paymentKey, tossOrderId, amount)) {
        payment = lookupPayment;
        if (payment.status === 'WAITING_FOR_DEPOSIT') return json({ ok: true, pending: true, orderId: order.id }, 202);
        if (payment.status !== 'DONE') {
          if (!confirmationWasAmbiguous) await releasePaymentReservation(env, order.id, session.userId, paymentKey, idempotencyKey);
          return json({ error: confirmationError.message || '결제 승인에 실패했습니다.' }, confirmationWasAmbiguous ? 502 : 400);
        }
      } else if (!confirmationWasAmbiguous && lookupResponse.status < 500) {
        await releasePaymentReservation(env, order.id, session.userId, paymentKey, idempotencyKey);
        return json({ error: confirmationError.message || '결제 승인에 실패했습니다.' }, 400);
      } else {
        return json({ error: '결제 상태를 확인하지 못했습니다.' }, 502);
      }
    }

    if (paymentMatches(payment, paymentKey, tossOrderId, amount) && payment.status === 'WAITING_FOR_DEPOSIT') {
      return json({ ok: true, pending: true, orderId: order.id }, 202);
    }
    if (!paymentMatches(payment, paymentKey, tossOrderId, amount) || payment.status !== 'DONE') {
      console.error('Unexpected Toss payment confirmation response', { orderId: tossOrderId, status: payment.status });
      return json({ error: '결제 승인 결과를 확인하지 못했습니다.' }, 502);
    }

    try {
      const updated = await env.DB.prepare(
        "UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ?1 AND user_id = ?2 AND toss_order_id = ?3 AND total = ?4 AND status = 'pending' AND payment_key = ?5",
      ).bind(order.id, session.userId, tossOrderId, amount, paymentKey).run();
      if (!updated.meta.changes) {
        const current = await env.DB.prepare('SELECT status, payment_key AS paymentKey FROM orders WHERE id = ?1 AND user_id = ?2').bind(order.id, session.userId).first();
        if (current?.status !== 'paid' || current.paymentKey !== paymentKey) return json({ error: '주문 상태를 갱신하지 못했습니다.' }, 409);
      }
    } catch (error) {
      console.error('Payment state update failed', error);
      return json({ error: '이미 처리된 결제 정보입니다.' }, 409);
    }
    return json({ ok: true, orderId: order.id });
  }

  if (parts[0] === 'orders' && parts.length === 2 && request.method === 'GET') {
    const denied = requireAuth(session); if (denied) return denied;
    const orderId = validProductId(parts[1]);
    if (!orderId) return json({ error: '잘못된 주문 번호입니다.' }, 400);
    let order = await env.DB.prepare(
      'SELECT id, total, status, toss_order_id AS tossOrderId, created_at AS createdAt FROM orders WHERE id = ?1 AND user_id = ?2',
    ).bind(orderId, session.userId).first();
    if (!order) return json({ error: '주문을 찾을 수 없습니다.' }, 404);
    if (!order.tossOrderId) {
      const candidate = randomTossOrderId();
      await env.DB.prepare('UPDATE orders SET toss_order_id = ?1 WHERE id = ?2 AND user_id = ?3 AND toss_order_id IS NULL').bind(candidate, orderId, session.userId).run();
      order = await env.DB.prepare(
        'SELECT id, total, status, toss_order_id AS tossOrderId, created_at AS createdAt FROM orders WHERE id = ?1 AND user_id = ?2',
      ).bind(orderId, session.userId).first();
    }
    const items = await env.DB.prepare(
      `SELECT oi.product_id AS productId, oi.qty, oi.price, p.name, p.image_url AS imageUrl
         FROM order_items oi JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ?1 ORDER BY oi.id`,
    ).bind(orderId).all();
    return withCookie(json({ order: { ...order, items: items.results || [] } }), session.setCookie);
  }

  return json({ error: '요청을 찾을 수 없습니다.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (error) {
        console.error(error);
        return json({ error: '서버 오류가 발생했습니다.' }, 500);
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Static asset binding is not configured.', { status: 500 });
  },
};
