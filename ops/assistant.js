// Trợ lý nhập kho (ticket 6): quét hóa đơn / nhập tay / nhập sổ công thức.
// Mọi thứ là BẢN NHÁP trong trình duyệt cho tới khi chủ quán bấm Ghi; ghi qua
// ops_commit_receipt hoặc ops_import_recipes, mỗi lần là một giao dịch.
import { UNITS, MEASURES, parseQtyInput } from './lib/inventory.js?v=receipt-edit-20261119';
import { docxToLines } from './lib/docx-text.js?v=receipt-edit-20261119';
import { mountReceiptAssistant } from './receipt-assistant.js?v=receipt-edit-20261119';
import {
  parseRecipeBook, recipeDraft, refreshFlags, draftIssues, recipeImportPayload, flagText,
} from './lib/import-draft.js?v=receipt-edit-20261119';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const vnd = (n) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;
const numFmt = (n) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const opt = (value, label, sel) => `<option value="${esc(value)}"${value === sel ? ' selected' : ''}>${esc(label)}</option>`;

let ctx = null; // { inventory, getInv, afterWrite }
let aliases = [];
let book = null; let bookFrom = today();

export function initAssistant(options) {
  ctx = options;
  setupTabs();
  ctx.receipt = mountReceiptAssistant($('receiptWorkspace'), { client: ctx.inventory.client, getIngredients: () => ctx.getInv()?.levels, afterWrite: ctx.afterWrite });
  $('bookFile').addEventListener('change', onBookFile);
  const bk = $('bookReview');
  bk.addEventListener('input', onBookInput);
  bk.addEventListener('change', onBookChange);
  bk.addEventListener('click', onErrLink);
  $('bookForm').addEventListener('submit', onBookSubmit);
}

// Gọi sau mỗi lần trang tải lại kho: cập nhật tên khác đã học và lịch sử nhập.
export async function refreshAssistant() {
  ctx.receipt.refreshHistory();
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
        <td data-label="Đơn vị">${e.existingId ? esc(e.unit) : `<select data-key="gi${i}-u" data-g="${i}" data-f="unit" aria-label="Đơn vị của ${esc(e.name)}">${UNITS.map((u) => opt(u, u, e.unit)).join('')}</select>`}</td>
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
