// Trợ lý nhập kho (ticket 6): biến sổ công thức và hóa đơn thành BẢN NHÁP để chủ quán soát.
// Không ghi gì: chỉ đoán tên món, gom tên nguyên liệu, quy đổi đơn vị và đánh dấu dòng
// mơ hồ ("1 ít", "đầy ly", "2 muỗng"...). Ghi vào kho chỉ qua RPC sau khi người dùng xác nhận.
// Ticket 7: "muỗng", "vợt" và cách ghi phỏng chừng ("1 lớp", "rắc lên") quy về dụng cụ quầy.

import { measureSize } from './inventory.js';

// Khóa so khớp: chữ thường, bỏ dấu, đ -> d, chỉ giữ chữ số và khoảng trắng.
export function normKey(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const EN_VI = { banana: 'chuoi', mango: 'xoai', strawberry: 'dau', peach: 'dao', coconut: 'dua', milk: 'sua', tea: 'tra', coffee: 'ca phe' };
const tokens = (s) => new Set(normKey(s).split(' ').filter(Boolean).flatMap((t) => (EN_VI[t] ?? t).split(' ')));

const UNIT = {
  g: ['g', 1], gr: ['g', 1], gram: ['g', 1], gam: ['g', 1], kg: ['g', 1000],
  ml: ['ml', 1], l: ['ml', 1000], lit: ['ml', 1000], 'lít': ['ml', 1000],
  'quả': ['cái', 1], 'trái': ['cái', 1], 'viên': ['cái', 1], 'cái': ['cái', 1], 'lát': ['cái', 1], 'miếng': ['cái', 1], 'hũ': ['cái', 1], 'ly': ['cái', 1],
};
const VAGUE_UNITS = ['muỗng', 'thìa', 'phần', 'lớp', 'shot', 'ít', 'nhúm', 'chút'];
const NUM = String.raw`(\d+\/\d+|\d+(?:[.,]\d+)?)`;
const toNum = (s) => (s.includes('/') ? Number(s.split('/')[0]) / Number(s.split('/')[1]) : Number(s.replace(',', '.')));
const round3 = (n) => Math.round(n * 1000) / 1000;

// Dụng cụ ghi rõ trong sổ.
const MEASURE_WORDS = [
  [/(muỗng|thìa)\s*(nhỏ|cà phê|cafe)/, 'mn'],
  [/(muỗng|thìa)\s*(tròn|to|lớn|canh)/, 'mt'],
  [/vợt/, 'vot'],
];
// Cách ghi phỏng chừng -> dụng cụ gần nhất, đánh dấu ước lượng để chủ quán chỉnh lại.
const MEASURE_GUESS = [
  [/(^|[\s\d])(lớp|muỗng|thìa)/, 'mt'],
  [/(^|[\s\d])(phần|phủ)/, 'vot'],
  [/(^|[\s\d])(ít|nhúm|chút|rắc)/, 'mn'],
];

// "4g" | "1,5 lít" | "1/4 trái" | "130–150ml" | "1 shot (50ml)" | "đầy ly" -> { qty, unit, flags }
export function parseRecipeQty(text) {
  const raw = String(text ?? '').trim();
  const s = raw.toLowerCase();
  const inner = s.match(new RegExp(String.raw`\(\s*${NUM}\s*(g|ml|kg|l|lít)\s*\)`));
  if (inner) return { qty: round3(toNum(inner[1]) * UNIT[inner[2]][1]), unit: UNIT[inner[2]][0], flags: [] };
  const m = s.match(new RegExp(String.raw`^${NUM}(?:\s*[–\-~]\s*${NUM})?\s*([a-zà-ỹđ]+)?`));
  const lead = s.match(new RegExp(String.raw`${NUM}`));
  const count = lead ? toNum(lead[1]) : 1;
  const tool = MEASURE_WORDS.find(([re]) => re.test(s));
  if (tool) return { qty: null, unit: null, measure: tool[1], measureCount: count, flags: [], count, word: '' };
  const vague = (word) => {
    const g = MEASURE_GUESS.find(([re]) => re.test(s));
    return g ? { qty: null, unit: null, measure: g[1], measureCount: count, flags: ['estimated'], count, word }
      : { qty: null, unit: null, flags: ['vague'], count: m ? count : undefined, word };
  };
  if (!m) return vague('');
  const [, a, b, u] = m;
  if (u && ['phút', 'giờ', 'độ'].includes(u)) return { qty: null, unit: null, flags: ['not_ingredient'] };
  if (!u || VAGUE_UNITS.includes(u) || !UNIT[u]) return { ...vague(u ?? ''), count: toNum(a) };
  const n = toNum(b ?? a);
  return { qty: round3(n * UNIT[u][1]), unit: UNIT[u][0], flags: b ? ['range'] : [] };
}

// Đá, nước, thời gian ủ: không phải hàng trong kho.
export function isNonStock(name) {
  const k = normKey(name);
  return k === 'da' || k === 'da vien' || /^nuoc( |$)/.test(k) && !/^nuoc (cot|ep|mam|tuong|dua)/.test(k) || /^thoi gian/.test(k);
}

// ---------- Sổ công thức (mẫu THE KHE: ✿ tên món, 🧺 Nguyên liệu, • tên | lượng, 📏 Size 700ml) ----------

export function parseRecipeBook(lines) {
  const recipes = [];
  let cur = null; let mode = null; let section = '';
  for (const line of lines) {
    if (/^✿\s/.test(line) && !/^✿\s+✿/.test(line)) {
      const [first, ...rest] = line.replace(/^✿\s+/, '').split('\n');
      cur = { title: titleCase(first), note: rest.join(' ').trim(), cost: null, price: null, lines: [], size700: [] };
      recipes.push(cur); mode = null; section = '';
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('Giá vốn')) {
      const nums = line.split('|').map((c) => Number((c.match(/[\d.]+/)?.[0] ?? '').replace(/\./g, '')) || null);
      cur.cost = nums[0]; cur.price = nums[1] ?? null;
    } else if (line.startsWith('🧺')) { mode = 'ing'; section = ''; }
    else if (line.startsWith('🥄') || line.startsWith('✏') || line.startsWith('💡')) mode = null;
    else if (line.startsWith('📏')) { cur.size700 = line.split('\n').slice(1).map((x) => x.replace(/^→\s*/, '').trim()).filter(Boolean); mode = null; }
    else if (line === '---') { if (mode === 'ing') mode = 'ing-done'; }
    else if (mode === 'ing') {
      if (/^•/.test(line)) {
        const [name, qty = ''] = line.replace(/^•\s*/, '').split(' | ');
        cur.lines.push({ section, rawName: name.trim(), rawQty: qty.trim() });
      } else section = line.trim();
    }
  }
  return recipes.filter((r) => r.lines.length);
}

function titleCase(s) {
  const t = String(s).trim().toLocaleLowerCase('vi');
  return t.replace(/(^|\s)(\p{L})/gu, (m, sp, c) => sp + c.toLocaleUpperCase('vi'));
}

// Món trong app Order khớp tên công thức. Ưu tiên trùng hẳn, rồi tên này chứa trọn tên kia.
export function matchProduct(title, products) {
  const A = tokens(title);
  let best = null;
  const seen = new Set();
  for (const p of products) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const B = tokens(p.name);
    const inter = [...A].filter((t) => B.has(t)).length;
    if (!inter) continue;
    if (inter < A.size && inter < B.size) continue; // không tên nào chứa trọn tên kia
    const score = inter / (A.size + B.size - inter) + (p.active ? 0.01 : 0);
    if (!best || score > best.score) best = { product: p, score, alts: [] };
    else if (Math.abs(score - best.score) < 1e-9) best.alts.push(p);
  }
  if (!best) return null;
  return { productId: best.product.id, name: best.product.name, active: !!best.product.active, exact: best.score >= 1, ambiguous: best.alts.length > 0, alts: best.alts.map((p) => p.id) };
}

// Bán thành phẩm: công thức được món khác gọi tên ("Trà lài | 150ml" gọi "Ủ Trà Lài").
function semiDefs(recipes) {
  const used = new Set(recipes.flatMap((r) => r.lines.map((l) => normKey(l.rawName))));
  const out = new Map();
  for (const r of recipes) {
    const key = normKey(r.title).replace(/^u /, '');
    if (!used.has(key)) continue;
    const water = r.lines.filter((l) => isNonStock(l.rawName)).map((l) => parseRecipeQty(l.rawQty)).filter((q) => q.unit === 'ml');
    const yieldMl = water.reduce((s, q) => s + q.qty, 0);
    out.set(key, { title: r.title, yieldQty: yieldMl || 1, yieldUnit: yieldMl ? 'ml' : 'phần', lines: r.lines.filter((l) => !isNonStock(l.rawName)) });
  }
  return out;
}

const FLAG_TEXT = {
  vague: 'chưa có định lượng', range: 'sổ ghi khoảng, đang lấy số lớn', unit_conflict: 'khác đơn vị với các món khác',
  semi_unit: 'không quy đổi được bán thành phẩm', estimated: 'sổ ghi phỏng chừng, đang ước bằng muỗng/vợt',
};
export const flagText = (f) => FLAG_TEXT[f] ?? f;

// Bản nháp từ sổ công thức. ingredients = view ops_stock_levels, aliases = [{alias, ingredient_id}].
export function recipeDraft(book, { products = [], ingredients = [], aliases = [] } = {}) {
  const semis = semiDefs(book);
  const recipes = [];
  for (const r of book) {
    const semi = semis.get(normKey(r.title).replace(/^u /, ''));
    const match = semi ? null : matchProduct(r.title, products);
    const lines = [];
    const add = (l, via = null, factor = 1) => {
      if (isNonStock(l.rawName)) return;
      const q = parseRecipeQty(l.rawQty);
      if (q.flags.includes('not_ingredient')) return;
      lines.push({
        rawName: l.rawName, rawQty: l.rawQty, section: l.section, qty: q.qty == null ? null : round3(q.qty * factor), unit: q.unit,
        measure: q.measure ?? null, measureCount: q.measure ? round3(q.measureCount * factor) : null, flags: [...q.flags], via, skip: false,
      });
    };
    for (const l of r.lines) {
      const s = semis.get(normKey(l.rawName));
      if (s && !semi) {
        const q = parseRecipeQty(l.rawQty);
        const factor = s.yieldUnit === 'ml' && q.unit === 'ml' ? q.qty / s.yieldQty
          : s.yieldUnit === 'phần' && q.qty == null && q.count ? q.count : null;
        if (factor == null) { lines.push({ rawName: l.rawName, rawQty: l.rawQty, section: l.section, qty: null, unit: null, flags: ['semi_unit'], via: null, skip: false }); continue; }
        for (const sl of s.lines) add(sl, s.title, factor);
      } else add(l);
    }
    recipes.push({
      title: r.title, note: r.note, docCost: r.cost, docPrice: r.price, size700: r.size700,
      kind: semi ? 'semi' : 'drink', productId: match?.productId ?? null, match, skip: !!semi, lines,
    });
  }

  // Gom nguyên liệu theo tên đã chuẩn hóa; khớp nguyên liệu đã có bằng alias rồi bằng tên.
  const aliasMap = new Map(aliases.map((a) => [a.alias, a.ingredient_id]));
  const byName = new Map(ingredients.map((i) => [normKey(i.name), i]));
  const byId = new Map(ingredients.map((i) => [i.ingredient_id ?? i.id, i]));
  const ing = new Map();
  for (const r of recipes) for (const l of r.lines) {
    const key = normKey(l.rawName);
    l.key = key;
    if (!ing.has(key)) {
      const ex = byId.get(aliasMap.get(key)) ?? byName.get(key) ?? null;
      ing.set(key, { key, rawNames: new Set(), name: ex?.name ?? cap(l.rawName), existingId: ex ? (ex.ingredient_id ?? ex.id) : null, existingUnit: ex?.unit ?? null, measures: ex?.measures ?? {}, units: {}, uses: 0, skip: false });
    }
    const e = ing.get(key); e.rawNames.add(l.rawName); e.uses += 1;
    if (l.unit) e.units[l.unit] = (e.units[l.unit] ?? 0) + 1;
  }
  for (const e of ing.values()) {
    e.unit = e.existingUnit ?? Object.entries(e.units).sort((a, b) => b[1] - a[1])[0]?.[0] ?? (LIQUID.test(normKey(e.name)) ? 'ml' : 'g');
    e.rawNames = [...e.rawNames];
  }
  const draft = { recipes, ingredients: [...ing.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi')) };
  return refreshFlags(draft);
}

// Tính lại cờ lệch đơn vị (và lượng của dòng đong bằng dụng cụ) sau khi người dùng đổi
// đơn vị/gộp nguyên liệu.
export function refreshFlags(draft) {
  const ing = new Map(draft.ingredients.map((e) => [e.key, e]));
  for (const r of draft.recipes) for (const l of r.lines) {
    if (l.measure) {
      const e = ing.get(l.key);
      l.unit = e?.unit ?? null;
      l.qty = e ? round3(l.measureCount * measureSize(e, l.measure)) : null;
    }
    l.flags = l.flags.filter((f) => f !== 'unit_conflict');
    if (l.unit && l.unit !== ing.get(l.key)?.unit) l.flags.push('unit_conflict');
  }
  return draft;
}

const LIQUID = /\b(syrup|siro|sot|nuoc|sua|monin)\b/;
const cap = (s) => { const t = String(s).trim(); return t.charAt(0).toLocaleUpperCase('vi') + t.slice(1); };

// Số dòng còn phải xử lý trước khi ghi (dòng thiếu lượng, lệch đơn vị, món chưa chọn).
export function draftIssues(draft) {
  const ingSkip = new Set(draft.ingredients.filter((i) => i.skip).map((i) => i.key));
  const out = [];
  for (const r of draft.recipes) {
    if (r.skip) continue;
    if (!r.productId) { out.push({ recipe: r.title, text: 'chưa chọn món trong app' }); continue; }
    for (const l of r.lines) {
      if (l.skip || ingSkip.has(l.key)) continue;
      if (l.qty == null || !(l.qty > 0)) out.push({ recipe: r.title, text: `${l.rawName}: ${flagText(l.flags[0] ?? 'vague')}` });
      else if (l.flags.includes('unit_conflict') && !l.confirmed) out.push({ recipe: r.title, text: `${l.rawName}: sổ ghi ${l.unit}, kho dùng ${draft.ingredients.find((i) => i.key === l.key)?.unit}` });
    }
  }
  return out;
}

// Payload cho RPC ops_import_recipes. Trùng tên sau khi sửa = gộp làm một nguyên liệu.
export function recipeImportPayload(draft, from) {
  const issues = draftIssues(draft);
  if (issues.length) return { issues };
  const finalKey = (e) => (e.existingId ? `id:${e.existingId}` : `n:${normKey(e.name)}`);
  const ingByKey = new Map(draft.ingredients.map((e) => [e.key, e]));
  const p_ingredients = new Map();
  const p_aliases = [];
  for (const e of draft.ingredients) {
    if (e.skip) continue;
    const fk = finalKey(e);
    if (!p_ingredients.has(fk)) p_ingredients.set(fk, { key: fk, id: e.existingId, name: e.name.trim(), unit: e.unit });
    else if (p_ingredients.get(fk).unit !== e.unit) return { issues: [{ recipe: e.name, text: 'hai tên gộp làm một nhưng khác đơn vị' }] };
    p_aliases.push({ alias: e.key, key: fk });
  }
  const p_recipes = [];
  for (const r of draft.recipes) {
    if (r.skip) continue;
    // Cùng nguyên liệu nhiều dòng: cộng lượng; cùng một dụng cụ thì cộng số muỗng/vợt,
    // khác dụng cụ thì chỉ giữ lượng đã quy đổi.
    const sum = new Map();
    for (const l of r.lines) {
      const e = ingByKey.get(l.key);
      if (l.skip || e.skip) continue;
      const fk = finalKey(e);
      const cur = sum.get(fk);
      if (!cur) { sum.set(fk, { key: fk, qty: l.qty, measure: l.measure ?? null, measure_count: l.measure ? l.measureCount : null }); continue; }
      cur.qty = round3(cur.qty + l.qty);
      if (cur.measure && cur.measure === l.measure) cur.measure_count = round3(cur.measure_count + l.measureCount);
      else { cur.measure = null; cur.measure_count = null; }
    }
    p_recipes.push({
      product_id: r.productId, title: r.title,
      lines: [...sum.values()].map((x) => (x.measure ? { key: x.key, qty: x.qty, measure: x.measure, measure_count: x.measure_count } : { key: x.key, qty: x.qty })),
    });
  }
  const seen = new Set();
  for (const r of p_recipes) {
    if (seen.has(r.product_id)) return { issues: [{ recipe: r.title, text: 'hai công thức cùng trỏ vào một món' }] };
    seen.add(r.product_id);
  }
  const used = new Set(p_recipes.flatMap((r) => r.lines.map((l) => l.key)));
  return {
    issues: [],
    payload: {
      p_from: from,
      p_ingredients: [...p_ingredients.values()].filter((i) => used.has(i.key)),
      p_recipes: p_recipes.map(({ product_id, lines }) => ({ product_id, lines })),
      p_aliases: p_aliases.filter((a) => used.has(a.key)),
    },
  };
}

// ---------- Hóa đơn nhập hàng ----------

// Nguyên liệu khớp tên dòng hóa đơn: alias đã học, rồi tên trùng hẳn, rồi tên nguyên liệu
// nằm trọn trong tên dòng ("Sữa tươi Happy Barn 1L x12" chứa "Sữa Happy Barn").
export function matchIngredient(name, ingredients, aliases = []) {
  const k = normKey(name);
  const a = aliases.find((x) => x.alias === k);
  if (a && ingredients.some((i) => (i.ingredient_id ?? i.id) === a.ingredient_id)) return { id: a.ingredient_id, how: 'alias' };
  const exact = ingredients.find((i) => normKey(i.name) === k);
  if (exact) return { id: exact.ingredient_id ?? exact.id, how: 'name' };
  const T = tokens(name);
  const hits = ingredients.map((i) => ({ i, t: tokens(i.name) })).filter(({ t }) => t.size && [...t].every((x) => T.has(x)))
    .sort((x, y) => y.t.size - x.t.size);
  if (!hits.length || (hits[1] && hits[1].t.size === hits[0].t.size)) return null;
  return { id: hits[0].i.ingredient_id ?? hits[0].i.id, how: 'contains' };
}

const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

// ai: kết quả hàm ops-ai-import mode=invoice. Phân bổ thuế/phí (nếu có) vào từng dòng
// theo tỷ lệ tiền, vì quán không khấu trừ VAT nên thuế là một phần giá vốn.
export function invoiceDraft(ai, { ingredients = [], aliases = [], allocateExtra = true } = {}) {
  const lines = (ai?.lines ?? []).map((l) => {
    const m = matchIngredient(l.name, ingredients, aliases);
    const ing = m && ingredients.find((i) => (i.ingredient_id ?? i.id) === m.id);
    const baseUnit = ['g', 'ml', 'cái'].includes(l.base_unit) ? l.base_unit : null;
    const flags = [];
    let qty = Number(l.base_qty) > 0 ? round3(Number(l.base_qty)) : null;
    if (ing && baseUnit && baseUnit !== ing.unit) { flags.push('unit_conflict'); qty = null; }
    if (qty == null) flags.push('need_qty');
    return {
      name: String(l.name ?? '').trim(), printed: [l.qty, l.unit].filter((x) => x != null && x !== '').join(' '),
      ingredientId: m?.id ?? null, how: m?.how ?? null, newName: ing ? '' : String(l.name ?? '').trim(), newUnit: baseUnit ?? 'g',
      qty, amount: int(l.amount) ?? 0, flags, skip: false,
    };
  });
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  const grand = int(ai?.grand_total);
  const extra = grand != null && grand > sum ? grand - sum : 0;
  if (allocateExtra && extra > 0 && sum > 0) {
    let left = extra;
    lines.forEach((l, i) => { const add = i === lines.length - 1 ? left : Math.round((extra * l.amount) / sum); l.total = l.amount + add; left -= add; });
  } else lines.forEach((l) => { l.total = l.amount; });
  return {
    supplier: String(ai?.supplier ?? '').trim(), docNo: String(ai?.doc_no ?? '').trim(), docDate: /^\d{4}-\d{2}-\d{2}$/.test(ai?.doc_date ?? '') ? ai.doc_date : null,
    grandTotal: grand, linesTotal: sum, extra: allocateExtra ? extra : 0, hasInvoice: true, lines,
  };
}

export const emptyPurchaseLine = () => ({ name: '', printed: '', ingredientId: null, how: null, newName: '', newUnit: 'g', qty: null, amount: 0, total: 0, flags: [], skip: false });

export function purchaseIssues(d) {
  const out = [];
  const lines = d.lines.filter((l) => !l.skip);
  if (!lines.length) out.push('Chưa có dòng hàng nào để nhập.');
  lines.forEach((l, i) => {
    const label = l.name || l.newName || `Dòng ${i + 1}`;
    if (!l.ingredientId && !l.newName.trim()) out.push(`${label}: chọn nguyên liệu hoặc đặt tên nguyên liệu mới`);
    if (!(l.qty > 0)) out.push(`${label}: cần số lượng quy về đơn vị kho`);
    if (!Number.isInteger(l.total) || l.total < 0) out.push(`${label}: thành tiền không hợp lệ`);
  });
  if (d.docDate && d.docDate > new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)) out.push('Ngày hóa đơn ở tương lai.');
  return out;
}

export function purchasePayload(d, fileHash = null) {
  const issues = purchaseIssues(d);
  if (issues.length) return { issues };
  return {
    issues: [],
    payload: {
      p_doc: { supplier: d.supplier.trim(), doc_no: d.docNo.trim(), doc_date: d.docDate, has_invoice: !!d.hasInvoice, file_hash: fileHash, total: d.lines.filter((l) => !l.skip).reduce((s, l) => s + l.total, 0) },
      p_lines: d.lines.filter((l) => !l.skip).map((l) => ({
        ingredient_id: l.ingredientId, new_name: l.ingredientId ? null : l.newName.trim(), new_unit: l.ingredientId ? null : l.newUnit,
        qty: l.qty, total: l.total, alias: l.name ? normKey(l.name) : null,
      })),
    },
  };
}
