// Màn chủ quán (P0): doanh thu ghi nhận, tiền về, lãi, đơn lệch và độ đầy đủ dữ liệu.
// Hàm thuần: nhận đơn đã chuẩn hóa (mapSupabaseOrder), chi phí, cấu hình; không gọi mạng.

const DAY = 86400e3;
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

// Khoảng ngày [from, to) theo ngày quán; toIso dùng cho truy vấn created_at.
export function monthRange(period) {
  const [y, m] = period.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${period}-01`, to: `${next}-01` };
}
export function previousRange({ from, to }) {
  const len = daysBetween(from, to);
  // Kỳ là tháng tròn thì so với tháng liền trước, còn lại lùi đúng số ngày.
  if (from.endsWith('-01') && to.endsWith('-01') && len >= 28 && len <= 31) {
    const [y, m] = from.split('-').map(Number);
    return monthRange(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
  }
  return { from: addDays(from, -len), to: from };
}
export const rangeToIso = ({ from, to }) => ({ from: `${from}T00:00:00+07:00`, to: `${to}T00:00:00+07:00` });

// Ngày hôm nay của quán (Asia/Ho_Chi_Minh), không lấy ngày UTC.
export const shopDate = (iso) => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().slice(0, 10);

const inRange = (date, r) => date >= r.from && date < r.to;
const pct = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);
// Tỷ trọng theo doanh thu, không phải tỷ lệ tăng trên giá vốn. Không có mẫu số
// thì không biến thành 0% hay Infinity (đặc biệt với món tặng và kỳ chưa bán).
export const ratioPercent = (amount, base) => Number.isFinite(amount) && Number.isFinite(base) && base > 0
  ? Math.round(amount / base * 1000) / 10 : null;

function summarize(orders, grabFeeRate) {
  const done = orders.filter((o) => o.status === 'completed');
  const grab = done.filter((o) => o.channel === 'grab');
  const revenue = sum(done, (o) => o.netRevenue);
  const cost = sum(done, (o) => o.costOfGoods);
  const grabRevenue = sum(grab, (o) => o.netRevenue);
  const grabFeeEstimate = Math.round((grabRevenue * grabFeeRate) / 100);
  const paidInStore = done.filter((o) => o.channel !== 'grab' && o.paymentStatus === 'paid');
  return {
    orders: done.length,
    revenue,
    discounts: sum(done, (o) => Object.values(o.discounts).reduce((s, v) => s + v, 0)),
    cost,
    grossProfit: revenue - cost,
    grabRevenue,
    grabFeeEstimate,
    contribution: revenue - cost - grabFeeEstimate,
    cashIn: {
      cash: sum(paidInStore.filter((o) => o.paymentMethod === 'cash'), (o) => o.netRevenue),
      transfer: sum(paidInStore.filter((o) => o.paymentMethod === 'transfer'), (o) => o.netRevenue),
    },
    grabReceivableEstimate: grabRevenue - grabFeeEstimate,
    avgTicket: done.length ? Math.round(revenue / done.length) : 0,
  };
}

function groupBy(xs, key) {
  const m = new Map();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// Đơn cần xử lý: mỗi mục có mã đơn để mở xuống bản ghi.
export function findIssues(orders, { now }) {
  const nowMs = Date.parse(now);
  const issues = [];
  const add = (o, kind, label) => issues.push({ kind, label, orderId: o.orderId, orderNumber: o.orderNumber, businessDate: o.businessDate, channel: o.channelLabel, amount: o.netRevenue });
  for (const o of orders) {
    for (const p of o.problems) add(o, 'data', `Dữ liệu lệch: ${p}`);
    if (o.status === 'completed' && o.paymentStatus === 'unpaid') add(o, 'unpaid', 'Đã hoàn tất nhưng chưa ghi nhận thu tiền');
    if (o.status === 'processing' && nowMs - Date.parse(o.createdAt) > DAY) add(o, 'stale', 'Đang làm quá 24 giờ, cần chốt hoặc hủy');
    if (o.status === 'cancelled' && o.paymentStatus === 'paid') add(o, 'refund', 'Đã hủy nhưng đang ghi đã thu, kiểm hoàn tiền');
    if (o.status === 'completed' && o.costOfGoods === 0 && o.netRevenue > 0) add(o, 'no_cost', 'Thiếu giá vốn, lãi đơn này bị tính cao');
  }
  const order = { data: 0, refund: 1, unpaid: 2, stale: 3, no_cost: 4 };
  return issues.sort((a, b) => order[a.kind] - order[b.kind] || b.businessDate.localeCompare(a.businessDate));
}

// Kỳ đang chạy so với cùng số ngày đầu kỳ trước, để không so nửa tháng với cả tháng.
export function comparisonRange(range, today) {
  const prev = previousRange(range);
  if (range.to <= today) return { ...prev, partial: false };
  const elapsed = Math.max(1, daysBetween(range.from, today) + 1);
  return { from: prev.from, to: addDays(prev.from, Math.min(elapsed, daysBetween(prev.from, prev.to))), partial: true };
}

export function buildOwnerDashboard({ orders, expenses = [], range, now, syncedAt, grabFeeRate = 0, sourceStatus = 'ok', sourceError = null }) {
  const today = shopDate(now);
  const prev = comparisonRange(range, today);
  const cur = orders.filter((o) => inRange(o.businessDate, range));
  const before = orders.filter((o) => inRange(o.businessDate, prev));
  const k = summarize(cur, grabFeeRate);
  const p = summarize(before, grabFeeRate);
  const exp = expenses.filter((e) => inRange(e.expense_date, range));
  const expPrev = expenses.filter((e) => inRange(e.expense_date, prev));
  const expenseTotal = sum(exp, (e) => e.amount);

  const done = cur.filter((o) => o.status === 'completed');
  const channels = [...groupBy(done, (o) => o.channelLabel)].map(([label, os]) => {
    const revenue = sum(os, (o) => o.netRevenue);
    const cost = sum(os, (o) => o.costOfGoods);
    const feeEstimate = Math.round(sum(os.filter((o) => o.channel === 'grab'), (o) => o.netRevenue) * grabFeeRate / 100);
    return { label, orders: os.length, revenue, cost, feeEstimate,
      contribution: revenue - cost - feeEstimate,
      marginPct: ratioPercent(revenue - cost - feeEstimate, revenue) };
  }).sort((a, b) => b.revenue - a.revenue);

  const days = [];
  for (let d = range.from; d < range.to && d <= today; d = addDays(d, 1)) {
    const os = done.filter((o) => o.businessDate === d);
    days.push({ date: d, orders: os.length, revenue: sum(os, (o) => o.netRevenue) });
  }

  const itemMap = new Map();
  for (const o of done) for (const it of o.items) {
    const key = it.id || it.name;
    const cur0 = itemMap.get(key) ?? { name: it.name, category: it.category, qty: 0, listRevenue: 0, cost: 0, missingCost: false };
    cur0.qty += it.qty;
    cur0.listRevenue += it.qty * it.unitPrice;
    cur0.cost += it.qty * it.unitCost;
    if (it.qty > 0 && it.unitCost <= 0) cur0.missingCost = true;
    itemMap.set(key, cur0);
  }
  const items = [...itemMap.values()].map((i) => ({ ...i, margin: i.listRevenue - i.cost,
    marginPct: i.missingCost ? null : ratioPercent(i.listRevenue - i.cost, i.listRevenue),
    costPct: i.missingCost ? null : ratioPercent(i.cost, i.listRevenue),
    profitPerItem: i.qty > 0 ? Math.round((i.listRevenue - i.cost) / i.qty) : null,
  }))
    .sort((a, b) => b.margin - a.margin);

  const expenseByCategory = [...groupBy(exp, (e) => e.category)].map(([category, es]) => ({ category, amount: sum(es, (e) => e.amount), count: es.length }))
    .sort((a, b) => b.amount - a.amount);

  const warnings = [];
  if (sourceStatus !== 'ok') warnings.push(`Nguồn đơn lỗi (${sourceError}). Số dưới đây CHƯA ĐỦ để chốt.`);
  if (!exp.length) warnings.push('Kỳ này chưa có khoản chi nào được nhập, lãi ròng chưa phản ánh chi phí cố định.');
  if (k.grabRevenue) warnings.push(`Phí Grab là ước tính theo tỉ lệ ${grabFeeRate}% trong cài đặt, chưa có file đối soát Grab cho kỳ này.`);
  const noCost = done.filter((o) => o.costOfGoods === 0 && o.netRevenue > 0).length;
  if (noCost) warnings.push(`${noCost} đơn chưa có giá vốn, lãi đang bị tính cao.`);
  if (range.to > today) warnings.push('Kỳ đang chạy, số còn thay đổi.');

  const metrics = (s, expense) => ({
    grossMarginPct: ratioPercent(s.grossProfit, s.revenue),
    netMarginPct: ratioPercent(s.contribution - expense, s.revenue),
    foodCostPct: ratioPercent(s.cost, s.revenue),
    expensePct: ratioPercent(expense, s.revenue),
    discountPct: ratioPercent(s.discounts, s.revenue + s.discounts),
  });
  const cancelled = cur.filter((o) => o.status === 'cancelled').length;
  const noItemCost = items.filter((i) => i.missingCost).length;
  if (noItemCost) warnings.push(`${noItemCost} món đã bán còn dòng thiếu giá vốn; chưa tính biên % của các món đó.`);
  return {
    range,
    previousRange: prev,
    generatedAt: now,
    syncedAt,
    sourceStatus,
    lastOrderAt: cur.reduce((m, o) => (o.updatedAt > m ? o.updatedAt : m), ''),
    kpi: { ...k, expenses: expenseTotal, netProfit: k.contribution - expenseTotal, ...metrics(k, expenseTotal),
      cancelledOrders: cancelled, totalOrders: cur.length, cancelPct: ratioPercent(cancelled, cur.length),
      unpaidAmount: sum(done.filter((o) => o.paymentStatus === 'unpaid' && o.channel !== 'grab'), (o) => o.netRevenue),
      itemsSold: sum(items, (i) => i.qty),
    },
    previous: { ...p, expenses: sum(expPrev, (e) => e.amount), netProfit: p.contribution - sum(expPrev, (e) => e.amount), ...metrics(p, sum(expPrev, (e) => e.amount)) },
    change: {
      revenue: pct(k.revenue, p.revenue),
      orders: pct(k.orders, p.orders),
      grossProfit: pct(k.grossProfit, p.grossProfit),
      avgTicket: pct(k.avgTicket, p.avgTicket),
    },
    channels,
    days,
    items,
    expenseByCategory,
    issues: findIssues(cur, { now }),
    warnings,
    estimated: k.grabRevenue > 0 || noCost > 0,
    complete: sourceStatus === 'ok' && exp.length > 0,
  };
}

// Xếp hạng theo kỳ đã lọc. Không xếp lãi ảo của món thiếu giá vốn lên đầu.
export function rankMenuItems(items, metric = 'margin', limit = 10) {
  const key = { qty: 'qty', revenue: 'listRevenue', margin: 'margin', marginPct: 'marginPct' }[metric] || 'margin';
  const eligible = items.filter((i) => !['margin', 'marginPct'].includes(key) || !i.missingCost && Number.isFinite(i[key]));
  return [...eligible].sort((a, b) => b[key] - a[key] || b.listRevenue - a.listRevenue || a.name.localeCompare(b.name, 'vi'))
    .slice(0, limit).map((i, index) => ({ ...i, rank: index + 1 }));
}
