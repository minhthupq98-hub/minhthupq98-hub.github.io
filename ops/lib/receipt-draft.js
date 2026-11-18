// Một chứng từ, nhiều nhóm chi; tiền mua hàng tồn là dòng tiền, chưa là chi phí
// tính lãi. Hàm thuần dùng chung cho Nhập kho và tệp đính kèm trong trợ lý AI.
import { UNITS, PURCHASE_UNITS } from './inventory.js?v=receipts-20261118';
import { normKey, matchIngredient } from './import-draft.js?v=receipts-20261118';

export const RECEIPT_CATEGORIES = ['Nguyên liệu', 'Bao bì', 'Vật tư', 'Vệ sinh', 'Điện nước', 'Mặt bằng', 'Lương', 'Marketing', 'Vận hành', 'Khác'];
export const BUY_UNITS = [...new Set([...UNITS, 'kg', 'l'])];
const rounded = (n) => Math.round(n * 1000) / 1000;
const asPositive = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
const money = (v) => v != null && v !== '' && Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export const validReceiptDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;

export function inferReceiptCategory(name) {
  const text = normKey(name);
  if (/\b(ly|coc|nap|ong hut|hop giay|tui|bao bi|mang boc|muong nhua)\b/.test(text)) return 'Bao bì';
  if (/\b(nuoc rua|tay rua|ve sinh|lau san|nuoc giat|khan lau)\b/.test(text)) return 'Vệ sinh';
  if (/\b(tien dien|tien nuoc|dien nuoc)\b/.test(text)) return 'Điện nước';
  if (/\b(tien thue|mat bang)\b/.test(text)) return 'Mặt bằng';
  if (/\b(luong|tien cong)\b/.test(text)) return 'Lương';
  if (/\b(sua|tra|ca phe|duong|matcha|cacao|syrup|kem|thach|tran chau|dau|xoai|trung|bot)\b/.test(text)) return 'Nguyên liệu';
  return 'Khác';
}

export function receiptQuantity(line, ingredients = []) {
  if (line.kind !== 'stock') return null;
  const ing = ingredients.find((i) => (i.ingredient_id || i.id) === line.ingredientId);
  const base = ing?.unit || line.baseUnit;
  const quantity = asPositive(line.buyQty);
  if (!quantity || !UNITS.includes(base)) return null;
  const direct = PURCHASE_UNITS[base]?.[line.buyUnit];
  if (direct) return rounded(quantity * direct);
  const pack = asPositive(line.packSize);
  return pack ? rounded(quantity * pack) : null;
}

export function emptyReceiptLine() {
  return { name: '', kind: 'stock', category: 'Nguyên liệu', ingredientId: '', newName: '', baseUnit: 'g',
    buyQty: '', buyUnit: 'g', packSize: '', total: '', printed: '', flags: [] };
}

export function makeReceiptDraft(invoice, { ingredients = [], aliases = [], today, fileHash = null, hasInvoice = true } = {}) {
  const lines = (Array.isArray(invoice?.lines) ? invoice.lines : []).map((raw) => {
    const name = String(raw.name || '').trim();
    const match = matchIngredient(name, ingredients, aliases);
    const ing = ingredients.find((i) => (i.ingredient_id || i.id) === match?.id);
    const category = RECEIPT_CATEGORIES.includes(raw.category) ? raw.category : inferReceiptCategory(name);
    const kind = raw.kind === 'expense' ? 'expense' : raw.kind === 'stock' || ing || ['Nguyên liệu', 'Bao bì', 'Vật tư'].includes(category) ? 'stock' : 'expense';
    const baseUnit = ing?.unit || (UNITS.includes(raw.base_unit) ? raw.base_unit : kind === 'stock' ? 'cái' : '');
    const buyUnit = BUY_UNITS.includes(raw.unit) ? raw.unit : BUY_UNITS.includes(raw.base_unit) ? raw.base_unit : baseUnit;
    let buyQty = asPositive(raw.qty), packSize = '';
    const direct = PURCHASE_UNITS[baseUnit]?.[buyUnit];
    const baseQty = asPositive(raw.base_qty);
    // Không coi số bịch là số gram. Chỉ dùng lượng quy đổi nếu AI đọc đúng đơn vị
    // gốc; khác đơn vị đang có thì để chủ quán nhập quy cách, không tự đoán.
    if (!buyQty && baseQty && raw.base_unit === baseUnit) { buyQty = baseQty; }
    if (baseQty && raw.base_unit === baseUnit && buyQty && !direct) packSize = rounded(baseQty / buyQty);
    const flags = [];
    if (ing && raw.base_unit && raw.base_unit !== ing.unit) flags.push('Đơn vị AI đọc khác đơn vị kho, cần kiểm quy cách.');
    return { ...emptyReceiptLine(), name, kind, category, ingredientId: match?.id || '', newName: ing ? '' : name,
      baseUnit, buyQty: buyQty || '', buyUnit: !asPositive(raw.qty) && baseQty && raw.base_unit === baseUnit ? baseUnit : buyUnit,
      packSize, total: money(raw.amount) ?? '', printed: [raw.qty, raw.unit].filter((x) => x != null).join(' '), flags };
  });
  const subtotal = lines.reduce((s, l) => s + (money(l.total) || 0), 0);
  const total = money(invoice?.grand_total);
  // Thuế/phí/giảm giá chứng từ được phân bổ có tổng khớp tuyệt đối, không tự sửa
  // thành 0 khi tổng thiếu. Mọi giá trị vẫn hiện cho chủ quán soát.
  const extra = total == null ? 0 : total - subtotal;
  if (extra && subtotal > 0 && lines.every((l) => money(l.total) != null)) {
    let assigned = 0;
    lines.forEach((line, i) => {
      const value = i === lines.length - 1 ? total - assigned : Math.round(Number(line.total) / subtotal * total);
      assigned += value; line.total = value;
    });
  }
  return { supplier: String(invoice?.supplier || '').slice(0, 120), docNo: String(invoice?.doc_no || '').slice(0, 60),
    docDate: validReceiptDate(invoice?.doc_date) ? invoice.doc_date : today, fileHash, hasInvoice, grandTotal: total ?? subtotal,
    allocatedExtra: extra, paymentSource: '', paidDate: validReceiptDate(invoice?.doc_date) ? invoice.doc_date : today,
    autoTotal: !hasInvoice || total == null, lines };
}

export function receiptTotals(draft) {
  const byCategory = {};
  let total = 0, inventory = 0, expense = 0;
  for (const line of draft.lines) {
    const amount = money(line.total) || 0;
    total += amount;
    if (line.kind === 'stock') inventory += amount; else expense += amount;
    byCategory[line.category] = (byCategory[line.category] || 0) + amount;
  }
  return { total, inventory, expense, paid: draft.paymentSource === 'unpaid' ? 0 : draft.paymentSource ? total : null, byCategory };
}

export function receiptPayload(draft, ingredients, requestId) {
  const errors = [];
  if (!draft.lines.length) errors.push('Chưa có dòng hàng.');
  if (!validReceiptDate(draft.docDate)) errors.push('Chọn ngày hóa đơn hợp lệ.');
  if (!['outside', 'till', 'unpaid'].includes(draft.paymentSource)) errors.push('Chọn nguồn tiền hoặc Chưa thanh toán.');
  if (draft.paymentSource && draft.paymentSource !== 'unpaid' && !validReceiptDate(draft.paidDate || draft.docDate)) errors.push('Chọn ngày chi tiền hợp lệ.');
  const lines = draft.lines.map((line, i) => {
    const label = `Dòng ${i + 1}`;
    if (!line.name.trim()) errors.push(`${label}: nhập tên hàng/khoản chi.`);
    if (!RECEIPT_CATEGORIES.includes(line.category)) errors.push(`${label}: chọn nhóm chi.`);
    if (!['stock', 'expense'].includes(line.kind)) errors.push(`${label}: chọn cách ghi.`);
    const total = money(line.total);
    if (total == null || total > 2147483647) errors.push(`${label}: kiểm tra thành tiền.`);
    const qty = receiptQuantity(line, ingredients);
    const ing = ingredients.find((i) => (i.ingredient_id || i.id) === line.ingredientId);
    if (line.kind === 'stock') {
      if (!(qty > 0)) errors.push(`${label}: cần số lượng và quy cách theo đơn vị kho.`);
      if (!ing && (!line.newName.trim() || !UNITS.includes(line.baseUnit))) errors.push(`${label}: nhập tên và đơn vị hàng tồn mới.`);
      if (line.ingredientId && !ing) errors.push(`${label}: nguyên liệu không còn tồn tại.`);
    }
    return { name: line.name.trim(), kind: line.kind, category: line.category, total,
      ingredient_id: line.kind === 'stock' ? line.ingredientId || null : null,
      new_name: line.kind === 'stock' && !line.ingredientId ? line.newName.trim() : null,
      new_unit: line.kind === 'stock' ? ing?.unit || line.baseUnit : null,
      qty, buy_qty: asPositive(line.buyQty), buy_unit: line.buyUnit, pack_size: asPositive(line.packSize),
      alias: line.kind === 'stock' ? normKey(line.name).slice(0, 120) : null };
  });
  const sum = receiptTotals(draft).total;
  if (money(draft.grandTotal) == null || Number(draft.grandTotal) !== sum) errors.push('Tổng các dòng chưa khớp tổng hóa đơn.');
  if (sum > 2147483647) errors.push('Tổng tiền vượt giới hạn mỗi chứng từ.');
  return { errors, payload: errors.length ? null : { p_request_id: requestId,
    p_doc: { supplier: draft.supplier.trim(), doc_no: draft.docNo.trim(), doc_date: draft.docDate,
      has_invoice: !!draft.hasInvoice, file_hash: draft.fileHash, total: sum, payment_source: draft.paymentSource,
      paid_date: draft.paymentSource === 'unpaid' ? null : draft.paidDate || draft.docDate }, p_lines: lines } };
}
