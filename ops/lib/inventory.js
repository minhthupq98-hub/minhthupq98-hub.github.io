// Kho và giá vốn (ticket 5). Đọc bảng/view ops_* qua RLS, ghi qua RPC ops_*.
// Trừ kho theo đơn, giá bình quân và kiểm kê do database tính; các hàm ở đây chỉ
// dựng số hiển thị (giá vốn theo công thức, tổng giá vốn kỳ, cảnh báo tồn).

export const UNITS = ['g', 'ml', 'cái'];
// Đơn vị nhập hàng quy về đơn vị gốc.
export const PURCHASE_UNITS = { g: { g: 1, kg: 1000 }, ml: { ml: 1, l: 1000 }, 'cái': { 'cái': 1 } };
export const MOVE_LABEL = { purchase: 'Nhập hàng', sale: 'Bán', sale_reversal: 'Hoàn kho đơn hủy', waste: 'Hủy/hao hụt', count: 'Lệch kiểm kê' };

const num = (v) => Number(v ?? 0);

// Số lượng từ ô nhập: cho phép dấu phẩy thập phân ("1,5"), tối đa 3 chữ số lẻ.
export function parseQtyInput(text, unit = null, baseUnit = null) {
  const s = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const factor = unit && baseUnit ? PURCHASE_UNITS[baseUnit]?.[unit] : 1;
  if (!factor) return null;
  return Math.round(Number(s) * factor * 1000) / 1000;
}

// Cùng công thức với ops_stock_purchase: tồn âm coi như 0.
export function weightedAvgCost(onHand, avgCost, qty, total) {
  const base = Math.max(num(onHand), 0);
  return Math.round(((base * num(avgCost) + num(total)) / (base + num(qty))) * 1e4) / 1e4;
}

// Phiên bản công thức hiệu lực tại ngày `date` (YYYY-MM-DD): các dòng có effective_from
// lớn nhất không sau ngày đó. null = chưa có công thức; [] = món không trừ kho.
export function recipeAt(recipes, productId, date) {
  const own = recipes.filter((r) => r.product_id === productId && r.effective_from <= date);
  if (!own.length) return null;
  const ef = own.reduce((m, r) => (r.effective_from > m ? r.effective_from : m), '');
  return own.filter((r) => r.effective_from === ef && r.ingredient_id).map((r) => ({ ingredientId: r.ingredient_id, qty: num(r.qty), effectiveFrom: ef }));
}

export function recipeCost(lines, ingredientsById) {
  if (!lines) return null;
  return Math.round(lines.reduce((s, l) => s + l.qty * num(ingredientsById.get(l.ingredientId)?.avg_cost), 0));
}

// Bảng giá vốn theo công thức cho các món đang bán.
export function menuCostTable({ products, recipes, ingredients, date }) {
  const byId = new Map(ingredients.map((i) => [i.ingredient_id ?? i.id, i]));
  return products.filter((p) => p.active).map((p) => {
    const lines = recipeAt(recipes, p.id, date);
    const rc = recipeCost(lines, byId);
    const unpriced = lines ? lines.some((l) => !num(byId.get(l.ingredientId)?.avg_cost)) : false;
    return {
      id: p.id, name: p.name, category: p.category, price: num(p.price), appCost: num(p.cost),
      hasRecipe: lines != null, recipeCost: rc, unpriced,
      diff: rc == null ? null : rc - num(p.cost),
      marginPct: rc == null || !num(p.price) ? null : Math.round(((num(p.price) - rc) / num(p.price)) * 1000) / 10,
    };
  }).sort((a, b) => a.category.localeCompare(b.category, 'vi') || a.name.localeCompare(b.name, 'vi'));
}

// Tồn hiện tại, giá trị và cảnh báo từ view ops_stock_levels.
export function stockStatus(levels) {
  return levels.filter((l) => l.active).map((l) => {
    const onHand = num(l.on_hand);
    return {
      ...l, onHand, value: Math.round(onHand * num(l.avg_cost)),
      negative: onHand < 0, low: onHand >= 0 && num(l.low_stock) > 0 && onHand <= num(l.low_stock),
    };
  }).sort((a, b) => Number(b.negative) - Number(a.negative) || Number(b.low) - Number(a.low) || a.name.localeCompare(b.name, 'vi'));
}

// Tổng giá trị giao dịch kho trong kỳ, số dương = chi phí của quán.
export function cogsSummary(moves) {
  const by = (k) => moves.filter((m) => m.kind === k).reduce((s, m) => s + num(m.value), 0);
  const sold = -(by('sale') + by('sale_reversal'));
  const waste = -by('waste');
  const countLoss = -by('count');
  return { sold, waste, countLoss, purchases: by('purchase'), totalCost: sold + waste + countLoss };
}

// Món đã bán trong kỳ nhưng chưa có công thức (từ ops_sale_postings.missing).
export function missingRecipes(postings) {
  const count = new Map();
  for (const p of postings) if (p.status === 'posted') for (const n of p.missing ?? []) count.set(n, (count.get(n) ?? 0) + 1);
  return [...count].map(([name, orders]) => ({ name, orders })).sort((a, b) => b.orders - a.orders);
}

export class SupabaseInventoryStore {
  constructor(client) {
    this.client = client;
  }

  // Trừ kho các đơn mới trước khi đọc, để tồn hiện ra là tồn sau bán.
  sync() {
    return this.client.rpc('ops_sync_sales', {});
  }

  async load({ from, to }) {
    const range = `business_date=gte.${from}&business_date=lt.${to}`;
    const [levels, recipes, products, moves, postings] = await Promise.all([
      this.client.select('ops_stock_levels', 'select=*&order=name.asc'),
      this.client.select('ops_recipes', 'select=product_id,effective_from,ingredient_id,qty&order=effective_from.desc'),
      this.client.select('products', 'select=id,name,category,price,cost,active&order=category.asc,name.asc'),
      this.client.select('ops_stock_moves', `select=id,ingredient_id,kind,qty,unit_cost,value,order_id,business_date,supplier,note,created_at&${range}&order=created_at.desc&limit=5000`),
      this.client.select('ops_sale_postings', `select=order_id,status,value,missing&${range}&limit=5000`),
    ]);
    return { levels, recipes, products, moves, postings };
  }

  saveIngredient({ id = null, name, unit, lowStock = 0, active = true }) {
    return this.client.rpc('ops_upsert_ingredient', { p_id: id, p_name: name, p_unit: unit, p_low_stock: lowStock, p_active: active });
  }

  setRecipe(productId, effectiveFrom, lines) {
    return this.client.rpc('ops_set_recipe', { p_product_id: productId, p_effective_from: effectiveFrom, p_lines: lines.map((l) => ({ ingredient_id: l.ingredientId, qty: l.qty })) });
  }

  purchase({ ingredientId, qty, total, supplier = '', note = '' }) {
    return this.client.rpc('ops_stock_purchase', { p_ingredient: ingredientId, p_qty: qty, p_total: total, p_supplier: supplier, p_note: note });
  }

  waste(ingredientId, qty, reason) {
    return this.client.rpc('ops_stock_waste', { p_ingredient: ingredientId, p_qty: qty, p_reason: reason });
  }

  // Trợ lý nhập kho (ticket 6).
  loadAssistant() {
    return Promise.all([
      this.client.select('ops_ingredient_aliases', 'select=alias_norm,ingredient_id'),
      this.client.select('ops_purchase_docs', 'select=id,supplier,doc_no,doc_date,has_invoice,total,line_count,created_at&order=created_at.desc&limit=20'),
    ]).then(([aliases, docs]) => ({ aliases: aliases.map((a) => ({ alias: a.alias_norm, ingredient_id: a.ingredient_id })), docs }));
  }

  importRecipes(payload) {
    return this.client.rpc('ops_import_recipes', payload);
  }

  purchaseBatch(payload) {
    return this.client.rpc('ops_purchase_batch', payload);
  }

  // file: { mime, data (base64) }. Chỉ trả bản nháp, không ghi gì.
  readInvoice(file, ingredients) {
    return this.client.invoke('ops-ai-import', { file, ingredients: ingredients.map((i) => ({ name: i.name, unit: i.unit })) });
  }

  count(lines, note = '') {
    return this.client.rpc('ops_stock_count', { p_lines: lines.map((l) => ({ ingredient_id: l.ingredientId, counted: l.counted })), p_note: note });
  }
}
