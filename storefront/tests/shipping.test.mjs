import assert from 'node:assert/strict';
import test from 'node:test';
import { SHIPPING_ORIGIN, SHIPPING_ZONES, suggestedZones, shippingZone, feeLabel, deliveryBudget, shippingOrderNote } from '../lib/shipping.ts';
const get = id => SHIPPING_ZONES.find(zone => zone.id === id);
test('transcribes all 31 tariff areas and uses the exact pickup address', () => {
  assert.equal(SHIPPING_ZONES.length, 31);
  assert.equal(new Set(SHIPPING_ZONES.map(zone => zone.id)).size, 31);
  assert.equal(SHIPPING_ORIGIN, '138 đường 30/4, phường Dương Đông, Phú Quốc');
  for (const zone of SHIPPING_ZONES) assert.ok(Number.isInteger(zone.min) && zone.min > 0 && zone.max >= zone.min);
});
test('matches the supplied fixed fees including the central town and distant areas', () => {
  const expected = { 'duong-dong': 10000, cmt8: 15000, '67ha': 20000, 'bung-goi': 30000, grandworld: 100000, 'ganh-dau': 130000, holiday: 15000, 'cau-ba-keo': 20000, 'cau-ba-phong': 25000, 'cho-duong-bao': 50000, 'san-bay': 55000, 'bai-truong': 70000, 'dia-trung-hai': 120000, 'ben-tram': 20000, 'vong-xoay-moi': 50000, 'rach-vem': 110000, 'cong-chao-suoi-da': 20000, 'nga-3-so-10': 45000, 'ham-ninh': 70000, 'suoi-lon': 80000, 'chua-ho-quoc': 110000, 'bon-con-cho': 120000, 'an-thoi': 130000 };
  for (const [id, price] of Object.entries(expected)) assert.deepEqual([get(id).min, get(id).max], [price, price], id);
});
test('keeps every ranged fee intact instead of silently charging the minimum', () => {
  const expected = { 'ong-lang': [40000,45000], 'cua-can': [60000,80000], 'suoi-may': [30000,35000], 'cay-thong-ngoai': [25000,40000], 'cay-thong-trong': [35000,40000], 'suoi-da-ban': [30000,45000], k8: [35000,40000], 'bai-thom': [150000,180000] };
  for (const [id, prices] of Object.entries(expected)) assert.deepEqual([get(id).min, get(id).max], prices, id);
  assert.equal(feeLabel(get('ong-lang')), '40.000–45.000 ₫');
});
test('adds shipping ranges to the item subtotal without changing payment totals', () => {
  assert.deepEqual(deliveryBudget(70000,get('ong-lang')), { min:110000,max:115000 });
  assert.deepEqual(deliveryBudget(70000,get('duong-dong')), { min:80000,max:80000 });
  assert.equal(deliveryBudget(70000,null), null);
  assert.throws(() => deliveryBudget(-1,get('ong-lang')));
});
test('suggests accent-insensitive complete place names without confusing CMT8 and K8', () => {
  assert.equal(shippingZone('Khach san tai ONG LANG, Phu Quoc','').id, 'ong-lang');
  assert.equal(shippingZone('10 CMT8, Duong Dong','').id, 'cmt8');
  assert.equal(shippingZone('Khu K8, Phu Quoc','').id, 'k8');
  assert.equal(shippingZone('K80, Phu Quoc',''), null);
});
test('does not assume a broad ward name or ambiguous address has a single tariff', () => {
  assert.equal(shippingZone('Phường Dương Đông, Phú Quốc',''), null);
  assert.equal(shippingZone('Địa Trung Hải, An Thới',''), null);
  assert.equal(suggestedZones('Địa Trung Hải, An Thới').length,2);
  assert.equal(shippingZone('Địa Trung Hải, An Thới','dia-trung-hai').min,120000);
  assert.equal(shippingZone('Ông Lang','unknown'),null);
  assert.equal(shippingZone('Ông Lang','invalid'),null);
});
test('records the quote, origin and separate courier payment in the existing order note', () => {
  const note = shippingOrderNote('Gọi trước khi giao','delivery',get('bai-thom'));
  assert.match(note,/150\.000–180\.000 ₫/);
  assert.ok(note.includes(SHIPPING_ORIGIN));
  assert.match(note,/Ship trả riêng tài xế, không cộng vào QR/);
  assert.match(note,/Gọi trước khi giao/);
  assert.equal(shippingOrderNote(' Không lấy ống hút ','pickup',get('bai-thom')),'Không lấy ống hút');
  assert.match(shippingOrderNote('','delivery',null),/quán xác nhận phí trước khi giao/);
});
