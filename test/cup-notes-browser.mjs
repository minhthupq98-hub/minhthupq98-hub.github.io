import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.TEST_OUTPUT || resolve('test-results/cup-notes');
mkdirSync(output, { recursive: true });
const owner = '00000000-0000-4000-8000-000000000001';
const base = process.env.TEST_BASE || 'http://127.0.0.1:8107';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const report = [];
const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' })).toString('base64url')}.fixture`;
const user = { id: owner, email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {}, created_at: '2026-11-17T00:00:00Z' };
const product = (id, name, category, price) => ({ owner_id: owner, id, name, category, price, grab_price: price + 5000, cost: 7000, color: '#dce7a8', icon: '', active: true, created_at: '2026-11-17T00:00:00Z' });

try {
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 740], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    const requests = [];
    let products = [product('fixture-tea', 'Trà sữa đậm vị', 'Trà sữa', 25000), product('fixture-oolong', 'Ô long lài sữa', 'Trà sữa', 25000), product('fixture-coffee', 'Cà phê đen', 'Cà phê', 20000)];
    let orders = [];
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    console.log('viewport', width, height);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    // Everything outside the test server is fulfilled here. No real login or writes.
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === new URL(base).origin && !url.pathname.includes('the-khe-mascot')) return route.continue();
      if (url.pathname.includes('the-khe-mascot')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="12" fill="#dce7a8"/></svg>' });
      if (url.hostname.endsWith('.supabase.co')) {
        requests.push({ path: url.pathname, method: request.method() });
        const body = request.postDataJSON();
        const single = (value) => request.headers().accept?.includes('vnd.pgrst.object') ? value : [value];
        if (url.pathname.endsWith('/auth/v1/token')) return route.fulfill({ json: { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user } });
        if (url.pathname.endsWith('/auth/v1/user')) return route.fulfill({ json: user });
        if (url.pathname.endsWith('/app_settings')) return route.fulfill({ json: single({ owner_id: owner, shop_name: 'THE KHE', grab_fee_rate: 30, online_ordering_enabled: false, public_order_slug: 'the-khe' }) });
        if (url.pathname.endsWith('/products')) {
          if (request.method() === 'POST') { products.push(...body); return route.fulfill({ json: body }); }
          return route.fulfill({ json: products });
        }
        if (url.pathname.endsWith('/orders')) {
          if (request.method() === 'POST') {
            const order = { ...body, id: '00000000-0000-4000-8000-000000000002', order_number: 9001, created_at: new Date().toISOString() };
            orders.push(order);
            return route.fulfill({ json: single(order) });
          }
          if (request.method() === 'PATCH') {
            orders[0] = { ...orders[0], ...body };
            return route.fulfill({ json: single(orders[0]) });
          }
          return route.fulfill({ json: orders });
        }
        return route.fulfill({ json: [] });
      }
      return route.fulfill({ status: 200, body: '' });
    });
    // Isolated test profile. Avoid opening a real Supabase realtime socket.
    await page.addInitScript(() => {
      class FixtureWebSocket {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        constructor() { this.readyState = 0; this.listeners = {}; }
        addEventListener(type, listener) { this.listeners[type] = listener; }
        removeEventListener() {} send() {} close() { this.readyState = 3; }
      }
      window.WebSocket = FixtureWebSocket;
    });
    await page.goto(`${base}/#/staff`);
    await page.locator('input[type=email]').fill('fixture@example.test');
    await page.locator('input[type=password]').fill('fixture-password');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.getByRole('button', { name: /Trà sữa đậm vị/ }).first().waitFor();
    console.log('signed in with fixture', width);
    const tea = page.getByRole('button', { name: /Trà sữa đậm vị/ }).first();
    for (let i = 0; i < 4; i++) await tea.click();
    // The app collapses the cart on narrow screens.
    if (!(await page.locator('.tk-cup-card input').first().isVisible())) await page.locator('.mobile-cart-toggle').click();
    let cards = page.locator('.tk-cup-card');
    await cards.first().getByLabel(/Người nhận/).fill('Tầng 4');
    await cards.first().getByRole('button', { name: 'Tách từng ly', exact: true }).click();
    await assert.equal(await cards.count(), 4);
    await cards.nth(2).getByLabel('Topping', { exact: true }).selectOption('none');
    await cards.nth(3).getByLabel('Topping', { exact: true }).selectOption('none');
    await cards.nth(0).getByLabel('Ghi chú pha chế').fill('Dán tên trên nắp');
    await page.locator('.tk-editor-hint').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/order-${width}.png`, fullPage: false });
    console.log('edited cups', width);
    await page.getByRole('button', { name: /Tạo đơn/ }).last().click();
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Đã lưu'));
    assert.equal(orders.length, 1);
    assert.equal(orders[0].subtotal, 100000);
    assert.equal(orders[0].cost, 28000);
    assert.equal(orders[0].items.length, 4);
    assert.equal(orders[0].items.filter((item) => item.toppingMode === 'none').length, 2);
    assert.ok(orders[0].items.every((item) => item.recipientName === 'Tầng 4'));
    // Reload from the mocked DB to verify persisted JSON rather than only local state.
    await page.reload();
    await page.getByRole('button', { name: /Danh sách đơn|Đơn hàng/ }).first().click();
    await page.locator('.queue-main-button').first().click();
    const dialog = page.getByRole('dialog');
    assert.match(await dialog.textContent(), /Cho: Tầng 4/);
    assert.match(await dialog.textContent(), /Không topping/);
    await dialog.getByRole('button', { name: 'Phiếu pha chế', exact: true }).click();
    assert.equal(await dialog.locator('.tk-prep-total strong').textContent(), '4');
    assert.match(await dialog.locator('.tk-prep-paper').textContent(), /×2Không topping/);
    assert.equal(await dialog.locator('.tk-prep-paper').getByText(/100[.,]000/).count(), 0);
    await page.screenshot({ path: `${output}/prep-${width}.png`, fullPage: false });
    await dialog.getByRole('button', { name: 'Theo người nhận', exact: true }).click();
    assert.equal(await dialog.locator('.tk-recipient-line').count(), 4);
    await page.screenshot({ path: `${output}/recipient-${width}.png`, fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    if (width === 1440) {
      await dialog.getByRole('button', { name: 'Gom theo món', exact: true }).click();
      await page.emulateMedia({ media: 'print' });
      assert.equal(await dialog.locator('.tk-bill-modes').isVisible(), false);
      assert.equal(await dialog.locator('.bill-actions').isVisible(), false);
      await page.pdf({ path: `${output}/phieu-pha-che.pdf`, width: '80mm', printBackground: false });
      await page.emulateMedia({ media: 'screen' });
    }
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.locator('.queue-actions').first().getByRole('button', { name: /Sửa/ }).click();
    cards = page.locator('.tk-cup-card');
    assert.equal(await cards.count(), 4);
    assert.equal(await cards.nth(2).getByLabel('Topping', { exact: true }).inputValue(), 'none');
    await cards.nth(0).getByLabel(/Người nhận/).fill('Chị An');
    await cards.nth(0).getByLabel('Độ ngọt', { exact: true }).selectOption('Không đường');
    await page.getByRole('button', { name: /Lưu thay đổi/ }).last().click();
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Đã cập nhật'));
    assert.equal(orders.length, 1);
    assert.equal(orders[0].items[0].recipientName, 'Chị An');
    assert.equal(orders[0].items[0].lineNote, 'Dán tên trên nắp');
    assert.equal(orders[0].items[0].sweetness, 'Không đường');
    assert.equal(orders[0].items.filter((item) => item.toppingMode === 'none').length, 2);
    assert.equal(orders[0].subtotal, 100000);
    assert.equal(orders[0].cost, 28000);
    assert.deepEqual(errors, []);
    report.push({ width, height, persistedLines: orders[0].items.length, subtotal: orders[0].subtotal, errors, overflow, mockedRequests: requests.length });
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${output}/browser-results.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
