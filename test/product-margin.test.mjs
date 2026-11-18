import assert from 'node:assert/strict';
import test from 'node:test';
import { grossMarginPercent, formatGrossMargin } from '../assets/product-margin-v1.js';

test('gross margin is a share of selling price rather than cost markup', () => {
  assert.equal(grossMarginPercent(25000, 10000), 60);
  assert.equal(formatGrossMargin(25000, 10000), '60%');
  assert.equal(formatGrossMargin(30000, 10000), '66,7%');
});

test('losses, break-even and explicit zero cost retain their meaning', () => {
  assert.equal(formatGrossMargin(10000, 15000), '-50%');
  assert.equal(formatGrossMargin(10000, 10000), '0%');
  assert.equal(formatGrossMargin(10000, 10001), '0%');
  assert.equal(formatGrossMargin(25000, 0), '100%');
});

test('missing or invalid prices never produce a misleading percentage', () => {
  for (const [price, cost] of [[0, 7000], [-1, 7000], [null, 7000], [25000, null],
    ['', 7000], [25000, ''], [NaN, 7000], [25000, Infinity], [25000, -100]]) {
    assert.equal(grossMarginPercent(price, cost), null);
    assert.equal(formatGrossMargin(price, cost), '-');
  }
});
