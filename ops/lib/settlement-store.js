// Sổ đối soát Grab và chốt kỳ lưu trên Supabase (ticket 3).
// Đọc bảng ops_* qua RLS; GHI chỉ qua hàm RPC ops_* (kiểm chủ quán, idempotency,
// khóa kỳ, nhật ký nằm trong database, trình duyệt không vượt qua được).
import { parseGrabSettlementCsv } from './grab-csv.js?v=receipt-edit-20261119';
import { periodOf } from './period.js?v=receipt-edit-20261119';

export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Mã đơn trong file Grab được so với số đơn của app Order ("#178" hoặc "178").
export const orderRefKey = (ref) => (ref == null ? null : String(ref).trim().replace(/^#/, ''));

export const toRpcLine = (l) => ({
  source_line_id: l.sourceLineId,
  line_type: l.lineType,
  order_ref: l.orderId,
  period: l.period,
  payout_id: l.payoutId,
  received_date: l.receivedDate,
  platform_fee: l.platformFee,
  platform_funded_support: l.platformFundedSupport,
  tax_withheld: l.taxWithheld,
  amount_paid: l.amountPaid,
});

export const fromDbLine = (r) => ({
  sourceLineId: r.source_line_id,
  lineType: r.line_type,
  orderId: orderRefKey(r.order_ref),
  period: r.period,
  payoutId: r.payout_id,
  receivedDate: r.received_date,
  platformFee: r.platform_fee,
  platformFundedSupport: r.platform_funded_support,
  taxWithheld: r.tax_withheld,
  amountPaid: r.amount_paid,
});

// Đơn app Order (đã qua mapSupabaseOrder) -> dạng báo cáo đối soát.
// Chỉ đơn hoàn tất ghi nhận doanh thu. Đơn Grab: tiền về qua sàn nên không tính
// vào tiền tại quầy dù app ghi "Chuyển khoản". Ngày thu tạm lấy ngày tạo đơn.
export function ordersForReconcile(orders) {
  return orders
    .filter((o) => o.status === 'completed')
    .map((o) => ({
      orderId: orderRefKey(o.orderNumber ?? o.orderId),
      channel: o.channel,
      businessDate: o.businessDate,
      period: periodOf(o.businessDate),
      netRevenue: o.netRevenue,
      costOfGoods: o.costOfGoods,
      payments: o.channel === 'grab' || o.paymentStatus !== 'paid'
        ? []
        : [{ method: o.paymentMethod, amount: o.netRevenue, receivedDate: o.businessDate }],
    }));
}

// Xem trước một file trước khi ghi: parse, đếm, không gọi mạng.
export function previewGrabFile(text) {
  const parsed = parseGrabSettlementCsv(text);
  const total = parsed.lines.reduce((s, l) => s + l.amountPaid, 0);
  return { ...parsed, total, periods: [...new Set(parsed.lines.map((l) => l.period))].sort() };
}

export class SupabaseSettlementStore {
  constructor(client) {
    this.client = client;
  }

  async importFile({ fileName, text }) {
    const parsed = parseGrabSettlementCsv(text);
    if (parsed.fileError) return { status: 'file_error', error: parsed.fileError, rejected: [] };
    if (!parsed.lines.length) return { status: 'file_error', error: 'File không có dòng hợp lệ nào', rejected: parsed.rejected };
    const res = await this.client.rpc('ops_import_grab', {
      p_file_name: fileName,
      p_file_hash: await sha256Hex(text),
      p_lines: parsed.lines.map(toRpcLine),
      p_rejected: parsed.rejected.length,
    });
    return { ...res, rejected: parsed.rejected };
  }

  resolveRevisions(batchId, apply) {
    return this.client.rpc('ops_resolve_revisions', { p_batch_id: batchId, p_apply: apply });
  }

  lockPeriod(period, report) {
    return this.client.rpc('ops_lock_period', { p_period: period, p_snapshot: report });
  }

  reopenPeriod(period, reason) {
    return this.client.rpc('ops_reopen_period', { p_period: period, p_reason: reason });
  }

  async load() {
    const [lines, pending, closes, batches, audit] = await Promise.all([
      this.client.select('ops_settlement_lines', 'select=*&order=period.asc,source_line_id.asc'),
      this.client.select('ops_pending_revisions', 'select=batch_id,source_line_id,changes,created_at&order=created_at.asc'),
      this.client.select('ops_period_closes', 'select=*'),
      this.client.select('ops_import_batches', 'select=id,file_name,periods,added,duplicates,revisions,rejected,status,created_at&order=created_at.desc&limit=20'),
      this.client.select('ops_audit_log', 'select=action,detail,created_at&order=created_at.desc&limit=20'),
    ]);
    return { lines: lines.map(fromDbLine), pending, closes, batches, audit };
  }
}
