import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../deployment/github-pages-index.html', import.meta.url), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
function run(hash, search = '', readyState = 'complete') {
  const redirects = [], appended = [], listeners = {};
  const location = { hash, search, replace: value => redirects.push(value) };
  const document = { readyState, addEventListener: (event, callback) => { listeners['dom:' + event] = callback; }, createElement: tag => ({ tag }), head: { appendChild: node => appended.push(node) } };
  const window = { location, addEventListener: (event, callback) => { listeners[event] = callback; } };
  runInNewContext(script, { window, document, URLSearchParams });
  return { redirects, appended, listeners, location };
}
test('old GitHub homepage and customer bookmarks open the new storefront without loading old assets', () => {
  for (const hash of ['', '#/order', '#/order/the-khe', '#account']) {
    const result = run(hash);
    assert.deepEqual(result.redirects, ['https://the-khe-order.minhthupq98.chatgpt.site/']);
    assert.equal(result.appended.length, 0);
  }
});
test('staff entry still boots existing management assets on the same origin', () => {
  for (const hash of ['#/staff', '#/admin']) {
    const result = run(hash);
    assert.equal(result.redirects.length, 0);
    assert.equal(result.appended.length, 2);
    assert.equal(result.appended[0].rel, 'stylesheet');
    assert.equal(result.appended[1].type, 'module');
    assert.match(result.appended[1].src, /^\/assets\/index-[\w-]+\.js$/);
  }
});
test('staff auth callbacks stay on their original origin and never forward credentials', () => {
  for (const [hash, search] of [['#access_token=dummy&refresh_token=dummy', ''], ['', '?code=dummy']]) {
    const result = run(hash, search);
    assert.equal(result.redirects.length, 0);
    assert.equal(result.appended.length, 2);
  }
});
test('a staff browser navigating to a customer share link is switched to the new storefront', () => {
  const result = run('#/staff');
  result.location.hash = '#/order/the-khe';
  result.listeners.hashchange();
  assert.deepEqual(result.redirects, ['https://the-khe-order.minhthupq98.chatgpt.site/']);
});

test('staff bundle waits for the DOM root before mounting', () => {
  const result = run('#/staff', '', 'loading');
  assert.equal(result.appended.length, 0);
  result.listeners['dom:DOMContentLoaded']();
  assert.equal(result.appended.length, 2);
});
