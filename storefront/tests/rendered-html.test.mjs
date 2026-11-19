import assert from 'node:assert/strict';
import test from 'node:test';
const env = { ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const storefront = { available: true, shopName: 'THE KHE', pickupAddress: '138 đường 30/4, Phú Quốc', paymentReady: true, products: [{ id: 'live-product', name: 'Matcha Latte', category: 'Matcha', price: 35000, icon: '🍵', color: '#CFDBB1', imageUrl: '', description: 'Menu from the database', modifierGroup: 'Topping', appliesToCategories: [] }] };
// Vinext captures fetch at import time before installing its rendering wrapper.
const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (input, options) => {
  const url = typeof input === 'string' ? input : input.url || String(input);
  calls.push({ url, body: options?.body || (input instanceof Request ? await input.clone().text() : '') });
  return Response.json(storefront);
};
const { default: worker } = await import('../dist/server/index.js');
test('server renders live public catalog without starter or private business fields', async () => {
  const response = await worker.fetch(new Request('http://localhost/', { headers: { accept: 'text/html' } }), env, ctx);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(calls.some(c => c.url.endsWith('/rpc/get_public_storefront')));
  assert.deepEqual(JSON.parse(calls.find(c => c.url.endsWith('/rpc/get_public_storefront')).body), { p_shop_slug: 'the-khe' });
  assert.equal(html.includes('Matcha Latte'), true, 'SSR should contain the live product');
  assert.match(html, /35\.000/);
  assert.match(html, /lang="vi"/);
  assert.match(html, /Bán chạy/);
  assert.match(html, /khe-product-price/);
  assert.match(html, /Ước tính phí giao hàng/);
  assert.match(html, /138 đường 30\/4, phường Dương Đông, Phú Quốc/);
  assert.match(html, /Bãi Thơm/);
  assert.match(html, /150\.000–180\.000/);
  assert.match(html, /khe-highlight/);
  assert.doesNotMatch(html, /Tất cả/);
  assert.doesNotMatch(html, /minhthupq98-hub.github.io/);
  assert.match(html, /khe-member-button/);
  assert.match(html, /href="\/account">Hội nhà Khe<\/a>/);
  assert.match(html, /class="khe-footer-account" href="\/orders">Tài khoản &amp; lịch sử đơn<\/a>/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(html, /Starter Project|codex-preview|Giá vốn dự kiến/);
});
test('operations route points to the actual GitHub-hosted staff app', async () => {
  const response = await worker.fetch(new Request('http://localhost/operations'), env, ctx);
  assert.ok([302,303,307,308].includes(response.status));
  assert.equal(response.headers.get('location'), 'https://minhthupq98-hub.github.io/#/staff');
});
process.on('exit', () => { globalThis.fetch = originalFetch; });

test('account and order links resolve to native Matcha Pop routes without external redirects', async () => {
  for (const path of ['/account', '/orders']) {
    const response = await worker.fetch(new Request('http://localhost' + path, { headers: { accept: 'text/html' } }), env, ctx);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.match(html, /khe-highlight/);
    assert.match(html, /YOUR LITTLE KHE CLUB/);
    assert.doesNotMatch(html, /github\.io|Mở app đặt món/);
    assert.match(html, /Hội nhà Khe/);
  }
});
