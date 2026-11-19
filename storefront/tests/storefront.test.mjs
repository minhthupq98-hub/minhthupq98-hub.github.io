import assert from 'node:assert/strict';
import test from 'node:test';
import { ICE_OPTIONS, SWEETNESS_OPTIONS, modifierSection, applicableExtras, linePrice, orderItems, parseStorefront, reconcileCart } from '../lib/storefront.ts';
const main = { id: 'matcha', name: 'Matcha Latte', category: 'Matcha', price: 35000, color: '#CFDBB1', icon: '🍵', description: '', imageUrl: '', modifierGroup: 'Topping', appliesToCategories: [] };
const milk = { ...main, id: 'oatside', name: 'OATSIDE', category: 'Extra đồ uống', price: 5000, modifierGroup: 'Đổi sữa', appliesToCategories: ['Matcha'] };
const otherMilk = { ...milk, id: 'other-milk' };
const foodExtra = { ...milk, id: 'food', category: 'Topping đồ ăn', appliesToCategories: ['Mì'] };
const line = { key: 'line-1', product: main, extras: [milk], qty: 2, sugar: '50% ngọt', ice: 'Ít đá', note: 'No straw' };
test('public catalog strips private financial and banking fields', () => {
  const parsed = parseStorefront({ available: true, shopName: 'THE KHE', products: [{ ...main, cost: 9000, owner_id: 'private' }], bankAccount: 'not-needed-in-menu', paymentReady: true });
  assert.equal(parsed.products[0].price, 35000);
  assert.equal('cost' in parsed.products[0], false);
  assert.equal('owner_id' in parsed.products[0], false);
  assert.equal('bankAccount' in parsed, false);
});
test('closed shop exposes no products and never falls back to sample menu', () => {
  assert.deepEqual(parseStorefront({ available: false, products: [main] }).products, []);
});
test('rejects malformed prices', () => {
  assert.throws(() => parseStorefront({ available: true, products: [{ ...main, price: -1 }] }));
  assert.throws(() => parseStorefront({ available: true, products: [{ ...main, price: '35000' }] }));
});
test('modifiers are limited to applicable product categories', () => {
  assert.deepEqual(applicableExtras(main, [main, milk, foodExtra]).map(p => p.id), ['oatside']);
});
test('line totals include extras for every unit', () => { assert.equal(linePrice(line) * line.qty, 80000); });
test('reconciles stale product and modifier prices with active live menu', () => {
  const result = reconcileCart([line], [{ ...main, price: 39000 }, { ...milk, price: 7000 }]);
  assert.equal(result.changed, true);
  assert.equal(linePrice(result.lines[0]) * 2, 92000);
});
test('removes inactive mains, ineligible extras and duplicate exclusive modifiers', () => {
  const result = reconcileCart([{ ...line, extras: [milk, otherMilk, foodExtra] }, { ...line, product: { ...main, id: 'inactive' } }], [main, milk, otherMilk, foodExtra]);
  assert.equal(result.changed, true);
  assert.equal(result.lines.length, 1);
  assert.deepEqual(result.lines[0].extras.map(p => p.id), ['oatside']);
});
test('RPC order payload sends IDs and choices, never client prices or revenue', () => {
  assert.deepEqual(orderItems([line]), [{ product_id: 'matcha', qty: 2, ice: 'Ít đá', sweetness: '50% ngọt', note: 'No straw', extras: ['oatside'] }]);
});

test('groups existing Upsize items under size and keeps only one size per line', () => {
  const small = { ...milk, id: 'upsize-one', name: 'Upsize 700ml', modifierGroup: 'Topping' };
  const large = { ...small, id: 'upsize-two', price: 10000 };
  assert.equal(modifierSection(small), 'Kích cỡ');
  const result = reconcileCart([{ ...line, extras: [milk, small, large] }], [main, milk, small, large]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.lines[0].extras.map(p => p.id), ['oatside', 'upsize-one']);
});
test('keeps new sweetness and ice choices in restored carts and database payloads', () => {
  for (const sugar of SWEETNESS_OPTIONS) for (const ice of ICE_OPTIONS) {
    const result = reconcileCart([{ ...line, sugar, ice }], [main, milk]);
    assert.equal(result.lines[0].sugar, sugar);
    assert.equal(result.lines[0].ice, ice);
    assert.equal(orderItems(result.lines)[0].sweetness, sugar);
    assert.equal(orderItems(result.lines)[0].ice, ice);
  }
});
