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
  const email = `guest_${sid}@local.invalid`;
  let user = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (!user) {
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO users (email, password_hash, name) VALUES (?1, '!guest-session!', 'Guest')",
    ).bind(email).run();
    user = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
    if (!user) user = { id: result.meta.last_row_id };
  }
  return { userId: user.id, setCookie };
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

async function cartRows(env, userId) {
  const result = await env.DB.prepare(
    `SELECT c.product_id AS productId, c.qty, p.name, p.price, p.description, p.category, p.image_url AS imageUrl,
            (c.qty * p.price) AS subtotal
       FROM cart_items c JOIN products p ON p.id = c.product_id
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
    return withCookie(json({ ok: true }), session.setCookie);
  }

  if (request.method === 'GET' && parts[0] === 'products' && !parts[1]) {
    const category = url.searchParams.get('category');
    if (category && !CATEGORIES.includes(category)) return json({ error: '잘못된 분류입니다.' }, 400);
    const query = category
      ? 'SELECT id, name, price, description, category, image_url AS imageUrl FROM products WHERE category = ?1 ORDER BY id'
      : 'SELECT id, name, price, description, category, image_url AS imageUrl FROM products ORDER BY id';
    const result = category ? await env.DB.prepare(query).bind(category).all() : await env.DB.prepare(query).all();
    return withCookie(json({ products: result.results || [], categories: CATEGORIES }), session.setCookie);
  }

  if (request.method === 'GET' && parts[0] === 'products' && parts[1]) {
    const id = validProductId(parts[1]);
    if (!id) return json({ error: '잘못된 상품 번호입니다.' }, 400);
    const product = await env.DB.prepare(
      'SELECT id, name, price, description, category, image_url AS imageUrl FROM products WHERE id = ?1',
    ).bind(id).first();
    return product ? withCookie(json({ product }), session.setCookie) : json({ error: '상품을 찾을 수 없습니다.' }, 404);
  }

  if (parts[0] === 'cart' && parts.length === 1 && request.method === 'GET') {
    return withCookie(json(await cartRows(env, session.userId)), session.setCookie);
  }

  if (parts[0] === 'cart' && parts.length === 1 && request.method === 'POST') {
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
    const cart = await cartRows(env, session.userId);
    if (!cart.items.length) return json({ error: '장바구니가 비어 있습니다.' }, 400);
    const orderResult = await env.DB.prepare(
      "INSERT INTO orders (user_id, total, status) VALUES (?1, ?2, 'pending')",
    ).bind(session.userId, cart.total).run();
    const orderId = orderResult.meta.last_row_id;
    const statements = cart.items.map((item) => env.DB.prepare(
      'INSERT INTO order_items (order_id, product_id, qty, price) VALUES (?1, ?2, ?3, ?4)',
    ).bind(orderId, item.productId, item.qty, item.price));
    statements.push(env.DB.prepare('DELETE FROM cart_items WHERE user_id = ?1').bind(session.userId));
    await env.DB.batch(statements);
    return withCookie(json({ order: { id: orderId, total: cart.total, status: 'pending', items: cart.items } }, 201), session.setCookie);
  }

  if (parts[0] === 'orders' && parts.length === 2 && request.method === 'GET') {
    const orderId = validProductId(parts[1]);
    if (!orderId) return json({ error: '잘못된 주문 번호입니다.' }, 400);
    const order = await env.DB.prepare(
      'SELECT id, total, status, created_at AS createdAt FROM orders WHERE id = ?1 AND user_id = ?2',
    ).bind(orderId, session.userId).first();
    if (!order) return json({ error: '주문을 찾을 수 없습니다.' }, 404);
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
