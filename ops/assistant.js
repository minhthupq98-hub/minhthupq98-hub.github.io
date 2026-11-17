// Trợ lý nhập kho (ticket 6): quét hóa đơn / nhập tay / nhập sổ công thức.
// Mọi thứ là BẢN NHÁP trong trình duyệt cho tới khi chủ quán bấm Ghi; ghi qua
// ops_purchase_batch hoặc ops_import_recipes, mỗi lần là một giao dịch.
import { PURCHASE_UNITS, MEASURES, parseQtyInput } from './lib/inventory.js';
import { parseVndInput } from './lib/shift-store.js';
import { docxToLines } from './lib/docx-text.js';
import {
  parseRecipeBook, recipeDraft, refreshFlags, draftIssues, recipeImportPayload, flagText,
  invoiceDraft, purchaseIssues, purchasePayload, emptyPurchaseLine,
} from './lib/import-draft.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const vnd = (n) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;
const numFmt = (n) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const opt = (value, label, sel) => `<option value="${esc(value)}"${value === sel ? ' selected' : ''}>${esc(label)}</option>`;
const X_ICON = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

let ctx = null; // { inventory, getInv, afterWrite }
let aliases = [];
let buy = null; let buyHash = null;
let book = null; let bookFrom = today();

export function initAssistant(options) {
  ctx = options;
  setupTabs();
  $('invoiceFile').addEventListener('change', onInvoiceFile);
  $('manualStart').addEventListener('click', () => startBuy(manualDraft(false)));
  $('bookFile').addEventListener('change', onBookFile);
  const bf = $('buyForm');
  bf.addEventListener('input', onBuyInput);
  bf.addEventListener('change', onBuyChange);
  bf.addEventListener('focusout', onBuyBlur);
  bf.addEventListener('click', onBuyClick);
  bf.addEventListener('submit', onBuySubmit);
  const bk = $('bookReview');
  bk.addEventListener('input', onBookInput);
  bk.addEventListener('change', onBookChange);
  bk.addEventListener('click', onErrLink);
  bf.addEventListener('click', onErrLink);
  $('bookForm').addEventListener('submit', onBookSubmit);
}

// Gọi sau mỗi lần trang tải lại kho: cập nhật tên khác đã học và lịch sử nhập.
export async function refreshAssistant() {
  try {
    const r = await ctx.inventory.loadAssistant();
    aliases = r.aliases;
    renderRecent(r.docs);
  } catch (err) {
    $('asRecent').innerHTML = `<p class="muted small">Chưa đọc được lịch sử nhập: ${esc(err.message)}</p>`;
  }
}

// ---------- chung ----------

function setupTabs() {
  const tabs = [$('tabBuy'), $('tabBook')];
  const pick = (t) => tabs.forEach((x) => {
    const on = x === t;
    x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1;
    $(x.getAttribute('aria-controls')).hidden = !on;
  });
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pick(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      pick(n); n.focus();
    });
  });
}

function steps(id, at) {
  [...$(id).children].forEach((li, i) => {
    li.className = i < at ? 'done' : i === at ? 'on' : '';
    if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}

const msg = (id, html) => { $(id).innerHTML = html; };

// Vẽ lại một vùng nhưng giữ ô đang gõ (theo data-key).
function rerender(el, html) {
  const key = document.activeElement?.dataset?.key;
  el.innerHTML = html;
  if (key) el.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
}

function errorSummary(items) {
  if (!items.length) return '';
  return `<div class="errsum" role="alert" tabindex="-1"><b>Còn ${items.length} chỗ cần xử lý trước khi ghi</b><ul>${items.slice(0, 12).map((i) => `<li>${i.href ? `<a href="#${esc(i.href)}" data-goto="${esc(i.href)}">${esc(i.text)}</a>` : esc(i.text)}</li>`).join('')}${items.length > 12 ? `<li>... và ${items.length - 12} chỗ nữa</li>` : ''}</ul></div>`;
}

function onErrLink(e) {
  const a = e.target.closest('[data-goto]');
  if (!a) return;
  e.preventDefault();
  const el = $(a.dataset.goto);
  if (!el) return;
  if (el.tagName === 'DETAILS') el.open = true;
  const target = el.querySelector('[aria-invalid="true"]') ?? el.querySelector('.check.bad input') ?? el.querySelector('input, select') ?? el;
  target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
}

function busy(btn, on, text) {
  btn.disabled = on; btn.setAttribute('aria-busy', String(on));
  if (on) { btn.dataset.label = btn.textContent; btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(text)}`; } else if (btn.dataset.label) btn.textContent = btn.dataset.label;
}

function renderRecent(docs) {
  if (!docs.length) { $('asRecent').innerHTML = ''; return; }
  $('asRecent').innerHTML = `<details><summary>Lần nhập gần đây (${docs.length})</summary><div class="tbl-wrap"><table><thead><tr><th>Ngày</th><th>Nhà cung cấp</th><th>Chứng từ</th><th class="n">Dòng</th><th class="n">Tổng</th></tr></thead><tbody>${docs.map((d) => `<tr><td>${esc(d.doc_date)}</td><td>${esc(d.supplier || 'không ghi')}</td><td>${d.has_invoice ? `Hóa đơn ${esc(d.doc_no)}` : 'Không hóa đơn'}</td><td class="n">${d.line_count}</td><td class="n">${vnd(d.total)}</td></tr>`).join('')}</tbody></table></div></details>`;
}

const ingredients = () => (ctx.getInv()?.levels ?? []).filter((l) => l.active);

// ---------- nhập hàng ----------

function manualDraft(hasInvoice) {
  return { supplier: '', docNo: '', docDate: today(), hasInvoice, grandTotal: null, linesTotal: 0, extra: 0, lines: [emptyPurchaseLine()] };
}

function lineBase(l) {
  return l.ingredientId ? ingredients().find((i) => i.ingredient_id === l.ingredientId)?.unit ?? 'g' : l.newUnit;
}

function startBuy(draft, hash = null) {
  buy = draft; buyHash = hash;
  buy.docDate ??= today();
  for (const l of buy.lines) prepLine(l);
  $('buyStart').hidden = true; $('buyForm').hidden = false;
  steps('buySteps', 1);
  renderBuy();
  $('buyForm').querySelector('input')?.focus();
}

function prepLine(l) {
  l.qtyUnit = lineBase(l);
  l.qtyText = l.qty != null ? String(l.qty).replace('.', ',') : '';
  l.totalText = l.total ? numFmt(l.total) : '';
  if (!l.total) l.total = NaN; // bắt nhập thành tiền (gõ 0 nếu được tặng)
  l.touched = {};
}

function resetBuy(keepMsg = false) {
  buy = null; buyHash = null;
  $('buyForm').hidden = true; $('buyStart').hidden = false; $('invoiceFile').value = '';
  if (!keepMsg) msg('buyMsg', '');
  steps('buySteps', 0);
}

async function onInvoiceFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const label = $('invoiceDrop');
  label.classList.add('busy'); label.setAttribute('aria-busy', 'true');
  msg('buyMsg', '<p class="muted small" role="status"><span class="spin" aria-hidden="true"></span>AI đang đọc hóa đơn, thường mất 5 đến 20 giây...</p>');
  try {
    const buf = await file.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const payload = await toPayload(file, buf);
    const r = await ctx.inventory.readInvoice(payload, ingredients());
    const d = invoiceDraft(r.invoice, { ingredients: ingredients(), aliases });
    if (!d.lines.length) d.lines.push(emptyPurchaseLine());
    const auto = d.lines.filter((l) => l.ingredientId).length;
    msg('buyMsg', `<div class="ok" role="status">AI đọc được ${d.lines.length} dòng, tự khớp ${auto} dòng với nguyên liệu đã có. Soát lại số lượng và tiền trước khi ghi.</div>`);
    startBuy(d, hash);
  } catch (err) {
    msg('buyMsg', `<div class="warn bad" role="alert">${esc(err.message)}<div class="row"><button type="button" class="ghost" id="manualFromFail">Nhập tay hóa đơn này</button></div></div>`);
    $('manualFromFail').addEventListener('click', () => { startBuy(manualDraft(true)); msg('buyMsg', ''); });
  } finally {
    label.classList.remove('busy'); label.removeAttribute('aria-busy');
  }
}

// Ảnh lớn thu về cạnh dài 2000px (đủ đọc chữ, gửi nhanh hơn). PDF/HEIC gửi nguyên.
async function toPayload(file, buf) {
  let mime = file.type || 'application/octet-stream';
  let blob = file;
  if (/^image\/(jpeg|png|webp)$/.test(mime) && file.size > 1_200_000) {
    try {
      const img = await createImageBitmap(file);
      const k = Math.min(1, 2000 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85)); mime = 'image/jpeg';
    } catch { blob = file; }
  }
  const bytes = blob === file ? new Uint8Array(buf) : new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mime, data: btoa(bin) };
}

function buyRow(l, i) {
  const ings = ingredients();
  const base = lineBase(l);
  const units = Object.keys(PURCHASE_UNITS[base] ?? { [base]: 1 });
  const bad = (f) => (l.touched[f] && fieldError(l, f) ? ' aria-invalid="true"' : '');
  const how = l.how === 'alias' ? '<span class="tag good">đã học tên này</span>' : l.how ? '<span class="tag good">tự khớp</span>' : '';
  const flags = l.flags.includes('unit_conflict') ? '<span class="hint bad">AI đọc đơn vị khác kho, nhập lại số lượng</span>' : '';
  return `<tr id="buyrow-${i}" class="${l.skip ? 'off' : ''}">
    <td data-label="Hàng"><input data-key="b${i}-name" data-i="${i}" data-f="name" value="${esc(l.name)}" placeholder="Tên trên hóa đơn" aria-label="Tên hàng dòng ${i + 1}">
      ${l.printed ? `<span class="hint">HĐ ghi: ${esc(l.printed)}</span>` : ''}${how}</td>
    <td data-label="Vào kho thành">
      <select data-key="b${i}-ing" data-i="${i}" data-f="ingredientId" aria-label="Nguyên liệu kho dòng ${i + 1}">
        ${opt('', '+ Nguyên liệu mới', l.ingredientId ?? '')}${ings.map((x) => opt(x.ingredient_id, `${x.name} (${x.unit})`, l.ingredientId)).join('')}
      </select>
      ${l.ingredientId ? '' : `<div class="pair"><input data-key="b${i}-nn" data-i="${i}" data-f="newName" value="${esc(l.newName)}" placeholder="Tên nguyên liệu mới" aria-label="Tên nguyên liệu mới dòng ${i + 1}"${bad('newName')}>
        <select data-key="b${i}-nu" data-i="${i}" data-f="newUnit" aria-label="Đơn vị gốc dòng ${i + 1}">${['g', 'ml', 'cái'].map((u) => opt(u, u, l.newUnit)).join('')}</select></div>`}
    </td>
    <td data-label="Số lượng" class="n"><div class="pair">
      <input data-key="b${i}-q" data-i="${i}" data-f="qtyText" value="${esc(l.qtyText)}" inputmode="decimal" placeholder="vd 1,5" aria-label="Số lượng dòng ${i + 1}"${bad('qtyText')}>
      <select data-key="b${i}-qu" data-i="${i}" data-f="qtyUnit" aria-label="Đơn vị nhập dòng ${i + 1}">${units.map((u) => opt(u, u, l.qtyUnit)).join('')}</select></div>${flags}</td>
    <td data-label="Thành tiền" class="n"><input data-key="b${i}-t" data-i="${i}" data-f="totalText" value="${esc(l.totalText)}" inputmode="numeric" placeholder="0" aria-label="Thành tiền dòng ${i + 1}"${bad('totalText')}>
      ${l.total !== l.amount && l.amount ? `<span class="hint">gồm ${vnd(l.total - l.amount)} thuế/phí</span>` : ''}</td>
    <td class="act"><button type="button" class="icon" data-act="del" data-i="${i}" aria-label="Bỏ dòng ${i + 1}">${X_ICON}</button></td>
  </tr>`;
}

function fieldError(l, f) {
  if (f === 'qtyText') return !(l.qty > 0);
  if (f === 'totalText') return !Number.isInteger(l.total) || l.total < 0;
  if (f === 'newName') return !l.ingredientId && !l.newName.trim();
  return false;
}

function renderBuy() {
  const live = buy.lines.filter((l) => !l.skip);
  rerender($('buyForm'), `
    <div class="doc-grid">
      <label>Nhà cung cấp<input data-key="d-sup" data-doc="supplier" value="${esc(buy.supplier)}" maxlength="120" placeholder="vd Đại lý sữa Minh Anh" autocomplete="off"></label>
      <label>Số hóa đơn${buy.hasInvoice ? '' : ' <span class="muted small">(không có)</span>'}<input data-key="d-no" data-doc="docNo" value="${esc(buy.docNo)}" maxlength="60"></label>
      <label>Ngày mua<input data-key="d-date" data-doc="docDate" type="date" value="${esc(buy.docDate ?? '')}" max="${today()}"></label>
    </div>
    <div class="tbl-wrap"><table class="edit">
      <thead><tr><th>Hàng</th><th>Vào kho thành</th><th class="n">Số lượng</th><th class="n">Thành tiền</th><th><span class="sr">Bỏ dòng</span></th></tr></thead>
      <tbody>${buy.lines.map((l, i) => (l.skip ? '' : buyRow(l, i))).join('')}</tbody>
    </table></div>
    <div class="row"><button type="button" class="ghost" data-act="add">+ Thêm dòng</button></div>
    <div id="buyTotals" aria-live="polite">${buyTotals()}</div>
    <div id="buyErrors"></div>
    <div class="row actions">
      <button type="submit" id="buySave">Ghi ${live.length} dòng vào kho</button>
      <button type="button" class="ghost" data-act="cancel">Bỏ bản nháp</button>
    </div>`);
}

function buyTotals() {
  const sum = buy.lines.filter((l) => !l.skip).reduce((s, l) => s + (Number.isInteger(l.total) ? l.total : 0), 0);
  const g = buy.grandTotal;
  const diff = g != null ? g - sum : 0;
  return `<p class="totals">Tổng các dòng <b>${vnd(sum)}</b>${g != null ? ` · Tổng hóa đơn ${vnd(g)}` : ''}</p>${g != null && diff !== 0 ? `<div class="warn">Lệch ${vnd(Math.abs(diff))} so với tổng hóa đơn. Kiểm tra dòng còn thiếu hoặc thành tiền đọc sai.</div>` : ''}`;
}

function setLine(l, f, v) {
  if (f === 'name' || f === 'newName') l[f] = v;
  else if (f === 'qtyText' || f === 'qtyUnit') { l[f] = v; l.qty = parseQtyInput(l.qtyText, l.qtyUnit, lineBase(l)); l.flags = l.flags.filter((x) => x !== 'unit_conflict'); }
  else if (f === 'totalText') { l.totalText = v; const n = parseVndInput(v); l.total = n ?? NaN; }
  else if (f === 'ingredientId' || f === 'newUnit') {
    l[f] = f === 'ingredientId' ? (v || null) : v;
    const base = lineBase(l);
    if (!PURCHASE_UNITS[base]?.[l.qtyUnit]) l.qtyUnit = base;
    l.qty = parseQtyInput(l.qtyText, l.qtyUnit, base);
    if (f === 'ingredientId') l.how = null;
  }
}

function onBuyInput(e) {
  const t = e.target;
  if (t.dataset.doc) { buy[t.dataset.doc] = t.value; return; }
  if (t.dataset.i == null || t.tagName === 'SELECT') return;
  const l = buy.lines[+t.dataset.i];
  // Nguyên liệu mới mặc định lấy theo tên trên hóa đơn cho tới khi người dùng tự đặt tên.
  if (t.dataset.f === 'name' && !l.ingredientId && (!l.newName || l.newName === l.autoName)) {
    l.newName = t.value; l.autoName = t.value;
    const nn = $('buyForm').querySelector(`[data-key="b${t.dataset.i}-nn"]`);
    if (nn) nn.value = t.value;
  }
  setLine(l, t.dataset.f, t.value);
  if (t.getAttribute('aria-invalid') && !fieldError(buy.lines[+t.dataset.i], t.dataset.f)) t.removeAttribute('aria-invalid');
  $('buyTotals').innerHTML = buyTotals();
}

function onBuyChange(e) {
  const t = e.target;
  if (t.tagName !== 'SELECT' || t.dataset.i == null) return;
  setLine(buy.lines[+t.dataset.i], t.dataset.f, t.value);
  renderBuy();
}

function onBuyBlur(e) {
  const t = e.target;
  if (t.dataset.i == null || !['qtyText', 'totalText', 'newName'].includes(t.dataset.f)) return;
  const l = buy.lines[+t.dataset.i];
  if (!t.value.trim() && !l.touched[t.dataset.f] && t.dataset.f !== 'totalText') return; // ô trống chưa gõ: chưa báo
  l.touched[t.dataset.f] = true;
  if (fieldError(l, t.dataset.f)) t.setAttribute('aria-invalid', 'true'); else t.removeAttribute('aria-invalid');
}

function onBuyClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'add') {
    const l = emptyPurchaseLine(); prepLine(l); buy.lines.push(l); renderBuy();
    $('buyForm').querySelector(`[data-key="b${buy.lines.length - 1}-name"]`)?.focus();
  } else if (b.dataset.act === 'del') {
    buy.lines[+b.dataset.i].skip = true;
    renderBuy();
    $('buyForm').querySelector('[data-act="add"]').focus();
  } else if (b.dataset.act === 'cancel') resetBuy();
}

async function onBuySubmit(e) {
  e.preventDefault();
  const d = { ...buy, docDate: buy.docDate || null, lines: buy.lines.map((l) => ({ ...l, total: Number.isInteger(l.total) ? l.total : NaN })) };
  const { issues, payload } = purchasePayload(d, buyHash);
  if (issues.length) {
    buy.lines.forEach((l) => { l.touched = { qtyText: true, totalText: true, newName: true }; });
    renderBuy();
    const rows = buy.lines.map((l, i) => [l, i]).filter(([l]) => !l.skip);
    $('buyErrors').innerHTML = errorSummary(issues.map((text) => {
      const hit = rows.find(([l, i]) => text.startsWith(`${l.name || l.newName || `Dòng ${rows.findIndex((r) => r[1] === i) + 1}`}:`));
      return { text, href: hit ? `buyrow-${hit[1]}` : null };
    }));
    $('buyErrors').firstElementChild?.focus();
    return;
  }
  const btn = $('buySave');
  busy(btn, true, 'Đang ghi vào kho...');
  try {
    const r = await ctx.inventory.purchaseBatch(payload);
    steps('buySteps', 3);
    resetBuy(true);
    steps('buySteps', 3);
    msg('buyMsg', `<div class="ok" role="status">Đã nhập kho ${r.lines.length} dòng, tổng ${vnd(r.total)}. Giá bình quân đã cập nhật.</div>`);
    await ctx.afterWrite();
  } catch (err) {
    busy(btn, false);
    $('buyErrors').innerHTML = errorSummary([{ text: err.message }]);
    $('buyErrors').firstElementChild?.focus();
  }
}

// ---------- sổ công thức ----------

async function onBookFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  msg('bookMsg', '<p class="muted small" role="status"><span class="spin" aria-hidden="true"></span>Đang đọc sổ công thức...</p>');
  try {
    const lines = await docxToLines(await file.arrayBuffer());
    const parsed = parseRecipeBook(lines);
    if (!parsed.length) throw new Error('Không thấy công thức nào. Sổ cần theo mẫu: tên món mở đầu bằng ✿, mục "Nguyên liệu" có các dòng • tên | lượng.');
    const inv = ctx.getInv();
    book = recipeDraft(parsed, { products: inv.products, ingredients: inv.levels, aliases });
    // Món bị trùng tên hoặc chỉ khớp một phần thì người dùng chọn lại.
    for (const r of book.recipes) if (r.match?.ambiguous) r.productId = null;
    msg('bookMsg', '');
    $('bookReview').hidden = false; $('bookForm').hidden = false;
    steps('bookSteps', 1);
    renderBook();
    $('bookReview').querySelector('.errsum, .stats')?.scrollIntoView({ block: 'start' });
  } catch (err) {
    msg('bookMsg', `<div class="warn bad" role="alert">${esc(err.message)}</div>`);
  } finally { e.target.value = ''; }
}

function recipeIssues() {
  return draftIssues(book).map((x) => ({ ...x, href: `rcp-${book.recipes.findIndex((r) => r.title === x.recipe)}` }));
}

function renderBook() {
  const inv = ctx.getInv();
  const issues = recipeIssues();
  const byRecipe = new Map();
  for (const x of issues) byRecipe.set(x.recipe, (byRecipe.get(x.recipe) ?? 0) + 1);
  const drinks = book.recipes.filter((r) => r.kind === 'drink');
  const semis = book.recipes.filter((r) => r.kind === 'semi');
  const used = book.ingredients.filter((e) => !e.skip);
  const prods = [...new Map(inv.products.map((p) => [p.id, p])).values()].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'vi'));
  const ings = inv.levels;
  const stats = [
    ['Món sẽ ghi', drinks.filter((r) => !r.skip && r.productId).length, `trên ${drinks.length} món trong sổ`],
    ['Nguyên liệu', used.length, `${used.filter((e) => !e.existingId).length} sẽ tạo mới`],
    ['Bán thành phẩm', semis.length, 'đã tách vào món dùng nó'],
    ['Cần xử lý', issues.length, issues.length ? 'xem danh sách bên dưới' : 'sẵn sàng ghi'],
  ];
  rerender($('bookReview'), `
    <div class="kpis stats">${stats.map(([l, v, s]) => `<div class="kpi"><div class="l">${l}</div><div class="v${l === 'Cần xử lý' && v ? ' down' : ''}">${v}</div><div class="l">${s}</div></div>`).join('')}</div>
    <label class="inline">Công thức áp dụng cho đơn từ ngày <input type="date" data-key="bk-from" data-book="from" value="${esc(bookFrom)}" max="${today()}"></label>
    <p class="muted small">Đơn bán trước ngày này giữ công thức cũ. Đá, nước lọc và thời gian ủ không tính vào kho. Dòng "1 ít", "đầy ly" chưa có số thì điền lượng hoặc bấm Bỏ.</p>

    <h3>Bước 1. Gom tên nguyên liệu</h3>
    <p class="muted small">Cùng một thứ mà sổ ghi hai tên (vd "Sữa tươi" và "Sữa Happy Barn") thì đặt cùng một tên hoặc chọn cùng một nguyên liệu có sẵn, trợ lý sẽ gộp lại.</p>
    <div class="tbl-wrap"><table class="edit">
      <thead><tr><th>Tên trong sổ</th><th>Ghi vào kho là</th><th>Đơn vị</th><th class="n">Dùng ở</th><th>Không trừ kho</th></tr></thead>
      <tbody>${book.ingredients.map((e, i) => `<tr class="${e.skip ? 'off' : ''}">
        <td data-label="Tên trong sổ">${esc(e.rawNames.join(', '))}</td>
        <td data-label="Ghi vào kho là"><select data-key="gi${i}-id" data-g="${i}" data-f="existingId" aria-label="Nguyên liệu kho cho ${esc(e.rawNames[0])}">
          ${opt('', '+ Tạo mới', e.existingId ?? '')}${ings.map((x) => opt(x.ingredient_id, `${x.name} (${x.unit})`, e.existingId)).join('')}</select>
          ${e.existingId ? '' : `<input data-key="gi${i}-n" data-g="${i}" data-f="name" value="${esc(e.name)}" maxlength="80" aria-label="Tên nguyên liệu mới cho ${esc(e.rawNames[0])}">`}</td>
        <td data-label="Đơn vị">${e.existingId ? esc(e.unit) : `<select data-key="gi${i}-u" data-g="${i}" data-f="unit" aria-label="Đơn vị của ${esc(e.name)}">${['g', 'ml', 'cái'].map((u) => opt(u, u, e.unit)).join('')}</select>`}</td>
        <td data-label="Dùng ở" class="n">${e.uses} dòng</td>
        <td data-label="Không trừ kho"><label class="check"><input type="checkbox" data-g="${i}" data-f="skip"${e.skip ? ' checked' : ''}> bỏ</label></td>
      </tr>`).join('')}</tbody></table></div>

    <h3>Bước 2. Soát công thức từng món</h3>
    ${book.recipes.map((r, j) => recipeBlock(r, j, byRecipe.get(r.title) ?? 0, prods)).join('')}
    <div id="bookErrors">${errorSummary(issues.map((x) => ({ text: `${x.recipe}: ${x.text}`, href: x.href })))}</div>`);
  $('bookSave').textContent = `Ghi công thức ${drinks.filter((r) => !r.skip && r.productId).length} món`;
  $('bookSave').disabled = issues.length > 0;
}

function recipeBlock(r, j, nIssues, prods) {
  const ing = new Map(book.ingredients.map((e) => [e.key, e]));
  if (r.kind === 'semi') {
    const usedBy = book.recipes.filter((x) => x.lines.some((l) => l.via === r.title)).map((x) => x.title);
    return `<details class="rcp semi" id="rcp-${j}"><summary><span class="t">${esc(r.title)}</span> <span class="tag">bán thành phẩm</span></summary>
      <p class="muted small">Không phải món bán. Nguyên liệu của nó đã được chia theo tỉ lệ vào: ${esc(usedBy.join(', ') || 'chưa món nào')}.</p></details>`;
  }
  const p = prods.find((x) => x.id === r.productId);
  const head = r.skip ? '<span class="tag">không nhập</span>' : p ? `<span class="muted">→ ${esc(p.name)}${p.active ? '' : ' (đang ẩn)'}</span>` : '<span class="tag bad">chưa chọn món</span>';
  return `<details class="rcp${r.skip ? ' off' : ''}" id="rcp-${j}"${nIssues ? ' open' : ''}>
    <summary><span class="t">${esc(r.title)}</span> ${head}${nIssues && !r.skip ? ` <span class="tag bad">${nIssues} chỗ cần xử lý</span>` : ''}</summary>
    <div class="row"><label class="inline">Món trong app <select data-key="r${j}-p" data-r="${j}" data-f="product">
      ${opt('__skip', 'Không nhập món này', r.skip ? '__skip' : '')}${opt('', 'Chọn món...', r.skip ? '' : r.productId ?? '')}
      ${prods.map((x) => opt(x.id, `${x.name}${x.active ? '' : ' (đang ẩn)'}`, r.skip ? '' : r.productId)).join('')}</select></label>
      ${r.docCost ? `<span class="muted small">Sổ ghi giá vốn ${vnd(r.docCost)}${r.docPrice ? `, giá bán ${vnd(r.docPrice)}` : ''}</span>` : ''}</div>
    ${r.match?.ambiguous ? '<p class="hint bad">App có hai món trùng tên này, chọn đúng món đang bán.</p>' : ''}
    ${r.size700.length ? `<p class="muted small">Sổ có ghi size 700ml (${esc(r.size700.join('; '))}). Trợ lý chỉ nhập size thường; món Upsize trong app tính riêng.</p>` : ''}
    <div class="tbl-wrap"><table class="edit">
      <thead><tr><th>Nguyên liệu</th><th>Sổ ghi</th><th class="n">Lượng / 1 ly</th><th>Ghi chú</th><th>Bỏ</th></tr></thead>
      <tbody>${r.lines.map((l, k) => {
        const e = ing.get(l.key);
        const dead = l.skip || e.skip;
        const need = !dead && (l.qty == null || !(l.qty > 0));
        const conflict = !dead && l.flags.includes('unit_conflict');
        return `<tr class="${dead ? 'off' : ''}">
          <td data-label="Nguyên liệu">${esc(e.name)}${l.via ? `<span class="hint">qua ${esc(l.via)}</span>` : ''}</td>
          <td data-label="Sổ ghi">${esc(l.rawQty)}</td>
          <td data-label="Lượng" class="n"><div class="pair"><input data-key="r${j}-${k}" data-r="${j}" data-k="${k}" data-f="qty" value="${l.qty != null ? String(l.qty).replace('.', ',') : ''}" inputmode="decimal" aria-label="Lượng ${esc(e.name)} cho ${esc(r.title)}"${need ? ' aria-invalid="true"' : ''}${dead ? ' disabled' : ''}><span class="unit">${esc(e.unit)}</span></div></td>
          <td data-label="Ghi chú">${l.measure ? `<span class="tag good">${esc(String(l.measureCount).replace('.', ','))} ${esc(MEASURES[l.measure])}</span>` : ''}${l.flags.filter((f) => f !== 'unit_conflict').map((f) => `<span class="tag">${esc(flagText(f))}</span>`).join('')}
            ${conflict ? `<label class="check${l.confirmed ? '' : ' bad'}"><input type="checkbox" data-r="${j}" data-k="${k}" data-f="confirmed"${l.confirmed ? ' checked' : ''}> sổ ghi ${esc(l.unit)}, đúng là ${esc(e.unit)}</label>` : ''}</td>
          <td data-label="Bỏ"><label class="check"><input type="checkbox" data-r="${j}" data-k="${k}" data-f="skip"${l.skip ? ' checked' : ''} aria-label="Bỏ ${esc(e.name)} khỏi ${esc(r.title)}"></label></td>
        </tr>`;
      }).join('')}</tbody></table></div>
  </details>`;
}

function onBookInput(e) {
  const t = e.target;
  if (t.dataset.book === 'from') { bookFrom = t.value; return; }
  if (t.dataset.f === 'qty') {
    const l = book.recipes[+t.dataset.r].lines[+t.dataset.k];
    const n = Number(t.value.trim().replace(',', '.'));
    l.qty = t.value.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
    if (l.qty != null) t.removeAttribute('aria-invalid');
    // Gõ số cụ thể thì bỏ cách đong bằng muỗng/vợt của dòng này.
    l.measure = null; l.measureCount = null; l.flags = l.flags.filter((f) => f !== 'estimated');
    return;
  }
  if (t.dataset.f === 'name') { book.ingredients[+t.dataset.g].name = t.value; }
}

// Ô số và ô tên chỉ vẽ lại khi rời ô (change) để không mất chỗ đang gõ.
function onBookChange(e) {
  const t = e.target;
  if (t.dataset.g != null) {
    const ent = book.ingredients[+t.dataset.g];
    if (t.dataset.f === 'existingId') {
      const ex = ctx.getInv().levels.find((x) => x.ingredient_id === t.value);
      ent.existingId = ex ? ex.ingredient_id : null;
      if (ex) { ent.name = ex.name; ent.unit = ex.unit; }
    } else if (t.dataset.f === 'unit') ent.unit = t.value;
    else if (t.dataset.f === 'skip') ent.skip = t.checked;
    else if (t.dataset.f === 'name') ent.name = t.value;
    refreshFlags(book);
  } else if (t.dataset.r != null) {
    const r = book.recipes[+t.dataset.r];
    if (t.dataset.f === 'product') { r.skip = t.value === '__skip'; r.productId = r.skip ? r.productId : (t.value || null); }
    else if (t.dataset.f === 'skip') r.lines[+t.dataset.k].skip = t.checked;
    else if (t.dataset.f === 'confirmed') r.lines[+t.dataset.k].confirmed = t.checked;
  } else if (t.dataset.book !== 'from' && t.dataset.f !== 'qty') return;
  renderBook();
}

async function onBookSubmit(e) {
  e.preventDefault();
  if (!bookFrom) { $('bookErrors').innerHTML = errorSummary([{ text: 'Chọn ngày áp dụng công thức' }]); return; }
  const { issues, payload } = recipeImportPayload(book, bookFrom);
  if (issues.length) {
    renderBook();
    $('bookErrors').innerHTML = errorSummary(issues.map((x) => ({ text: `${x.recipe}: ${x.text}`, href: `rcp-${book.recipes.findIndex((r) => r.title === x.recipe)}` })));
    $('bookErrors').firstElementChild?.focus();
    return;
  }
  const btn = $('bookSave');
  busy(btn, true, 'Đang ghi công thức...');
  try {
    const r = await ctx.inventory.importRecipes(payload);
    book = null;
    $('bookReview').hidden = true; $('bookForm').hidden = true; $('bookReview').innerHTML = '';
    steps('bookSteps', 3);
    msg('bookMsg', `<div class="ok" role="status">Đã ghi công thức ${r.recipes} món (${r.lines} dòng), tạo mới ${r.new_ingredients} nguyên liệu. Các đơn từ ${esc(payload.p_from)} sẽ được trừ kho theo công thức này.</div>`);
    await ctx.afterWrite();
  } catch (err) {
    $('bookErrors').innerHTML = errorSummary([{ text: err.message }]);
    $('bookErrors').firstElementChild?.focus();
  } finally { busy(btn, false); }
}
