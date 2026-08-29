const app = document.querySelector('#app');
const cartCount = document.querySelector('#cart-count');
const toast = document.querySelector('#toast');
const categories = ['전체', '잡화', '뷰티', '신발', '식품'];
const filePreview = location.protocol === 'file:';
const previewAssetBase = filePreview ? new URL('./', location.href).href : './';
const previewProducts = [
  { id: 1, name: '미니멀 토트백', price: 89000, category: '잡화', description: '각을 살린 검정 가죽 토트백', imageUrl: `${previewAssetBase}products/bag.jpg` },
  { id: 2, name: '클래식 손목시계', price: 145000, category: '잡화', description: '흰 문자판에 검정 가죽 밴드', imageUrl: `${previewAssetBase}products/watch.jpg` },
  { id: 3, name: '시트러스 오드뚜왈렛', price: 78000, category: '뷰티', description: '상쾌한 시트러스 계열 향수', imageUrl: `${previewAssetBase}products/perfume.jpg` },
  { id: 4, name: '매트 레드 립스틱', price: 32000, category: '뷰티', description: '발색이 선명한 매트 타입', imageUrl: `${previewAssetBase}products/lipstick.jpg` },
  { id: 5, name: '러닝화 블루', price: 112000, category: '신발', description: '쿠션이 두꺼운 남성 러닝화', imageUrl: `${previewAssetBase}products/shoe.jpg` },
  { id: 6, name: '러닝화 핑크', price: 112000, category: '신발', description: '같은 모델의 여성 러닝화', imageUrl: `${previewAssetBase}products/shoe2.jpg` },
  { id: 7, name: '레드와인 피노타지', price: 42000, category: '식품', description: '남아프리카산 드라이 레드와인', imageUrl: `${previewAssetBase}products/wine.jpg` },
  { id: 8, name: '이탈리아 파스타 면', price: 6500, category: '식품', description: '세몰리나 100% 숏 파스타 450g', imageUrl: `${previewAssetBase}products/pasta.jpg` },
];
const previewCart = [];
const previewOrders = new Map();
let activePaymentWidgets = [];

const money = (value) => `${Number(value).toLocaleString('ko-KR')}원`;
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

async function request(path, options = {}) {
  if (filePreview) return previewRequest(path, options);
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '요청에 실패했습니다.');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function previewRequest(path, options = {}) {
  const [pathname, queryString = ''] = path.split('?');
  const parts = pathname.replace(/^\//, '').split('/');
  if (parts[0] === 'session') return { ok: true };
  if (parts[0] === 'products' && !parts[1]) {
    const category = new URLSearchParams(queryString).get('category');
    return { products: category ? previewProducts.filter((product) => product.category === category) : previewProducts, categories: categories.slice(1) };
  }
  if (parts[0] === 'products' && parts[1]) {
    const product = previewProducts.find((item) => item.id === Number(parts[1]));
    if (!product) throw new Error('상품을 찾을 수 없습니다.');
    return { product };
  }
  if (parts[0] === 'cart' && parts.length === 1 && (!options.method || options.method === 'GET')) {
    const items = previewCart.map((entry) => ({ ...entry.product, productId: entry.product.id, qty: entry.qty, subtotal: entry.qty * entry.product.price }));
    return { items, total: items.reduce((sum, item) => sum + item.subtotal, 0) };
  }
  if (parts[0] === 'cart' && parts.length === 1 && options.method === 'POST') {
    const data = JSON.parse(options.body || '{}');
    const product = previewProducts.find((item) => item.id === Number(data.productId));
    if (!product || !Number.isInteger(data.qty) || data.qty < 1 || data.qty > 99) throw new Error('상품과 수량을 확인해 주세요.');
    const existing = previewCart.find((item) => item.product.id === product.id);
    if (existing) existing.qty = Math.min(99, existing.qty + data.qty); else previewCart.push({ product, qty: data.qty });
    return previewRequest('/cart');
  }
  if (parts[0] === 'cart' && parts.length === 2 && options.method === 'DELETE') {
    const index = previewCart.findIndex((item) => item.product.id === Number(parts[1]));
    if (index >= 0) previewCart.splice(index, 1);
    return previewRequest('/cart');
  }
  if (parts[0] === 'cart' && parts.length === 2 && options.method === 'PATCH') {
    const entry = previewCart.find((item) => item.product.id === Number(parts[1]));
    const data = JSON.parse(options.body || '{}');
    if (!entry || !Number.isInteger(data.qty) || data.qty < 1 || data.qty > 99) throw new Error('수량은 1~99 사이여야 합니다.');
    entry.qty = data.qty;
    return previewRequest('/cart');
  }
  if (parts[0] === 'orders' && options.method === 'POST') {
    if (!previewCart.length) throw new Error('장바구니가 비어 있습니다.');
    const items = previewCart.map((entry) => ({ ...entry.product, productId: entry.product.id, qty: entry.qty, price: entry.product.price }));
    const total = items.reduce((sum, item) => sum + item.qty * item.price, 0);
    previewCart.splice(0);
    const order = { id: 1, total, status: 'pending', items };
    previewOrders.set(order.id, order);
    return { order };
  }
  if (parts[0] === 'orders' && parts[1]) {
    const order = previewOrders.get(Number(parts[1]));
    if (!order) throw new Error('주문을 찾을 수 없습니다.');
    return { order };
  }
  throw new Error('파일 미리보기에서 지원하지 않는 요청입니다.');
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function destroyPaymentWidgets() {
  activePaymentWidgets.forEach((widget) => {
    try { widget?.destroy?.(); } catch { /* The route can continue even if the SDK already removed its iframe. */ }
  });
  activePaymentWidgets = [];
}

function shell(title, content, className = '') {
  destroyPaymentWidgets();
  app.innerHTML = `<section class="page ${className}"><div class="page-heading"><h1>${title}</h1></div>${content}</section>`;
}

async function updateCartCount() {
  try {
    const data = await request('/cart');
    const count = data.items.reduce((sum, item) => sum + item.qty, 0);
    cartCount.textContent = count;
    cartCount.hidden = count === 0;
  } catch {
    cartCount.hidden = true;
  }
}

function productCard(product) {
  return `<article class="product-card">
    <a href="/product/${product.id}" aria-label="${escapeHtml(product.name)} 상세 보기">
      <img src="${product.imageUrl}" alt="${escapeHtml(product.name)}" />
      <h2>${escapeHtml(product.name)}</h2>
      <p class="price">${money(product.price)}</p>
      <p class="category">${escapeHtml(product.category)}</p>
    </a>
  </article>`;
}

async function renderHome() {
  const selected = new URLSearchParams(location.search).get('category') || '전체';
  const query = selected === '전체' ? '' : `?category=${encodeURIComponent(selected)}`;
  const data = await request(`/products${query}`);
  shell('상품', `<div class="catalog-layout">
    <aside class="category-rail"><h2>분류</h2><nav class="category-list" aria-label="상품 분류">
      ${categories.map((category) => `<a href="/${category === '전체' ? '' : `?category=${encodeURIComponent(category)}`}" ${selected === category ? 'aria-current="page"' : ''}>${category}</a>`).join('')}
    </nav></aside>
    <div class="product-grid">${data.products.length ? data.products.map(productCard).join('') : '<p class="empty">상품이 없습니다.</p>'}</div>
  </div>`);
}

async function renderDetail(id) {
  const { product } = await request(`/products/${id}`);
  shell('상품 상세', `<div class="detail-layout">
    <img class="detail-image" src="${product.imageUrl}" alt="${escapeHtml(product.name)}" />
    <div class="detail-info">
      <p class="category">${escapeHtml(product.category)}</p>
      <h1>${escapeHtml(product.name)}</h1>
      <p class="price">${money(product.price)}</p>
      <p class="description">${escapeHtml(product.description)}</p>
      <div class="quantity-row"><span>수량</span><div class="quantity-control"><button type="button" data-detail-qty="-1" aria-label="수량 줄이기">−</button><output id="detail-qty">1</output><button type="button" data-detail-qty="1" aria-label="수량 늘리기">＋</button></div></div>
      <button class="primary-button" type="button" id="add-to-cart">장바구니 담기</button>
    </div>
  </div>`);
  let qty = 1;
  const output = document.querySelector('#detail-qty');
  document.querySelectorAll('[data-detail-qty]').forEach((button) => button.addEventListener('click', () => {
    qty = Math.max(1, Math.min(99, qty + Number(button.dataset.detailQty)));
    output.value = qty;
    output.textContent = qty;
  }));
  document.querySelector('#add-to-cart').addEventListener('click', async () => {
    try {
      const productId = Number(product.id);
      if (!Number.isInteger(productId) || productId < 1) throw new Error('상품을 찾을 수 없습니다.');
      await request('/cart', { method: 'POST', body: JSON.stringify({ productId, qty }) });
      await updateCartCount();
      notify('장바구니에 담았습니다.');
    } catch (error) { notify(error.message); }
  });
}

function cartRow(item) {
  const productId = Number(item.productId ?? item.id);
  return `<article class="cart-row" data-product-id="${productId}">
    <img src="${item.imageUrl}" alt="${escapeHtml(item.name)}" />
    <div class="cart-row-content"><div class="cart-row-top"><h2>${escapeHtml(item.name)}</h2><button class="delete-button" data-delete="${productId}" type="button">삭제</button></div>
      <p class="price">${money(item.price)}</p><p class="subtotal">수량 ${item.qty}개 · 소계 ${money(item.subtotal)}</p>
      <div class="quantity-control"><button type="button" data-cart-qty="-1" data-product-id="${productId}" aria-label="수량 줄이기">−</button><output>${item.qty}</output><button type="button" data-cart-qty="1" data-product-id="${productId}" aria-label="수량 늘리기">＋</button></div>
    </div>
  </article>`;
}

async function renderCart() {
  const data = await request('/cart');
  const rows = data.items.length ? data.items.map(cartRow).join('') : '<div class="cart-empty">장바구니가 비어 있습니다.</div>';
  shell('장바구니', `<div class="cart-layout"><div class="cart-list">${rows}</div><aside class="summary-card"><h2>주문 예상 금액</h2><p class="summary-line"><span>총 상품 가격</span><strong>${money(data.total)}</strong></p><p class="summary-total"><span>합계</span><span>${money(data.total)}</span></p><button class="${data.items.length ? 'primary-button' : 'secondary-button'}" id="order-button" type="button" ${data.items.length ? '' : 'disabled'}>주문하기</button></aside></div>`, 'cart-page');
  document.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async () => {
    try { await request(`/cart/${button.dataset.delete}`, { method: 'DELETE' }); await renderCart(); await updateCartCount(); } catch (error) { notify(error.message); }
  }));
  document.querySelectorAll('[data-cart-qty]').forEach((button) => button.addEventListener('click', async () => {
    const row = button.closest('[data-product-id]');
    const current = Number(row.querySelector('output').textContent);
    const qty = Math.max(1, Math.min(99, current + Number(button.dataset.cartQty)));
    try { await request(`/cart/${button.dataset.productId}`, { method: 'PATCH', body: JSON.stringify({ qty }) }); await renderCart(); await updateCartCount(); } catch (error) { notify(error.message); }
  }));
  document.querySelector('#order-button')?.addEventListener('click', async () => {
    try {
      const result = await request('/orders', { method: 'POST' });
      if (filePreview) { history.pushState({}, '', `./pay/${result.order.id}`); await render(); }
      else location.assign(`/pay/${result.order.id}`);
    } catch (error) { notify(error.message); }
  });
}

async function renderOrder(id) {
  const { order } = await request(`/orders/${id}`);
  shell(order.status === 'paid' ? '결제 완료' : '주문 완료', `<div class="order-card"><section class="order-items"><h2>주문한 상품</h2>${order.items.map((item) => `<article class="order-item"><img src="${item.imageUrl}" alt="${escapeHtml(item.name)}" /><div><p>${escapeHtml(item.name)}</p><p class="muted">수량 ${item.qty}개 · ${money(item.price)}</p></div></article>`).join('')}</section><aside class="order-summary"><h2>주문 정보</h2><dl><dt>주문 번호</dt><dd>#${order.id}</dd><dt>주문 금액</dt><dd>${money(order.total)}</dd></dl></aside></div>`);
}

async function renderPayment(id) {
  const { order } = await request(`/orders/${id}`);
  if (order.status === 'paid') {
    history.replaceState({}, '', `/order/${order.id}`);
    await renderOrder(order.id);
    return;
  }
  if (!order.tossOrderId) throw new Error('결제 주문 번호를 불러오지 못했습니다.');
  shell('결제하기', `<div class="payment-layout"><section class="payment-card"><h2>결제 수단</h2><div id="payment-method"></div><div id="agreement"></div><p class="muted">테스트 결제입니다. 실제로 금액이 청구되지 않습니다.</p><button class="primary-button" id="payment-button" type="button" disabled>결제하기</button></section><aside class="summary-card"><h2>주문 금액</h2><p class="summary-total"><span>합계</span><span>${money(order.total)}</span></p></aside></div>`, 'payment-page');
  const button = document.querySelector('#payment-button');
  try {
    const config = await request('/config');
    if (!window.TossPayments || !config.tossClientKey || !config.customerKey) throw new Error('결제 테스트 설정을 불러오지 못했습니다.');
    const widgets = window.TossPayments(config.tossClientKey).widgets({ customerKey: config.customerKey });
    await widgets.setAmount({ currency: 'KRW', value: order.total });
    const paymentMethodWidget = await widgets.renderPaymentMethods({ selector: '#payment-method' });
    if (paymentMethodWidget) activePaymentWidgets.push(paymentMethodWidget);
    const agreementWidget = await widgets.renderAgreement({ selector: '#agreement' });
    if (agreementWidget) activePaymentWidgets.push(agreementWidget);
    button.disabled = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await widgets.requestPayment({
          orderId: order.tossOrderId,
          orderName: order.items.length > 1 ? `${order.items[0].name} 외 ${order.items.length - 1}건` : order.items[0].name,
          successUrl: `${location.origin}/pay/success`,
          failUrl: `${location.origin}/pay/fail?internalOrderId=${encodeURIComponent(order.id)}`,
        });
      } catch (error) {
        button.disabled = false;
        notify(error.message || '결제를 시작하지 못했습니다.');
      }
    });
  } catch (error) { button.disabled = true; notify(error.message); }
}

async function renderPaymentResult(success) {
  const params = new URLSearchParams(location.search);
  if (!success) {
    const internalOrderId = Number(params.get('internalOrderId'));
    const canRetry = Number.isInteger(internalOrderId) && internalOrderId > 0;
    const message = params.get('message') || '결제가 취소되었거나 실패했습니다.';
    const retryLink = canRetry
      ? `<a class="outline-button login-link" href="/pay/${internalOrderId}">다시 결제하기</a>`
      : '<a class="outline-button login-link" href="/mypage">주문 내역 보기</a>';
    shell('결제 실패', `<div class="empty"><p>${escapeHtml(message)}</p>${retryLink}</div>`);
    return;
  }

  const orderId = params.get('orderId');
  const paymentKey = params.get('paymentKey');
  const amount = Number(params.get('amount'));
  try {
    const result = await request('/payments/confirm', { method: 'POST', body: JSON.stringify({ orderId, amount, paymentKey }) });
    history.replaceState({}, '', `/order/${result.orderId}`);
    await renderOrder(result.orderId);
    notify(result.pending ? '입금 확인을 기다리고 있습니다.' : '결제가 완료되었습니다.');
  } catch (error) {
    const retryUrl = `${location.pathname}${location.search}`;
    shell('결제 승인 실패', `<div class="empty"><p>${escapeHtml(error.message)}</p><a class="outline-button login-link" href="${escapeHtml(retryUrl)}">승인 다시 시도</a></div>`);
  }
}

async function renderMypage() {
  const session = await request('/session');
  if (!session.user) {
    shell('마이페이지', `<div class="auth-layout"><section class="account-card"><h2>로그인</h2><form id="login-form" class="auth-form"><label>이메일<input name="email" type="email" autocomplete="email" required></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label><button class="primary-button" type="submit">로그인</button></form></section><section class="account-card"><h2>회원가입</h2><form id="register-form" class="auth-form"><label>이름<input name="name" autocomplete="name" required></label><label>이메일<input name="email" type="email" autocomplete="email" required></label><label>비밀번호<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><p class="muted">비밀번호는 8자 이상 입력해 주세요.</p><button class="outline-button" type="submit">회원가입</button></form></section></div>`);
  } else {
    const data = await request('/orders');
    shell('마이페이지', `<div class="account-card"><h2>${escapeHtml(session.user.name)}님</h2><p class="muted">${escapeHtml(session.user.email)}</p><button class="outline-button account-action" id="logout-button" type="button">로그아웃</button></div><section class="orders-card"><h2>주문 내역</h2>${data.orders.length ? data.orders.map((order) => `<a class="order-history-row" href="/order/${order.id}"><span>#${order.id}</span><span>${money(order.total)}</span><span>${order.status === 'paid' ? '결제 완료' : '결제 대기'}</span></a>`).join('') : '<p class="muted">주문 내역이 없습니다.</p>'}</section>`);
  }
  document.querySelector('#login-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await request('/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) }); await renderMypage(); } catch (error) { notify(error.message); } });
  document.querySelector('#register-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const credentials = { email: form.get('email'), password: form.get('password') }; try { await request('/register', { method: 'POST', body: JSON.stringify({ name: form.get('name'), ...credentials }) }); await request('/login', { method: 'POST', body: JSON.stringify(credentials) }); await renderMypage(); notify('회원가입이 완료되었습니다.'); } catch (error) { notify(error.message); } });
  document.querySelector('#logout-button')?.addEventListener('click', async () => { await request('/logout', { method: 'POST' }); location.assign('/'); });
}

async function render() {
  const publicMarker = '/public/';
  const path = filePreview
    ? `/${location.pathname.includes(publicMarker) ? location.pathname.split(publicMarker)[1] : ''}`.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/'
    : location.pathname;
  try {
    await request('/session');
    if (path === '/' || path === '') await renderHome();
    else if (path === '/cart') await renderCart();
    else if (path.startsWith('/pay/success')) await renderPaymentResult(true);
    else if (path.startsWith('/pay/fail')) await renderPaymentResult(false);
    else if (path.startsWith('/pay/')) await renderPayment(path.split('/')[2]);
    else if (path === '/mypage') await renderMypage();
    else if (path.startsWith('/product/')) await renderDetail(path.split('/')[2]);
    else if (path.startsWith('/order/')) await renderOrder(path.split('/')[2]);
    else { if (!filePreview) history.replaceState({}, '', '/'); await renderHome(); }
    await updateCartCount();
  } catch (error) {
    if (error.status === 401) shell('로그인이 필요합니다', '<div class="empty"><p>장바구니와 주문은 로그인 후 사용할 수 있습니다.</p><a class="primary-button login-link" href="/mypage">로그인·회원가입</a></div>');
    else shell('오류', `<div class="empty">${escapeHtml(error.message)}</div>`);
  }
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link || (!filePreview && link.origin !== location.origin) || link.target === '_blank') return;
  event.preventDefault();
  history.pushState({}, '', link.pathname + link.search);
  render();
});
window.addEventListener('popstate', render);
render().then(() => {
  if (filePreview) notify('파일 미리보기입니다. 실제 주문은 Wrangler Worker에서 실행하세요.');
});
