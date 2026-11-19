import { periodEnd, periodOf } from './period.js?v=receipt-edit-20261119';

// Báo cáo đối soát một kỳ, hàm thuần (chạy được cả Node lẫn trình duyệt).
// orders: đơn đã chuẩn hóa {orderId, channel, period, businessDate, netRevenue, costOfGoods, payments[]},
// gồm cả các kỳ trước để tính phải thu tồn. lines: dòng đối soát đang hiệu lực.
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

export function buildReconcileReport({ period, orderSync, lines, pendingRevisionCount = 0, locked = false, openShift = false, beforeStart = false }) {
  const end = periodEnd(period);
  const orders = orderSync.orders;
  const byOrderId = new Map(orders.map((o) => [o.orderId, o]));
  const orderLines = lines.filter((l) => l.lineType === 'order');
  const totalLines = lines.filter((l) => l.lineType === 'period_total');
  const lineByOrder = new Map(orderLines.map((l) => [l.orderId, l]));

  const inPeriod = orders.filter((o) => o.period === period);
  const grabInPeriod = inPeriod.filter((o) => o.channel === 'grab');
  const aggregate = totalLines.filter((l) => l.period === period);
  const allocation = aggregate.length && !grabInPeriod.some((o) => lineByOrder.has(o.orderId)) ? 'unavailable' : 'per_order';

  const revenue = sum(inPeriod, (o) => o.netRevenue);
  const costOfGoods = sum(inPeriod, (o) => o.costOfGoods);
  const matched = grabInPeriod.filter((o) => lineByOrder.has(o.orderId)).map((o) => ({ order: o, line: lineByOrder.get(o.orderId) }));
  const platformFee = sum(matched, (m) => m.line.platformFee);
  const platformSupport = sum(matched, (m) => m.line.platformFundedSupport);
  const taxWithheld = sum(matched, (m) => m.line.taxWithheld);

  // Khi file chỉ có tổng: phần chênh giữa doanh thu Grab và tiền trả là khấu trừ chưa phân bổ.
  const aggregatePaid = sum(aggregate, (l) => l.amountPaid);
  const unallocatedDeductions = allocation === 'unavailable'
    ? sum(grabInPeriod, (o) => o.netRevenue) - aggregatePaid
    : 0;

  // Lãi đóng góp: không trừ khuyến mãi lần hai (đã trong netRevenue); thuế nộp thay không phải chi phí vận hành.
  const contribution = revenue + platformSupport - costOfGoods - platformFee - unallocatedDeductions;

  const resolution = [];
  for (const l of orderLines) {
    if (!byOrderId.has(l.orderId)) resolution.push({ type: 'unmatched_line', sourceLineId: l.sourceLineId, orderId: l.orderId, message: 'Dòng Grab không khớp đơn đã ghi' });
  }
  for (const { order, line } of matched) {
    const expected = order.netRevenue + line.platformFundedSupport - line.platformFee - line.taxWithheld;
    if (expected !== line.amountPaid) {
      resolution.push({ type: 'amount_mismatch', sourceLineId: line.sourceLineId, orderId: order.orderId, expected, actual: line.amountPaid, message: `Tiền trả ${line.amountPaid} khác kỳ vọng ${expected}` });
    }
  }
  const unsettled = allocation === 'per_order' ? grabInPeriod.filter((o) => !lineByOrder.has(o.orderId)) : [];
  for (const o of unsettled) resolution.push({ type: 'missing_settlement', orderId: o.orderId, message: 'Đơn Grab chưa có dòng quyết toán' });

  // Tiền nhận trong kỳ: theo ngày tiền về, không theo ngày bán.
  const received = (d) => d && periodOf(d) === period;
  const counterReceived = sum(orders.flatMap((o) => o.payments.filter((p) => p.method !== 'platform' && received(p.receivedDate))), (p) => p.amount);
  const payoutReceived = sum(lines.filter((l) => received(l.receivedDate)), (l) => l.amountPaid);

  // Grab phải thu cuối kỳ: số sàn sẽ trả cho đơn đã bán đến cuối kỳ, trừ phần đã về đến cuối kỳ.
  const arrivedBy = (d) => d && d <= end;
  let platformReceivable = 0;
  let receivableEstimated = false;
  for (const o of orders.filter((x) => x.channel === 'grab' && x.businessDate <= end)) {
    const line = lineByOrder.get(o.orderId);
    if (line) { if (!arrivedBy(line.receivedDate)) platformReceivable += line.amountPaid; }
  }
  for (const p of [...new Set(orders.filter((x) => x.channel === 'grab' && x.businessDate <= end).map((o) => o.period))]) {
    const agg = totalLines.filter((l) => l.period === p);
    const hasPerOrder = orders.some((o) => o.period === p && o.channel === 'grab' && lineByOrder.has(o.orderId));
    if (agg.length && !hasPerOrder) platformReceivable += sum(agg.filter((l) => !arrivedBy(l.receivedDate)), (l) => l.amountPaid);
    else if (!agg.length) {
      const missing = orders.filter((o) => o.period === p && o.channel === 'grab' && !lineByOrder.has(o.orderId));
      if (missing.length) { receivableEstimated = true; platformReceivable += sum(missing, (o) => o.netRevenue); }
    }
  }

  const blockers = [];
  if (orderSync.status !== 'ok') blockers.push(`Nguồn Order lỗi: ${orderSync.error}`);
  if (resolution.length) blockers.push(`${resolution.length} mục cần giải quyết`);
  if (pendingRevisionCount) blockers.push('Còn bản sửa file Grab chưa xác nhận');
  if (openShift) blockers.push('Còn ca tiền mặt chưa chốt');
  if (beforeStart) blockers.push('Kỳ trước ngày bắt đầu sổ, không chốt');
  const warnings = [];
  if (allocation === 'unavailable') warnings.push('File Grab chỉ có tổng: chưa phân bổ từng món, lãi theo món/kênh là ước tính');
  if (receivableEstimated) warnings.push('Phải thu Grab có phần ước tính từ đơn chưa quyết toán');

  return {
    period,
    locked,
    dataStatus: orderSync.status === 'ok' ? 'complete' : 'incomplete',
    lastSync: orderSync.syncedAt,
    orderSource: orderSync.source,
    revenue,
    costOfGoods,
    platformFee,
    platformSupport,
    taxWithheld,
    unallocatedDeductions,
    contribution,
    contributionEstimated: allocation === 'unavailable',
    itemAllocation: allocation,
    cashReceived: { counter: counterReceived, platformPayout: payoutReceived, total: counterReceived + payoutReceived },
    platformReceivable,
    receivableEstimated,
    resolution,
    blockers,
    warnings,
    closeable: blockers.length === 0,
  };
}
