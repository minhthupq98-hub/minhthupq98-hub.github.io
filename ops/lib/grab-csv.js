import { toVnd } from './money.js?v=receipts-20261118';
import { isDate, isPeriod } from './period.js?v=receipts-20261118';

// Cột CSV là mẫu test nội bộ, KHÔNG phải định dạng xuất thật của Grab.
export const GRAB_COLUMNS = [
  'line_type', 'source_line_id', 'order_id', 'period', 'payout_id', 'received_date',
  'platform_fee', 'platform_funded_support', 'tax_withheld', 'amount_paid',
];
const MONEY = {
  platform_fee: 'platformFee',
  platform_funded_support: 'platformFundedSupport',
  tax_withheld: 'taxWithheld',
  amount_paid: 'amountPaid',
};

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

// Trả về dòng hợp lệ và dòng bị loại kèm lý do; không bỏ dòng nào trong im lặng.
export function parseGrabSettlementCsv(text) {
  const [header, ...body] = parseCsv(text);
  const cols = (header ?? []).map((h) => h.trim().toLowerCase());
  const missing = GRAB_COLUMNS.filter((c) => !cols.includes(c));
  if (missing.length) return { lines: [], rejected: [], fileError: `Thiếu cột: ${missing.join(', ')}` };

  const lines = [];
  const rejected = [];
  body.forEach((cells, idx) => {
    const rowNo = idx + 2;
    const r = Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? '').trim()]));
    const errors = [];
    const type = r.line_type;
    if (type !== 'order' && type !== 'period_total') errors.push(`line_type "${type}" không hợp lệ`);
    if (!r.source_line_id) errors.push('thiếu source_line_id');
    if (type === 'order' && !r.order_id) errors.push('dòng đơn thiếu order_id');
    if (!isPeriod(r.period)) errors.push(`period "${r.period}" không hợp lệ`);
    if (!r.payout_id) errors.push('thiếu payout_id');
    if (r.received_date && !isDate(r.received_date)) errors.push(`received_date "${r.received_date}" không hợp lệ`);
    const money = {};
    for (const [col, key] of Object.entries(MONEY)) {
      const res = toVnd(r[col] === '' && col !== 'amount_paid' ? '0' : r[col], col);
      if (res.ok) money[key] = res.value; else errors.push(res.error);
    }
    if (errors.length) { rejected.push({ row: rowNo, sourceLineId: r.source_line_id || null, errors }); return; }
    lines.push({
      lineType: type,
      sourceLineId: r.source_line_id,
      orderId: type === 'order' ? r.order_id : null,
      period: r.period,
      payoutId: r.payout_id,
      receivedDate: r.received_date || null,
      ...money,
    });
  });
  return { lines, rejected, fileError: null };
}
