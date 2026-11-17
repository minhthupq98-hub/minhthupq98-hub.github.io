// Adapter CHỈ ĐỌC cho app Order THE KHE trên Supabase (PostgREST + Auth).
// Dùng publishable key và phiên đăng nhập của chủ quán: RLS "owners manage ..."
// tự giới hạn đúng dữ liệu của chủ, adapter không cần và không giữ khóa bí mật.
// Đọc bằng GET. Ghi duy nhất qua rpc() tới các hàm ops_* của sổ đối soát (ticket 3);
// không ghi thẳng bảng nào của app Order.

export class SupabaseSourceError extends Error {}

const CHANNELS = { 'Tại quán': 'dine_in', 'Mang đi': 'takeaway', Grab: 'grab' };
const METHODS = { 'Tiền mặt': 'cash', 'Chuyển khoản': 'transfer' };

// Ngày nghiệp vụ theo Asia/Ho_Chi_Minh (UTC+7, không đổi giờ mùa hè).
export function businessDateOf(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new SupabaseSourceError(`Thời điểm "${iso}" không hợp lệ`);
  return new Date(t + 7 * 3600e3).toISOString().slice(0, 10);
}

const int = (v) => (Number.isSafeInteger(v) ? v : Number.NaN);

// Chuẩn hóa một dòng bảng orders. Không ném lỗi vì dữ liệu lệch: trả kèm
// danh sách problems để màn chủ quán đưa vào mục "đơn lệch" thay vì làm sai số.
export function mapSupabaseOrder(row) {
  if (!row?.id) throw new SupabaseSourceError('Dòng orders thiếu id');
  const problems = [];
  const discounts = {
    manual: int(row.discount ?? 0),
    points: int(row.points_discount ?? 0),
    voucher: int(row.voucher_discount ?? 0),
    tier: int(row.tier_discount ?? 0),
  };
  const subtotal = int(row.subtotal);
  const revenue = int(row.revenue);
  const cost = int(row.cost);
  for (const [k, v] of Object.entries({ subtotal, revenue, cost, ...discounts })) {
    if (Number.isNaN(v) || v < 0) problems.push(`${k} không phải số nguyên VND không âm`);
  }
  const discountTotal = Object.values(discounts).reduce((s, v) => s + v, 0);
  if (!problems.length && subtotal - discountTotal !== revenue) {
    problems.push(`doanh thu ${revenue} khác tạm tính ${subtotal} trừ giảm ${discountTotal}`);
  }
  const channel = CHANNELS[row.channel] ?? 'other';
  if (channel === 'other') problems.push(`kênh lạ "${row.channel}"`);
  const items = Array.isArray(row.items) ? row.items : [];
  return {
    sourceKey: `the_khe_order:${row.id}`,
    orderId: row.id,
    orderNumber: row.order_number ?? null,
    channel,
    channelLabel: row.channel,
    orderSource: row.order_source || 'staff',
    status: row.status, // completed | processing | cancelled
    paymentStatus: row.payment_status, // paid | unpaid
    paymentMethod: METHODS[row.payment_method] ?? 'other',
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    businessDate: businessDateOf(row.created_at),
    subtotal,
    discounts,
    netRevenue: revenue,
    costOfGoods: cost,
    items: items.map((it) => ({
      id: String(it.id ?? ''),
      name: String(it.name ?? 'Không tên'),
      category: String(it.category ?? ''),
      qty: Number(it.qty) || 0,
      unitPrice: channel === 'grab' && Number(it.grabPrice) > 0 ? Number(it.grabPrice) : Number(it.price) || 0,
      unitCost: Number(it.cost) || 0,
    })),
    problems,
  };
}

export const ORDER_COLUMNS = [
  'id', 'order_number', 'created_at', 'updated_at', 'channel', 'items', 'subtotal', 'discount',
  'points_discount', 'voucher_discount', 'tier_discount', 'revenue', 'cost', 'status',
  'payment_method', 'payment_status', 'order_source',
].join(',');

export class SupabaseClient {
  constructor({ url, key, fetchImpl = (...a) => globalThis.fetch(...a) }) {
    if (!url || !key) throw new SupabaseSourceError('Thiếu URL hoặc publishable key');
    this.url = url.replace(/\/$/, '');
    this.key = key;
    this.fetch = fetchImpl;
    this.accessToken = null;
  }

  async signIn(email, password) {
    const res = await this.fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new SupabaseSourceError(body.error_description || body.msg || `Đăng nhập lỗi ${res.status}`);
    this.useSession(body.access_token);
    return body;
  }

  useSession(accessToken) {
    this.accessToken = accessToken;
  }

  async select(table, query) {
    if (!this.accessToken) throw new SupabaseSourceError('Chưa đăng nhập');
    let res;
    try {
      res = await this.fetch(`${this.url}/rest/v1/${table}?${query}`, {
        headers: { apikey: this.key, Authorization: `Bearer ${this.accessToken}` },
      });
    } catch (err) {
      throw new SupabaseSourceError(`Không gọi được Supabase: ${err.message}`);
    }
    if (res.status === 401) throw new SupabaseSourceError('Phiên đăng nhập hết hạn, cần đăng nhập lại');
    if (!res.ok) throw new SupabaseSourceError(`Đọc ${table} lỗi ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async rpc(fn, args) {
    if (!this.accessToken) throw new SupabaseSourceError('Chưa đăng nhập');
    let res;
    try {
      res = await this.fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: this.key, Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch (err) {
      throw new SupabaseSourceError(`Không gọi được Supabase: ${err.message}`);
    }
    if (res.status === 401) throw new SupabaseSourceError('Phiên đăng nhập hết hạn, cần đăng nhập lại');
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new SupabaseSourceError(body?.message || `Gọi ${fn} lỗi ${res.status}`);
    return body;
  }

  // Gọi Edge Function (vd ops-ai-import). Lỗi trả về {error} được hiện nguyên văn.
  async invoke(fn, body) {
    if (!this.accessToken) throw new SupabaseSourceError('Chưa đăng nhập');
    let res;
    try {
      res = await this.fetch(`${this.url}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { apikey: this.key, Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new SupabaseSourceError(`Không gọi được ${fn}: ${err.message}`);
    }
    const text = await res.text();
    let out = null;
    try { out = text ? JSON.parse(text) : null; } catch { /* trả chữ thô */ }
    if (!res.ok) throw new SupabaseSourceError(out?.error || out?.message || `Gọi ${fn} lỗi ${res.status}`);
    return out;
  }
}

// Hiện thực hợp đồng đọc Order của ticket 1: phân trang theo order_number
// (khóa tăng dần ổn định), trả kèm syncedAt và tên nguồn.
export class SupabaseOrderReader {
  constructor(client, { from, to, now = () => new Date().toISOString() }) {
    this.client = client;
    this.from = from; // ISO, bao gồm
    this.to = to; // ISO, không bao gồm
    this.now = now;
  }

  async listOrders({ cursor = null, pageSize = 500 } = {}) {
    const q = new URLSearchParams({ select: ORDER_COLUMNS, order: 'order_number.asc', limit: String(pageSize) });
    q.append('created_at', `gte.${this.from}`);
    q.append('created_at', `lt.${this.to}`);
    if (cursor) q.append('order_number', `gt.${cursor}`);
    const rows = await this.client.select('orders', q.toString());
    const last = rows.at(-1);
    return {
      orders: rows,
      nextCursor: rows.length === pageSize && last ? String(last.order_number) : null,
      syncedAt: this.now(),
      source: 'supabase:orders',
    };
  }
}

// Đọc toàn bộ đơn trong khoảng, dedupe theo id. Lỗi giữa chừng trả status=error
// để màn chủ quán báo "chưa đủ để chốt" chứ không hiện số thiếu như số đủ.
export async function readSupabaseOrders(reader, { pageSize = 500 } = {}) {
  const byKey = new Map();
  let cursor = null;
  let syncedAt = null;
  try {
    do {
      const res = await reader.listOrders({ cursor, pageSize });
      syncedAt = res.syncedAt;
      for (const row of res.orders) {
        const o = mapSupabaseOrder(row);
        byKey.set(o.sourceKey, o);
      }
      cursor = res.nextCursor;
    } while (cursor);
    return { status: 'ok', orders: [...byKey.values()], syncedAt };
  } catch (err) {
    return { status: 'error', error: err.message, orders: [...byKey.values()], syncedAt };
  }
}

export async function readExpenses(client, { fromDate, toDate }) {
  const q = new URLSearchParams({ select: 'id,expense_date,name,category,amount', order: 'expense_date.asc' });
  q.append('expense_date', `gte.${fromDate}`);
  q.append('expense_date', `lt.${toDate}`);
  return client.select('expenses', q.toString());
}

export async function readSettings(client) {
  const rows = await client.select('app_settings', 'select=shop_name,grab_fee_rate&limit=1');
  return rows[0] ?? null;
}
