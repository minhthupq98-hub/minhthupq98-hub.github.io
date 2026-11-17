import test from 'node:test';
import assert from 'node:assert/strict';
import { addProduct, normalizeLines, updateLine, changeQuantity, splitLine,
  preparationDetails, itemSummary, buildPrepGroups, groupByRecipient,
  totalQuantity, cupRange } from '../assets/order-cups-v1.js';

const tea = { id: 'tea', name: 'Trà sữa đậm vị', category: 'Trà sữa', price: 25000, grabPrice: 32000, cost: 7000, qty: 4 };
const value = (items, key) => items.reduce((sum, item) => sum + item[key] * item.qty, 0);

test('split 4 cups then customize two: conserve product IDs, sales and COGS', () => {
  const original = normalizeLines([{ ...tea, recipientName: 'Tầng 4' }]);
  const lines = splitLine(original, original[0].lineKey, true);
  assert.equal(lines.length, 4);
  assert.equal(new Set(lines.map((item) => item.lineKey)).size, 4);
  assert.ok(lines.every((item) => item.id === 'tea' && item.recipientName === 'Tầng 4'));
  for (const field of ['price', 'grabPrice', 'cost']) assert.equal(value(lines, field), value(original, field));
  let edited = updateLine(lines, lines[0].lineKey, { toppingMode: 'none' });
  edited = updateLine(edited, lines[1].lineKey, { toppingMode: 'none' });
  const [group] = buildPrepGroups(edited);
  assert.equal(group.qty, 4);
  assert.deepEqual(group.variants.map((variant) => [variant.qty, variant.details]), [[2, ['Không topping']], [2, []]]);
});

test('partial split permits 2 regular and 2 no topping without four separate edits', () => {
  const original = normalizeLines([tea]);
  let lines = splitLine(original, original[0].lineKey);
  lines = splitLine(lines, lines[0].lineKey);
  assert.deepEqual(lines.map((item) => item.qty), [2, 1, 1]);
  assert.equal(totalQuantity(lines), 4);
  assert.equal(value(lines, 'price'), 100000);
});

test('quantity buttons affect only the selected line of the same product', () => {
  const lines = normalizeLines([{ ...tea, qty: 1 }, { ...tea, qty: 2, toppingMode: 'none' }]);
  const changed = changeQuantity(lines, lines[1].lineKey, -1);
  assert.deepEqual(changed.map((item) => item.qty), [1, 1]);
  assert.deepEqual(changeQuantity(changed, changed[1].lineKey, -1), [changed[0]]);
});

test('adding menu product never merges into a named or customized cup', () => {
  let lines = normalizeLines([{ ...tea, recipientName: 'Chị A', qty: 1 }, { ...tea, lineNote: 'Ít ngọt', qty: 1 }]);
  lines = addProduct(lines, tea);
  assert.deepEqual(lines.map((item) => item.qty), [1, 1, 1]);
  lines = addProduct(lines, tea);
  assert.deepEqual(lines.map((item) => item.qty), [1, 1, 2]);
});

test('edit and JSON save/reload preserve existing online modifiers and notes', () => {
  const original = [{ ...tea, qty: 2, ice: 'Ít đá', sweetness: '50% ngọt', extras: ['Kem cheese'], lineNote: 'Để riêng kem', note: 'Giao cổng sau' }];
  let lines = normalizeLines(JSON.parse(JSON.stringify(original)));
  lines = updateLine(lines, lines[0].lineKey, { recipientName: 'Tầng 4', id: 'wrong', price: 0 });
  const saved = JSON.parse(JSON.stringify(lines));
  assert.equal(saved[0].id, 'tea');
  assert.equal(saved[0].price, 25000);
  assert.equal(itemSummary(saved[0]), 'Cho: Tầng 4 · Ít đá · 50% ngọt · Kem cheese · Để riêng kem · Giao cổng sau');
});

test('old orders, mixed extras and unassigned recipients render with no migration', () => {
  const lines = [{ ...tea, qty: 2, extras: [{ name: 'Kem cheese' }, 'Trân châu'], note: 'Không kem' }];
  assert.equal(groupByRecipient(lines)[0].name, 'Chưa ghi người nhận');
  assert.deepEqual(preparationDetails(lines[0]), ['Kem cheese', 'Trân châu', 'Không kem']);
  assert.deepEqual(buildPrepGroups(lines)[0].variants[0].lines[0].count, 2);
});

test('cup numbers remain the same between preparation and recipient views', () => {
  const lines = [
    { ...tea, recipientName: 'Tầng 4', qty: 2 },
    { ...tea, recipientName: 'Tầng 4', qty: 2, toppingMode: 'none' },
    { ...tea, id: 'coffee', name: 'Cà phê đen', recipientName: 'Chị A', qty: 1, sweetness: 'Không đường' },
  ];
  const byDish = buildPrepGroups(lines).flatMap((group) => group.variants.flatMap((variant) => variant.lines)).map(cupRange);
  const byPerson = groupByRecipient(lines).flatMap((group) => group.lines).map(cupRange);
  assert.deepEqual(byDish, ['01-02', '03-04', '05']);
  assert.deepEqual(byPerson, byDish);
  assert.equal(totalQuantity(lines), 5);
});

test('duplicate legacy line keys are repaired without losing customization', () => {
  const lines = normalizeLines([{ ...tea, lineKey: 'same' }, { ...tea, lineKey: 'same', lineNote: 'Không topping' }]);
  assert.equal(new Set(lines.map((item) => item.lineKey)).size, 2);
  assert.equal(lines[1].lineNote, 'Không topping');
});

test('long Vietnamese names and literal markup remain text throughout summaries', () => {
  const item = { ...tea, recipientName: '<script>Chị Ánh</script>', lineNote: '<img onerror=alert(1)>', toppingMode: 'separate' };
  assert.equal(itemSummary(item), 'Cho: <script>Chị Ánh</script> · Topping để riêng · <img onerror=alert(1)>');
  assert.deepEqual(buildPrepGroups([item])[0].variants[0].details, ['Topping để riêng', '<img onerror=alert(1)>']);
});
