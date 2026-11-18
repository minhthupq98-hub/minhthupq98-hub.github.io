// Ca và tiền mặt tại két (ticket 4). Đọc bảng ops_* qua RLS, ghi qua RPC ops_*.
// Số chốt ca chính thức do database tính; hàm shiftPreview chỉ để hiện số tạm trong ca.

export const MOVE_KIND = { expense: 'Chi phí', withdraw: 'Rút tiền', deposit: 'Nộp thêm', purchase: 'Chi hóa đơn mua hàng' };

// Cùng điều kiện với ops_close_shift: đơn hoàn tất, đã thu, tiền mặt, không phải Grab, tạo trong ca.
export function isShiftCashSale(o, openedAt, until = null) {
  const t = Date.parse(o.createdAt);
  return o.status === 'completed' && o.paymentStatus === 'paid' && o.paymentMethod === 'cash' && o.channel !== 'grab'
    && t >= Date.parse(openedAt) && (until == null || t < Date.parse(until));
}

export function shiftPreview({ shift, orders, moves }) {
  const sales = orders.filter((o) => isShiftCashSale(o, shift.opened_at));
  const cashSales = sales.reduce((s, o) => s + o.netRevenue, 0);
  const cashIn = moves.filter((m) => m.kind === 'deposit').reduce((s, m) => s + m.amount, 0);
  const cashOut = moves.filter((m) => m.kind !== 'deposit').reduce((s, m) => s + m.amount, 0);
  const unpaid = orders.filter((o) => o.status !== 'cancelled' && o.paymentStatus !== 'paid' && Date.parse(o.createdAt) >= Date.parse(shift.opened_at));
  return {
    openingCash: shift.opening_cash,
    cashSales,
    cashSalesCount: sales.length,
    cashIn,
    cashOut,
    expectedCash: shift.opening_cash + cashSales + cashIn - cashOut,
    unpaidCount: unpaid.length,
  };
}

// Bỏ dữ liệu trước ngày bắt đầu sổ khi đối soát và chốt kỳ.
export function applyStartDate({ orders, lines }, startDate) {
  if (!startDate) return { orders, lines };
  const startPeriod = startDate.slice(0, 7);
  return {
    orders: orders.filter((o) => o.businessDate >= startDate),
    lines: lines.filter((l) => l.period >= startPeriod),
  };
}

// Số nguyên VND từ ô nhập (cho phép dấu chấm/phẩy/khoảng trắng ngăn nghìn).
export function parseVndInput(text) {
  const s = String(text ?? '').replace(/[.,\s]/g, '').replace(/đ$/i, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

export class SupabaseShiftStore {
  constructor(client) {
    this.client = client;
  }

  async load() {
    const [settings, shifts] = await Promise.all([
      this.client.select('ops_settings', 'select=ledger_start_date&limit=1'),
      this.client.select('ops_shifts', 'select=*&order=opened_at.desc&limit=15'),
    ]);
    const open = shifts.find((s) => s.status === 'open') ?? null;
    const moves = open
      ? await this.client.select('ops_cash_moves', `select=id,kind,amount,category,note,created_at&shift_id=eq.${encodeURIComponent(open.id)}&order=created_at.asc`)
      : [];
    return { startDate: settings[0]?.ledger_start_date ?? null, open, moves, recent: shifts.filter((s) => s.status === 'closed') };
  }

  setStartDate(date) {
    return this.client.rpc('ops_set_start_date', { p_date: date });
  }

  openShift(openingCash, note = '') {
    return this.client.rpc('ops_open_shift', { p_opening_cash: openingCash, p_note: note });
  }

  addMove(shiftId, { kind, amount, note, category = 'Khác' }) {
    return this.client.rpc('ops_add_cash_move', { p_shift_id: shiftId, p_kind: kind, p_amount: amount, p_note: note, p_category: category });
  }

  closeShift(shiftId, countedCash, note = '') {
    return this.client.rpc('ops_close_shift', { p_shift_id: shiftId, p_counted_cash: countedCash, p_note: note });
  }
}
