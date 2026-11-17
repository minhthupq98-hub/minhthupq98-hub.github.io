import { SUPABASE_URL, SUPABASE_KEY, ADMIN_SESSION_KEY } from './config.js';
import { SupabaseClient, SupabaseOrderReader, readSupabaseOrders, readExpenses, readSettings } from './lib/supabase-order-source.js';
import { buildOwnerDashboard, monthRange, rangeToIso } from './lib/owner-dashboard.js';
import { SupabaseSettlementStore, ordersForReconcile, previewGrabFile } from './lib/settlement-store.js';
import { buildReconcileReport } from './lib/reconcile-report.js';
import { SupabaseShiftStore, shiftPreview, applyStartDate, parseVndInput, MOVE_KIND } from './lib/shift-store.js';
import { initAssistant, refreshAssistant } from './assistant.js';
import { SupabaseInventoryStore, PURCHASE_UNITS, MEASURES, measureSize, MOVE_LABEL, parseQtyInput, weightedAvgCost, recipeAt, recipeCost, menuCostTable, stockStatus, cogsSummary, missingRecipes } from './lib/inventory.js';

const OWN_KEY = 'the-khe-ops-session';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const vnd = (n) => `${new Intl.NumberFormat('vi-VN').format(Number(n) || 0)}đ`; // Number(-0)||0 = 0, hết "-0đ"
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const fmtDate = (iso) => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().slice(0, 10);
// "09:05 17/11" trong năm nay, thêm năm nếu khác năm (giờ Việt Nam).
const fmtTime = (iso) => {
  if (!iso) return 'chưa có';
  const t = new Date(Date.parse(iso) + 7 * 3600e3).toISOString();
  return `${t.slice(11, 16)} ${t.slice(8, 10)}/${t.slice(5, 7)}${t.slice(0, 4) === today().slice(0, 4) ? '' : `/${t.slice(0, 4)}`}`;
};
const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const spanText = (from, toExcl) => { const to = addDays(toExcl, -1); return from === to ? `${dm(from)}/${from.slice(0, 4)}` : `${dm(from)} - ${dm(to)}/${to.slice(0, 4)}`; };

const client = new SupabaseClient({ url: SUPABASE_URL, key: SUPABASE_KEY });
const store = new SupabaseSettlementStore(client);
const shifts = new SupabaseShiftStore(client);
const inventory = new SupabaseInventoryStore(client);
let inv = null;
let shiftState = { startDate: null, open: null, moves: [], recent: [] };
let quick = 'month';

// Phiên: ưu tiên phiên riêng của màn này; nếu chưa có thì mượn access token còn hạn của
// admin cùng tên miền. KHÔNG dùng refresh token của admin (làm xoay vòng sẽ đăng xuất admin).
function findSession() {
  for (const [store, key] of [[sessionStorage, OWN_KEY], [localStorage, ADMIN_SESSION_KEY]]) {
    try {
      const s = JSON.parse(store.getItem(key) || 'null');
      if (s?.access_token && s.expires_at * 1000 > Date.now() + 60e3) return s.access_token;
    } catch { /* bỏ qua phiên hỏng */ }
  }
  return null;
}

function showLogin(msg = '') {
  $('app').hidden = true;
  $('navToggle').hidden = true;
  $('logout').hidden = true;
  $('login').hidden = false;
  $('loginErr').textContent = msg;
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('loginErr').textContent = '';
  try {
    const s = await client.signIn(f.get('email'), f.get('password'));
    sessionStorage.setItem(OWN_KEY, JSON.stringify({ access_token: s.access_token, expires_at: s.expires_at }));
    start();
  } catch (err) {
    $('loginErr').textContent = err.message;
  }
});
$('logout').addEventListener('click', () => { sessionStorage.removeItem(OWN_KEY); client.useSession(null); showLogin(); });

function currentRange() {
  const t = today();
  if (quick === 'today') return { from: t, to: addDays(t, 1) };
  if (quick === '7d') return { from: addDays(t, -6), to: addDays(t, 1) };
  return monthRange($('month').value || t.slice(0, 7));
}

document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  quick = b.dataset.q;
  markSeg();
  load();
}));
function markSeg() {
  document.querySelectorAll('.seg button').forEach((x) => { x.classList.toggle('on', x.dataset.q === quick); x.setAttribute('aria-pressed', String(x.dataset.q === quick)); });
}
function fillMonths() {
  const [y, m] = today().split('-').map(Number);
  $('month').innerHTML = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const v = d.toISOString().slice(0, 7);
    return `<option value="${v}">Tháng ${d.getUTCMonth() + 1}/${d.getUTCFullYear()}</option>`;
  }).join('');
}
$('month').addEventListener('change', () => { quick = 'month'; markSeg(); load(); });
$('reload').addEventListener('click', load);
const typing = (t) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('sidenav').classList.contains('open')) { setNav(false); $('navToggle').focus(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || $('app').hidden) return;
  if (e.key === 'r') load();
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length) location.hash = VIEWS[n - 1];
});

// ---------- Ticket 7: danh mục bên trái, mỗi mục một địa chỉ #... (nút Back dùng được) ----------
const VIEWS = [...document.querySelectorAll('.view')].map((v) => v.dataset.view);
const PERIOD_VIEWS = new Set(['tong-quan', 'kho', 'chi-phi', 'doi-soat']);
const currentView = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : VIEWS[0]);

function showView(moveFocus) {
  const v = currentView();
  for (const s of document.querySelectorAll('.view')) s.hidden = s.dataset.view !== v;
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.title = `${$(`h-${v}`).textContent} · THE KHE`;
  // Thanh chọn kỳ chỉ hiện ở mục có số theo kỳ.
  $('filters').hidden = !PERIOD_VIEWS.has(v);
  $('invMsg').innerHTML = '';
  setNav(false);
  if (moveFocus) { window.scrollTo(0, 0); $(`h-${v}`).focus({ preventScroll: true }); }
}

function setNav(open) {
  const nav = $('sidenav');
  if (nav.classList.contains('open') === open) return;
  nav.classList.toggle('open', open);
  $('scrim').hidden = !open;
  $('navToggle').setAttribute('aria-expanded', String(open));
  $('navToggle').setAttribute('aria-label', open ? 'Đóng danh mục' : 'Mở danh mục');
  if (open) nav.querySelector('[aria-current=page]')?.focus();
}

window.addEventListener('hashchange', () => { if (VIEWS.includes(location.hash.slice(1))) showView(true); });
$('navToggle').addEventListener('click', () => setNav(!$('sidenav').classList.contains('open')));
$('scrim').addEventListener('click', () => setNav(false));
// Bấm lại đúng mục đang mở (hash không đổi) vẫn đóng ngăn kéo và đưa về đầu mục.
$('sidenav').addEventListener('click', (e) => { const a = e.target.closest('[data-nav]'); if (a && a.dataset.nav === currentView()) { e.preventDefault(); showView(true); } });
const badge = (view, text) => { $(`nb-${view}`).textContent = text ? String(text) : ''; };
showView(false);

async function load() {
  const range = currentRange();
  // Đọc cả kỳ so sánh (tối đa 31 ngày trước) trong một lượt.
  const span = { from: addDays(range.from, -31), to: range.to };
  $('status').textContent = 'Đang đọc số từ app Order...';
  try {
    const [settings, src, expenses] = await Promise.all([
      readSettings(client),
      readSupabaseOrders(new SupabaseOrderReader(client, rangeToIso(span))),
      readExpenses(client, { fromDate: span.from, toDate: span.to }),
    ]);
    if (src.status !== 'ok' && /đăng nhập/i.test(src.error)) return showLogin(src.error);
    const d = buildOwnerDashboard({
      orders: src.orders, expenses, range, now: new Date().toISOString(), syncedAt: src.syncedAt,
      grabFeeRate: Number(settings?.grab_fee_rate ?? 0), sourceStatus: src.status, sourceError: src.error,
    });
    render(d, settings);
    $('status').textContent = '';
    await loadShift();
    loadInventory();
    loadLedger();
  } catch (err) {
    if (/đăng nhập/i.test(err.message)) return showLogin(err.message);
    $('status').textContent = `Không đọc được số: ${err.message}. Bấm Tải lại để thử lại.`;
  }
}

function delta(v, label) {
  if (v === null || v === undefined) return `<span class="muted small">chưa có ${label}</span>`;
  const cls = v >= 0 ? 'up' : 'down';
  return `<span class="${cls} small">${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}% ${label}</span>`;
}

const table = (head, rows) => rows.length
  ? `<table class="${head.length >= 5 ? 'stack' : ''}"><thead><tr>${head.map(([h, n]) => `<th class="${n ? 'n' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${head[i][1] ? 'n' : ''}" data-label="${esc(String(head[i][0]).replace(/<[^>]*>/g, ''))}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  : '<p class="muted">Không có dữ liệu.</p>';

const KIND = { data: 'Dữ liệu lệch', refund: 'Kiểm hoàn tiền', unpaid: 'Chưa thu', stale: 'Đơn treo', no_cost: 'Thiếu giá vốn' };

// Biểu đồ cột doanh thu theo ngày: có trục, vạch lưới, nhãn ngày, chạm/di chuột để xem số.
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}tr` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
function niceMax(v) {
  if (v <= 0) return 100000;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v);
}
let dayData = [];
function renderDays(days) {
  dayData = days;
  if (!days.length) { $('days').innerHTML = '<p class="muted">Chưa có ngày nào.</p>'; $('dayReadout').textContent = ''; return; }
  const top = niceMax(Math.max(...days.map((x) => x.revenue)));
  const t = today();
  const every = days.length > 16 ? Math.ceil(days.length / 8) : 1;
  const grid = [1, 0.5, 0].map((f) => `<div class="g" style="bottom:${f * 100}%"><span>${f ? short(top * f) : '0'}</span></div>`).join('');
  const bars = days.map((x, i) => `<button type="button" class="bar${x.date === t ? ' today' : ''}${x.revenue ? '' : ' zero'}" data-i="${i}"
    aria-label="${dm(x.date)}: ${vnd(x.revenue)}, ${x.orders} đơn"><i style="height:${(x.revenue / top) * 100}%"></i>
    <span class="x">${x.date === t || (i % every === 0 && days[i + 1]?.date !== t) ? Number(x.date.slice(8)) : ''}</span></button>`).join('');
  $('days').innerHTML = `<div class="plot">${grid}<div class="cols">${bars}</div></div>`;
  const best = days.reduce((a, x, i) => (x.revenue > days[a].revenue ? i : a), 0);
  showDay(best, true);
}
function showDay(i, isBest = false) {
  const x = dayData[i]; if (!x) return;
  for (const b of $('days').querySelectorAll('.bar')) b.classList.toggle('sel', Number(b.dataset.i) === i);
  const total = dayData.reduce((s, y) => s + y.revenue, 0);
  $('dayReadout').innerHTML = `<b>${dm(x.date)}${x.date === today() ? ' (hôm nay)' : ''}</b> · ${vnd(x.revenue)} · ${x.orders} đơn${isBest ? ' <span class="muted">(ngày cao nhất)</span>' : ''}<span class="muted"> · cả kỳ ${vnd(total)}, TB ${vnd(Math.round(total / dayData.length))}/ngày</span>`;
}
$('days').addEventListener('click', (e) => { const b = e.target.closest('.bar'); if (b) showDay(Number(b.dataset.i)); });
$('days').addEventListener('mouseover', (e) => { const b = e.target.closest('.bar'); if (b) showDay(Number(b.dataset.i)); });
$('days').addEventListener('focusin', (e) => { const b = e.target.closest('.bar'); if (b) showDay(Number(b.dataset.i)); });

function render(d, settings) {
  $('login').hidden = true;
  $('app').hidden = false;
  $('navToggle').hidden = false;
  $('logout').hidden = false;
  const cmp = d.previousRange.partial ? `cùng ${d.days.length} ngày kỳ trước` : 'kỳ trước';
  $('meta').textContent = `${spanText(d.range.from, d.range.to)} · so với ${spanText(d.previousRange.from, d.previousRange.to)} · đọc lúc ${fmtTime(d.syncedAt)} · đơn mới nhất ${fmtTime(d.lastOrderAt)}`;
  $('meta').title = settings?.shop_name || 'THE KHE';
  $('warnings').innerHTML = d.warnings.map((w) => `<div class="warn ${d.sourceStatus !== 'ok' && w.startsWith('Nguồn') ? 'bad' : ''}">${esc(w)}</div>`).join('');
  const k = d.kpi;
  const est = (on) => (on ? '<span class="tag">ước tính</span>' : '');
  const hero = [
    ['Doanh thu ghi nhận', vnd(k.revenue), delta(d.change.revenue, cmp)],
    ['Lãi gộp (sau giá vốn)', vnd(k.grossProfit), delta(d.change.grossProfit, cmp)],
    [`Lãi ròng quản trị${est(!d.complete || d.estimated)}`, vnd(k.netProfit), d.complete ? '<span class="muted small">sau chi phí</span>' : '<span class="muted small">chi phí kỳ chưa nhập đủ</span>'],
    ['Số đơn hoàn tất', k.orders, delta(d.change.orders, cmp)],
  ];
  const minor = [
    ['Giá trị TB/đơn', vnd(k.avgTicket), delta(d.change.avgTicket, cmp)],
    [`Lãi đóng góp${est(k.grabRevenue > 0)}`, vnd(k.contribution), '<span class="muted small">sau phí Grab</span>'],
    ['Chi phí đã nhập', vnd(k.expenses), ''],
    ['Tiền về tại quầy', vnd(k.cashIn.cash + k.cashIn.transfer), `<span class="muted small">TM ${vnd(k.cashIn.cash)} · CK ${vnd(k.cashIn.transfer)}</span>`],
    [`Grab còn phải trả${est(k.grabRevenue > 0)}`, vnd(k.grabReceivableEstimate), ''],
    ['Giảm giá đã cho', vnd(k.discounts), ''],
  ];
  const kpiHtml = (cards) => cards.map(([l, v, s]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${s}</div>`).join('');
  $('kpis').innerHTML = kpiHtml(hero);
  $('kpis2').innerHTML = kpiHtml(minor);

  renderDays(d.days);

  $('channels').innerHTML = table([['Kênh'], ['Đơn', 1], ['Doanh thu', 1], ['Lãi gộp', 1]],
    d.channels.map((c) => [esc(c.label), c.orders, vnd(c.revenue), vnd(c.revenue - c.cost)]));

  $('issueCount').textContent = d.issues.length;
  badge('tong-quan', d.issues.length);
  const issueRows = d.issues.map((i) => [`#${esc(i.orderNumber)}`, esc(i.businessDate), esc(i.channel), `<b>${KIND[i.kind]}</b> ${esc(i.label)}`, vnd(i.amount)]);
  $('issues').innerHTML = d.issues.length ? table([['Đơn'], ['Ngày'], ['Kênh'], ['Vấn đề'], ['Tiền', 1]], issueRows) : '<p class="muted">Không có đơn lệch trong kỳ.</p>';

  const itemRows = (xs) => xs.map((i) => [esc(i.name), i.qty, vnd(i.listRevenue), vnd(i.margin)]);
  const head = [['Món'], ['SL', 1], ['Doanh thu', 1], ['Lãi gộp', 1]];
  // Chia đôi danh sách đã xếp theo lãi: nửa trên là bán chạy, phần còn lại (đảo ngược) là lãi thấp.
  const nTop = Math.min(5, Math.ceil(d.items.length / 2));
  $('topItems').innerHTML = table(head, itemRows(d.items.slice(0, nTop)));
  $('lowItems').innerHTML = d.items.length > nTop
    ? table(head, itemRows(d.items.slice(nTop).reverse().slice(0, 5)))
    : '<p class="muted">Chưa đủ món để so sánh.</p>';

  $('expenses').innerHTML = d.expenseByCategory.length
    ? table([['Nhóm'], ['Số khoản', 1], ['Tổng', 1]], d.expenseByCategory.map((e) => [esc(e.category), e.count, vnd(e.amount)]))
    : '<p class="muted">Chưa có khoản chi nào trong kỳ. Nhập chi phí ở app tài chính để lãi ròng đầy đủ.</p>';
}

// ===== Ticket 3: sổ đối soát Grab và chốt kỳ (ghi qua RPC ops_*) =====
const FIELD = {
  line_type: 'Loại dòng', order_ref: 'Mã đơn', period: 'Kỳ', payout_id: 'Đợt trả', received_date: 'Ngày tiền về',
  platform_fee: 'Phí sàn', platform_funded_support: 'Trợ giá sàn chịu', tax_withheld: 'Thuế nộp thay', amount_paid: 'Tiền trả',
};
const ACTION = {
  import: 'Nhập file', import_duplicate_file: 'Nhập trùng file (bỏ qua)', import_blocked_locked: 'Nhập vào kỳ đã khóa (bị chặn)',
  apply_revisions: 'Áp dụng bản sửa', discard_revisions: 'Bỏ bản sửa', lock_period: 'Chốt kỳ', reopen_period: 'Mở lại kỳ',
};
const fmtVal = (f, v) => (v == null ? '-' : typeof v === 'number' && f !== 'period' ? vnd(v) : esc(v));
let ledgerReport = null;
let pendingFile = null;

const period = () => $('month').value || today().slice(0, 7);

async function loadLedger() {
  const p = period();
  $('ledgerPeriod').textContent = p;
  $('ledgerStatus').innerHTML = '<p class="muted small">Đang đọc sổ đối soát...</p>';
  try {
    const end = monthRange(p).to;
    const [ledger, src] = await Promise.all([
      store.load(),
      readSupabaseOrders(new SupabaseOrderReader(client, rangeToIso({ from: '2024-01-01', to: end }))),
    ]);
    const close = ledger.closes.find((c) => c.period === p);
    const start = shiftState.startDate;
    const kept = applyStartDate({ orders: ordersForReconcile(src.orders), lines: ledger.lines }, start);
    const openMonth = shiftState.open ? fmtDate(shiftState.open.opened_at).slice(0, 7) : null;
    const live = buildReconcileReport({
      period: p,
      orderSync: { ...src, orders: kept.orders, source: 'supabase:orders' },
      lines: kept.lines,
      pendingRevisionCount: ledger.pending.length,
      locked: close?.status === 'locked',
      openShift: openMonth != null && openMonth <= p,
      beforeStart: start != null && p < start.slice(0, 7),
    });
    if (start) live.startDate = start;
    ledgerReport = live;
    renderLedger(live, close, ledger);
  } catch (err) {
    if (/đăng nhập/i.test(err.message)) return showLogin(err.message);
    $('ledgerStatus').innerHTML = `<div class="warn bad">Không đọc được sổ đối soát: ${esc(err.message)}. Bấm Tải lại để thử lại.</div>`;
  }
}

function renderLedger(live, close, ledger) {
  const locked = close?.status === 'locked';
  // Kỳ đã khóa hiện đúng số lúc chốt, không đổi dù dữ liệu nguồn thay đổi sau đó.
  const r = locked ? close.snapshot : live;
  const notes = [];
  if (locked) notes.push(`<div class="ok">Đã chốt lúc ${fmtTime(close.locked_at)}. Số bên dưới là số lúc chốt.</div>`);
  else if (close?.status === 'reopened') notes.push(`<div class="warn">Kỳ đã mở lại lúc ${fmtTime(close.reopened_at)}. Lý do: ${esc(close.reopen_reason)}</div>`);
  if (!locked) {
    for (const b of live.blockers) notes.push(`<div class="warn bad">Chưa chốt được: ${esc(b)}</div>`);
    for (const w of live.warnings) notes.push(`<div class="warn">${esc(w)}</div>`);
    if (live.closeable) notes.push('<div class="ok">Đủ điều kiện chốt kỳ.</div>');
  }
  if (!locked && live.startDate) notes.unshift(`<div class="muted small">Sổ tính từ ${esc(live.startDate)}; dữ liệu trước ngày này bị bỏ qua.</div>`);
  $('ledgerStatus').innerHTML = notes.join('');
  const est = (on) => (on ? '<span class="tag">ước tính</span>' : '');
  $('ledgerKpis').innerHTML = [
    ['Doanh thu quản trị', vnd(r.revenue)],
    [`Lãi đóng góp${est(r.contributionEstimated)}`, vnd(r.contribution)],
    ['Tiền nhận trong kỳ', `${vnd(r.cashReceived.total)}<div class="muted small">quầy ${vnd(r.cashReceived.counter)} · Grab ${vnd(r.cashReceived.platformPayout)}</div>`],
    [`Grab còn phải trả${est(r.receivableEstimated)}`, vnd(r.platformReceivable)],
    ['Phí sàn (theo file)', vnd(r.platformFee)],
    ['Thuế sàn nộp thay', `${vnd(r.taxWithheld)}<div class="muted small">hiện riêng, không trừ doanh thu</div>`],
  ].map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
  $('lockBtn').hidden = locked;
  $('lockBtn').disabled = !live.closeable;
  $('reopenBtn').hidden = !locked;

  $('revisions').innerHTML = ledger.pending.length
    ? `<h3>Bản sửa chờ xác nhận</h3>${[...new Set(ledger.pending.map((x) => x.batch_id))].map((bid) => {
        const rows = ledger.pending.filter((x) => x.batch_id === bid).flatMap((x) => x.changes.map((c) => [esc(x.source_line_id), FIELD[c.field] ?? esc(c.field), fmtVal(c.field, c.before), fmtVal(c.field, c.after)]));
        return `${table([['Mã dòng'], ['Trường'], ['Trước'], ['Sau']], rows)}<div class="row"><button data-apply="${esc(bid)}">Xác nhận áp dụng</button><button class="ghost" data-discard="${esc(bid)}">Bỏ bản sửa</button></div>`;
      }).join('')}`
    : '';

  const res = locked ? [] : live.resolution;
  $('resolution').innerHTML = res.length
    ? table([['Loại'], ['Mã dòng/đơn'], ['Chi tiết']], res.map((x) => [esc(x.type), esc(x.sourceLineId ?? `#${x.orderId}`), esc(x.message)]))
    : '<p class="muted">Không có mục nào.</p>';
  $('batches').innerHTML = ledger.batches.length
    ? table([['Lúc'], ['File'], ['Kỳ'], ['Thêm', 1], ['Trùng', 1], ['Sửa', 1], ['Loại', 1]], ledger.batches.map((b) => [fmtTime(b.created_at), esc(b.file_name), esc(b.periods.join(', ')), b.added, b.duplicates, b.revisions, b.rejected]))
    : '<p class="muted">Chưa nhập file nào.</p>';
  $('audit').innerHTML = ledger.audit.length
    ? `<h3>Nhật ký</h3>${table([['Lúc'], ['Việc'], ['Chi tiết']], ledger.audit.map((a) => [fmtTime(a.created_at), ACTION[a.action] ?? esc(a.action), esc(a.detail.file_name ?? a.detail.period ?? '') + (a.detail.reason ? ` · ${esc(a.detail.reason)}` : '')]))}`
    : '';
}

async function ledgerAction(fn, okMsg) {
  try {
    await fn();
    $('grabPreview').innerHTML = okMsg ? `<div class="ok">${okMsg}</div>` : '';
  } catch (err) {
    $('grabPreview').innerHTML = `<div class="warn bad">${esc(err.message)}</div>`;
  }
  loadLedger();
}

$('grabFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const text = await f.text();
  const pv = previewGrabFile(text);
  if (pv.fileError) { pendingFile = null; $('grabPreview').innerHTML = `<div class="warn bad">${esc(f.name)}: ${esc(pv.fileError)}</div>`; return; }
  pendingFile = { fileName: f.name, text };
  const rows = pv.lines.map((l) => [esc(l.sourceLineId), l.lineType === 'order' ? `#${esc(l.orderId)}` : 'Tổng kỳ', esc(l.period), esc(l.receivedDate ?? '-'), vnd(l.platformFee), vnd(l.taxWithheld), vnd(l.amountPaid)]);
  $('grabPreview').innerHTML = `<h3>Xem trước: ${esc(f.name)}</h3>
    <p class="small">${pv.lines.length} dòng hợp lệ, tổng tiền trả ${vnd(pv.total)}, kỳ ${esc(pv.periods.join(', ') || '-')}. ${pv.rejected.length} dòng bị loại.</p>
    ${table([['Mã dòng'], ['Đơn'], ['Kỳ'], ['Tiền về'], ['Phí', 1], ['Thuế', 1], ['Tiền trả', 1]], rows)}
    ${pv.rejected.length ? table([['Dòng'], ['Lý do bị loại']], pv.rejected.map((x) => [x.row, esc(x.errors.join('; '))])) : ''}
    <div class="row"><button id="confirmImport" ${pv.lines.length ? '' : 'disabled'}>Ghi vào sổ</button><button id="cancelImport" class="ghost">Hủy</button></div>`;
});

const IMPORT_MSG = {
  imported: (r) => `Đã ghi ${r.added} dòng mới, bỏ qua ${r.duplicates} dòng trùng.`,
  needs_review: (r) => `Đã ghi ${r.added} dòng mới. ${r.revisions} dòng có số khác bản cũ đang chờ xác nhận${r.rejected.length ? `, ${r.rejected.length} dòng bị loại` : ''}.`,
  duplicate_file: () => 'File này đã nhập trước đó, không ghi thêm gì.',
  period_locked: (r) => `Kỳ ${r.locked_periods.join(', ')} đã khóa, không ghi gì. Mở lại kỳ nếu cần sửa.`,
  file_error: (r) => `File lỗi: ${r.error}`,
};

$('grabPreview').addEventListener('click', (e) => {
  if (e.target.id === 'cancelImport') { pendingFile = null; $('grabPreview').innerHTML = ''; }
  if (e.target.id === 'confirmImport' && pendingFile) {
    e.target.disabled = true;
    const file = pendingFile;
    pendingFile = null;
    let msg = '';
    ledgerAction(async () => { const r = await store.importFile(file); msg = IMPORT_MSG[r.status]?.(r) ?? r.status; }, '')
      .then(() => { if (msg) $('grabPreview').innerHTML = `<div class="ok">${esc(msg)}</div>`; });
  }
});

$('revisions').addEventListener('click', (e) => {
  const apply = e.target.dataset.apply;
  const discard = e.target.dataset.discard;
  if (apply) ledgerAction(() => store.resolveRevisions(apply, true), 'Đã áp dụng bản sửa.');
  if (discard && confirm('Bỏ bản sửa này, giữ số cũ?')) ledgerAction(() => store.resolveRevisions(discard, false), 'Đã bỏ bản sửa, giữ số cũ.');
});

$('lockBtn').addEventListener('click', () => {
  if (!ledgerReport?.closeable) return;
  if (!confirm(`Chốt kỳ ${ledgerReport.period}? Sau khi chốt, số kỳ này giữ nguyên và không nhập thêm file vào kỳ được nữa.`)) return;
  ledgerAction(() => store.lockPeriod(ledgerReport.period, ledgerReport), `Đã chốt kỳ ${esc(ledgerReport.period)}.`);
});

$('reopenBtn').addEventListener('click', () => {
  const reason = prompt(`Lý do mở lại kỳ ${period()} (bắt buộc):`);
  if (reason == null) return;
  ledgerAction(() => store.reopenPeriod(period(), reason), `Đã mở lại kỳ ${esc(period())}.`);
});

// ===== Ticket 4: ca và tiền mặt tại két (ghi qua RPC ops_*) =====
async function loadShift() {
  try {
    shiftState = await shifts.load();
    let orders = [];
    if (shiftState.open) {
      const from = fmtDate(shiftState.open.opened_at);
      const src = await readSupabaseOrders(new SupabaseOrderReader(client, rangeToIso({ from, to: addDays(today(), 1) })));
      orders = src.orders;
    }
    renderShift(orders);
  } catch (err) {
    if (/đăng nhập/i.test(err.message)) return showLogin(err.message);
    $('shiftStatus').innerHTML = `<div class="warn bad">Không đọc được ca: ${esc(err.message)}</div>`;
  }
}

function renderShift(orders) {
  const { open, moves, recent, startDate } = shiftState;
  $('startDate').value = startDate ?? '';
  $('shiftState').textContent = open ? 'đang mở' : 'chưa mở ca';
  badge('ca', open ? 'mở' : '');
  $('openShiftForm').hidden = !!open;
  $('shiftOpen').hidden = !open;
  $('shiftStatus').innerHTML = startDate ? '' : '<div class="warn">Chưa đặt ngày bắt đầu sổ. Đặt ở phần Đối soát bên dưới để bỏ qua dữ liệu cũ.</div>';
  if (open) {
    const p = shiftPreview({ shift: open, orders, moves });
    $('shiftStatus').innerHTML += `<p class="muted small">Mở lúc ${fmtTime(open.opened_at)}${open.open_note ? ` · ${esc(open.open_note)}` : ''}. Số dự kiến là tạm tính; số chính thức do hệ thống tính lúc chốt ca.</p>`;
    $('shiftKpis').innerHTML = [
      ['Tiền đầu ca', vnd(p.openingCash)],
      ['Bán tiền mặt', `${vnd(p.cashSales)}<div class="muted small">${p.cashSalesCount} đơn</div>`],
      ['Nộp thêm', vnd(p.cashIn)],
      ['Chi và rút', vnd(p.cashOut)],
      ['Két dự kiến', `<b>${vnd(p.expectedCash)}</b>`],
      ['Đơn chưa thu', p.unpaidCount ? `<span class="down">${p.unpaidCount}</span>` : '0'],
    ].map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
    $('moves').innerHTML = moves.length
      ? table([['Lúc'], ['Loại'], ['Nội dung'], ['Nhóm'], ['Tiền', 1]], moves.map((m) => [fmtTime(m.created_at), MOVE_KIND[m.kind], esc(m.note), esc(m.category), (m.kind === 'deposit' ? '+' : '-') + vnd(m.amount)]))
      : '<p class="muted small">Chưa có khoản chi, rút hay nộp nào trong ca.</p>';
    $('closeShiftForm').dataset.expected = p.expectedCash;
  }
  $('shiftHistory').innerHTML = recent.length
    ? table([['Mở'], ['Chốt'], ['Đầu ca', 1], ['Bán TM', 1], ['Dự kiến', 1], ['Đếm được', 1], ['Lệch', 1], ['Ghi chú']],
      recent.map((x) => [fmtTime(x.opened_at), fmtTime(x.closed_at), vnd(x.opening_cash), vnd(x.cash_sales), vnd(x.expected_cash), vnd(x.counted_cash),
        `<span class="${x.variance ? 'down' : ''}">${vnd(x.variance)}</span>`, esc(x.close_note)]))
    : '<p class="muted">Chưa có ca nào đã chốt.</p>';
}

async function shiftAction(fn, okMsg) {
  try {
    const msg = await fn();
    $('shiftMsg').innerHTML = `<div class="ok">${esc(okMsg ?? msg)}</div>`;
  } catch (err) {
    $('shiftMsg').innerHTML = `<div class="warn bad">${esc(err.message)}</div>`;
  }
  await loadShift();
  loadInventory();
  loadLedger();
}

$('openShiftForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const cash = parseVndInput(f.get('cash'));
  if (cash == null) { $('shiftMsg').innerHTML = '<div class="warn bad">Tiền đầu ca phải là số, vd 500000.</div>'; return; }
  shiftAction(() => shifts.openShift(cash, f.get('note')), `Đã mở ca với ${vnd(cash)} đầu ca.`).then(() => e.target.reset());
});

$('moveForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const amount = parseVndInput(f.get('amount'));
  if (!amount) { $('shiftMsg').innerHTML = '<div class="warn bad">Số tiền phải lớn hơn 0.</div>'; return; }
  const kind = f.get('kind');
  const move = { kind, amount, note: f.get('note'), category: f.get('category') || 'Khác' };
  const extra = kind === 'expense' ? ', đã ghi vào chi phí của quán' : '';
  shiftAction(() => shifts.addMove(shiftState.open.id, move), `Đã ghi ${MOVE_KIND[kind].toLowerCase()} ${vnd(amount)}${extra}.`).then(() => e.target.reset());
});

$('closeShiftForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const counted = parseVndInput(f.get('counted'));
  if (counted == null) { $('shiftMsg').innerHTML = '<div class="warn bad">Tiền đếm được phải là số.</div>'; return; }
  const diff = counted - Number(e.target.dataset.expected);
  const warnDiff = diff ? ` Đang lệch khoảng ${vnd(diff)} so với tạm tính.` : '';
  if (!confirm(`Chốt ca với ${vnd(counted)} trong két?${warnDiff} Sau khi chốt không ghi thêm vào ca này được.`)) return;
  shiftAction(async () => {
    const r = await shifts.closeShift(shiftState.open.id, counted, f.get('note'));
    return `Đã chốt ca. Dự kiến ${vnd(r.expected_cash)}, đếm được ${vnd(r.counted_cash)}, lệch ${vnd(r.variance)}.`;
  }).then(() => e.target.reset());
});

$('saveStartDate').addEventListener('click', () => {
  const d = $('startDate').value;
  if (!d) { $('grabPreview').innerHTML = '<div class="warn bad">Chọn ngày bắt đầu sổ trước.</div>'; return; }
  shiftAction(() => shifts.setStartDate(d), `Đã đặt ngày bắt đầu sổ ${d}.`);
});

// ===== Ticket 5: kho, công thức món và giá vốn (ghi qua RPC ops_*) =====
const qtyFmt = (n, unit) => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Number(n))} ${unit}`;
const invMsg = (html) => { $('invMsg').innerHTML = html; };
const options = (items, sel = '') => items.map((i) => `<option value="${esc(i.value)}"${i.value === sel ? ' selected' : ''}>${esc(i.label)}</option>`).join('');

async function loadInventory() {
  try {
    await inventory.sync();
    inv = await inventory.load(currentRange());
    renderInventory();
    refreshAssistant();
  } catch (err) {
    $('invWarn').innerHTML = `<div class="warn bad">Không đọc được kho: ${esc(err.message)}</div>`;
  }
}

function renderInventory() {
  const { levels, recipes, products, moves, postings } = inv;
  const stock = stockStatus(levels);
  const active = levels.filter((l) => l.active);
  const byId = new Map(levels.map((l) => [l.ingredient_id, l]));
  const c = cogsSummary(moves);
  const missing = missingRecipes(postings);
  const low = stock.filter((x) => x.low || x.negative);
  $('invState').textContent = levels.length ? `${active.length} nguyên liệu` : 'chưa có nguyên liệu';
  badge('kho', low.length);
  badge('cong-thuc', missing.length);
  const warns = [];
  if (!levels.length) warns.push('<div class="warn">Chưa có nguyên liệu. Mở "Nguyên liệu" để thêm, sau đó nhập công thức món và nhập hàng đầu kỳ.</div>');
  if (missing.length) warns.push(`<div class="warn">Món đã bán chưa có công thức nên chưa trừ kho: ${missing.slice(0, 8).map((m) => `${esc(m.name)} (${m.orders} đơn)`).join(', ')}${missing.length > 8 ? ', ...' : ''}. Nhập công thức trước lần kiểm kê tới thì các đơn này sẽ được trừ bù.</div>`);
  if (stock.some((x) => x.negative)) warns.push('<div class="warn bad">Có nguyên liệu tồn âm: bán nhiều hơn số đã nhập. Kiểm tra nhập hàng hoặc kiểm kê lại.</div>');
  $('invWarn').innerHTML = warns.join('');
  $('invKpis').innerHTML = [
    ['Giá vốn theo kho', vnd(c.sold)], ['Hủy/hao hụt', vnd(c.waste)], ['Lệch kiểm kê', vnd(c.countLoss)],
    ['Nhập hàng trong kỳ', vnd(c.purchases)], ['Giá trị tồn hiện tại', vnd(stock.reduce((s, x) => s + Math.max(x.value, 0), 0))],
    ['Cần nhập thêm', String(low.length)],
  ].map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
  $('invStock').innerHTML = table([['Nguyên liệu'], ['Tồn', 1], ['Giá bình quân', 1], ['Giá trị', 1], ['Kiểm kê gần nhất']],
    stock.map((x) => [
      `${esc(x.name)}${x.negative ? '<span class="tag">âm</span>' : x.low ? '<span class="tag">sắp hết</span>' : ''}`,
      qtyFmt(x.onHand, x.unit), `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(x.avg_cost))}đ/${esc(x.unit)}`,
      vnd(x.value), x.last_count_at ? fmtTime(x.last_count_at) : '<span class="muted">chưa</span>',
    ]));

  const ingOpts = options(active.map((l) => ({ value: l.ingredient_id, label: `${l.name} (${l.unit})` })));
  for (const f of ['purchaseForm', 'wasteForm']) {
    const sel = $(f).elements.ingredient; const keep = sel.value;
    sel.innerHTML = ingOpts; if (keep && active.some((l) => l.ingredient_id === keep)) sel.value = keep;
  }
  syncPurchaseUnits();
  $('countRows').innerHTML = active.length ? table([['Nguyên liệu'], ['Sổ', 1], ['Đếm được', 1]], active.map((l) => [
    esc(l.name), qtyFmt(l.on_hand, l.unit), `<input name="c_${esc(l.ingredient_id)}" inputmode="decimal" aria-label="Đếm ${esc(l.name)}" style="max-width:120px;margin-left:auto">`,
  ])) : '<p class="muted">Chưa có nguyên liệu.</p>';
  const ingSel = $('ingForm').elements.id; const keepIng = ingSel.value;
  ingSel.innerHTML = '<option value="">+ Nguyên liệu mới</option>' + options(levels.map((l) => ({ value: l.ingredient_id, label: `${l.name}${l.active ? '' : ' (ngừng)'}` })), keepIng);
  renderIngredients();

  // Cả món đang ẩn (vd món theo mùa) để sửa được công thức đã nhập từ sổ.
  const prodSel = $('recipeForm').elements.product; const keepProd = prodSel.value;
  const listed = [...products].sort((a, b) => Number(b.active) - Number(a.active));
  prodSel.innerHTML = options(listed.map((p) => ({ value: p.id, label: `${p.category} · ${p.name}${p.active ? '' : ' (đang ẩn)'}${recipeAt(recipes, p.id, today()) ? '' : ' (chưa có)'}` })), keepProd);
  if (!$('recipeForm').elements.from.value) $('recipeForm').elements.from.value = today();
  fillRecipe();

  const rows = menuCostTable({ products, recipes, ingredients: levels, date: today() });
  $('menuCost').innerHTML = table([['Món'], ['Giá bán', 1], ['Giá vốn app', 1], ['Theo công thức', 1], ['Chênh', 1], ['Lãi gộp', 1]],
    rows.map((r) => [
      `<button type="button" class="linkish" data-pid="${esc(r.id)}">${esc(r.name)}</button> <span class="muted small">${esc(r.category)}</span>${r.unpriced ? '<span class="tag">NL chưa có giá</span>' : ''}`,
      vnd(r.price), vnd(r.appCost), r.hasRecipe ? vnd(r.recipeCost) : '<span class="muted">chưa có</span>',
      r.diff == null ? '-' : `<span class="${r.diff > 0 ? 'down' : ''}">${r.diff > 0 ? '+' : ''}${vnd(r.diff)}</span>`,
      r.marginPct == null ? '-' : `${r.marginPct}%`,
    ]));
  const shown = moves.filter((m) => m.kind !== 'sale').slice(0, 200);
  const sales = moves.filter((m) => m.kind === 'sale').length;
  $('invMoves').innerHTML = `<p class="muted small">${sales} dòng trừ kho do bán (không liệt kê).</p>` + table([['Lúc'], ['Loại'], ['Nguyên liệu'], ['Số lượng', 1], ['Giá trị', 1], ['Ghi chú']],
    shown.map((m) => { const l = byId.get(m.ingredient_id); return [
      fmtTime(m.created_at), MOVE_LABEL[m.kind] ?? m.kind, esc(l?.name ?? '?'), qtyFmt(m.qty, l?.unit ?? ''), vnd(m.value), esc([m.supplier, m.note].filter(Boolean).join(' · ')),
    ]; }));
}

function syncPurchaseUnits() {
  const f = $('purchaseForm').elements; const l = inv?.levels.find((x) => x.ingredient_id === f.ingredient.value);
  const units = Object.keys(PURCHASE_UNITS[l?.unit] ?? {});
  if ([...f.unit.options].map((o) => o.value).join() !== units.join()) f.unit.innerHTML = options(units.map((u) => ({ value: u, label: u })));
}

const numText = (n) => (n == null ? '' : String(Number(n)).replace('.', ','));

function recipeLine(line = {}) {
  const active = inv.levels.filter((l) => l.active || l.ingredient_id === line.ingredientId);
  const how = [{ value: '', label: 'theo cân/đong' }, ...Object.entries(MEASURES).map(([value, label]) => ({ value, label }))];
  return `<div class="rline"><select name="ing" aria-label="Nguyên liệu"><option value="">Chọn nguyên liệu</option>${options(active.map((l) => ({ value: l.ingredient_id, label: `${l.name} (${l.unit})` })), line.ingredientId)}</select>`
    + `<input name="qty" inputmode="decimal" placeholder="Lượng" aria-label="Lượng" value="${numText(line.measure ? line.measureCount : line.qty)}">`
    + `<span class="howc"><select name="how" aria-label="Đong bằng">${options(how, line.measure ?? '')}</select><span class="conv" aria-live="polite"></span></span>`
    + '<button type="button" class="icon rm" aria-label="Bỏ dòng" title="Bỏ dòng"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
}

// Đơn vị hiện cạnh ô số và lượng quy đổi khi đong bằng muỗng/vợt.
function syncRecipeRows() {
  for (const row of $('recipeRows').querySelectorAll('.rline')) {
    const l = inv.levels.find((x) => x.ingredient_id === row.querySelector('[name=ing]').value);
    const how = row.querySelector('[name=how]').value;
    row.querySelector('[name=how] option[value=""]').textContent = l ? `${l.unit} (cân/đong)` : 'theo cân/đong';
    const n = parseQtyInput(row.querySelector('[name=qty]').value);
    row.querySelector('.conv').textContent = how && l && n ? `= ${qtyFmt(Math.round(n * measureSize(l, how) * 1000) / 1000, l.unit)}` : '';
  }
}

function fillRecipe() {
  const f = $('recipeForm').elements;
  const lines = recipeAt(inv.recipes, f.product.value, f.from.value || today()) ?? [];
  $('recipeRows').innerHTML = (lines.length ? lines : [{}]).map(recipeLine).join('');
  syncRecipeRows();
  updateRecipeCost();
}

function readRecipeLines() {
  const out = [];
  for (const row of $('recipeRows').querySelectorAll('.rline')) {
    const id = row.querySelector('[name=ing]').value; const raw = row.querySelector('[name=qty]').value.trim();
    const how = row.querySelector('[name=how]').value;
    if (!id && !raw) continue;
    const n = parseQtyInput(raw);
    if (!id || !n) throw new Error('Mỗi dòng công thức cần nguyên liệu và định lượng lớn hơn 0.');
    const l = inv.levels.find((x) => x.ingredient_id === id);
    out.push(how ? { ingredientId: id, measure: how, measureCount: n, qty: Math.round(n * measureSize(l, how) * 1000) / 1000 } : { ingredientId: id, qty: n });
  }
  return out;
}

function updateRecipeCost() {
  try {
    const cost = recipeCost(readRecipeLines(), new Map(inv.levels.map((l) => [l.ingredient_id, l])));
    const p = inv.products.find((x) => x.id === $('recipeForm').elements.product.value);
    $('recipeCost').textContent = `Giá vốn theo giá bình quân hiện tại: ${vnd(cost)}${p ? ` · giá app ${vnd(Number(p.cost ?? 0))}` : ''}`;
  } catch { $('recipeCost').textContent = ''; }
}

async function invAction(fn) {
  try {
    const msg = await fn();
    invMsg(`<div class="ok">${esc(msg)}</div>`);
    inv = await inventory.load(currentRange());
    renderInventory();
    return true;
  } catch (err) {
    invMsg(`<div class="warn bad">${esc(err.message)}</div>`);
    return false;
  }
}

$('purchaseForm').elements.ingredient.addEventListener('change', syncPurchaseUnits);
$('purchaseForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements; const l = inv.levels.find((x) => x.ingredient_id === f.ingredient.value);
  const qty = parseQtyInput(f.qty.value, f.unit.value, l?.unit); const total = parseVndInput(f.total.value);
  if (!l || !qty) return invMsg('<div class="warn bad">Số lượng phải lớn hơn 0, vd 1,5.</div>');
  if (total == null) return invMsg('<div class="warn bad">Tổng tiền phải là số, vd 180000.</div>');
  const avg = weightedAvgCost(l.on_hand, l.avg_cost, qty, total);
  invAction(async () => {
    const r = await inventory.purchase({ ingredientId: l.ingredient_id, qty, total, supplier: f.supplier.value });
    return `Đã nhập ${qtyFmt(qty, l.unit)} ${l.name}, ${vnd(total)}. Giá bình quân mới ${Number(r?.avg_cost ?? avg).toLocaleString('vi-VN')}đ/${l.unit}.`;
  }).then((ok) => ok && e.target.reset());
});

$('wasteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements; const l = inv.levels.find((x) => x.ingredient_id === f.ingredient.value);
  const qty = parseQtyInput(f.qty.value);
  if (!l || !qty) return invMsg('<div class="warn bad">Số lượng hủy phải lớn hơn 0.</div>');
  invAction(async () => { await inventory.waste(l.ingredient_id, qty, f.reason.value); return `Đã ghi hủy ${qtyFmt(qty, l.unit)} ${l.name}.`; })
    .then((ok) => ok && e.target.reset());
});

$('countForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const lines = [];
  for (const l of inv.levels.filter((x) => x.active)) {
    const raw = e.target.elements[`c_${l.ingredient_id}`]?.value.trim();
    if (!raw) continue;
    const counted = parseQtyInput(raw);
    if (counted == null) return invMsg(`<div class="warn bad">Số đếm của ${esc(l.name)} không hợp lệ.</div>`);
    lines.push({ ingredientId: l.ingredient_id, counted });
  }
  if (!lines.length) return invMsg('<div class="warn bad">Chưa nhập số đếm nào.</div>');
  invAction(async () => {
    const r = await inventory.count(lines, e.target.elements.note.value) ?? [];
    const diff = r.filter((x) => Number(x.diff) !== 0);
    return diff.length ? `Đã ghi kiểm kê ${r.length} nguyên liệu, lệch: ${diff.map((x) => `${x.ingredient} ${Number(x.diff) > 0 ? '+' : ''}${qtyFmt(x.diff, x.unit)} (${vnd(Number(x.value))})`).join('; ')}.`
      : `Đã ghi kiểm kê ${r.length} nguyên liệu, khớp sổ.`;
  }).then((ok) => ok && e.target.reset());
});

// Nguyên liệu dùng trong công thức hiện hành, và dụng cụ đong đang dùng.
function ingredientUse() {
  const use = new Map();
  for (const p of inv.products) for (const l of recipeAt(inv.recipes, p.id, today()) ?? []) {
    const u = use.get(l.ingredientId) ?? { products: 0, measures: new Set() };
    u.products += 1; if (l.measure) u.measures.add(l.measure);
    use.set(l.ingredientId, u);
  }
  return use;
}

function measureText(l, only = null) {
  return Object.keys(MEASURES).filter((m) => !only || only.has(m))
    .map((m) => `${MEASURES[m]} ${qtyFmt(measureSize(l, m), l.unit)}${Number(l.measures?.[m]) > 0 ? '' : ' (mặc định)'}`).join(' · ');
}

function renderIngredients() {
  const use = ingredientUse();
  const q = normText($('ingSearch').value);
  const rows = inv.levels.filter((l) => !q || normText(l.name).includes(q));
  const guess = inv.levels.filter((l) => [...(use.get(l.ingredient_id)?.measures ?? [])].some((m) => !(Number(l.measures?.[m]) > 0)));
  badge('nguyen-lieu', guess.length);
  $('ingCount').textContent = `${inv.levels.length}`;
  $('ingList').innerHTML = (guess.length ? `<div class="warn">${guess.length} nguyên liệu đang đong bằng muỗng/vợt theo cỡ mặc định (ước lượng khi nhập sổ). Cân thử một lần rồi nhập cỡ thật để giá vốn sát hơn.</div>` : '')
    + table([['Nguyên liệu'], ['Đơn vị'], ['Tồn', 1], ['Dùng trong'], ['Đong bằng dụng cụ'], ['']], rows.map((l) => {
      const u = use.get(l.ingredient_id);
      const needs = [...(u?.measures ?? [])].some((m) => !(Number(l.measures?.[m]) > 0));
      return [
        `${esc(l.name)}${l.active ? '' : '<span class="tag">ngừng</span>'}`, esc(l.unit), qtyFmt(l.on_hand, l.unit),
        u ? `${u.products} món` : '<span class="muted">chưa dùng</span>',
        u?.measures.size ? `${needs ? '<span class="tag">cần chỉnh cỡ</span>' : ''}<span class="small">${esc(measureText(l, u.measures))}</span>` : '<span class="muted">-</span>',
        `<button type="button" class="ghost" data-edit="${esc(l.ingredient_id)}" aria-label="Sửa ${esc(l.name)}">Sửa</button>`,
      ];
    }));
}
const normText = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

function fillIngForm(id) {
  const f = $('ingForm').elements; const l = inv.levels.find((x) => x.ingredient_id === id);
  f.id.value = l ? id : '';
  f.name.value = l?.name ?? ''; f.unit.value = l?.unit ?? 'g'; f.low.value = l ? Number(l.low_stock) || '' : ''; f.active.checked = l ? l.active : true;
  for (const m of Object.keys(MEASURES)) f[`m_${m}`].value = l && Number(l.measures?.[m]) > 0 ? numText(l.measures[m]) : '';
  syncIngUnit();
  $('ingFormTitle').textContent = l ? `Sửa ${l.name}` : 'Thêm nguyên liệu mới';
}
function syncIngUnit() {
  const f = $('ingForm').elements;
  for (const el of $('ingForm').querySelectorAll('.mu, .mu2')) el.textContent = f.unit.value;
  const fake = { unit: f.unit.value, measures: {} };
  for (const m of Object.keys(MEASURES)) f[`m_${m}`].placeholder = numText(measureSize(fake, m));
}
$('ingForm').elements.id.addEventListener('change', (e) => fillIngForm(e.target.value));
$('ingForm').elements.unit.addEventListener('change', syncIngUnit);
$('ingForm').addEventListener('reset', () => setTimeout(() => fillIngForm(''), 0));
$('ingSearch').addEventListener('input', renderIngredients);
$('ingList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit]');
  if (!b) return;
  fillIngForm(b.dataset.edit);
  $('ingForm').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('ingForm').elements.name.focus({ preventScroll: true });
});
$('ingForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements; const low = f.low.value.trim() ? parseQtyInput(f.low.value) : 0;
  if (low == null) return invMsg('<div class="warn bad">Mức cảnh báo phải là số.</div>');
  const measures = {};
  for (const m of Object.keys(MEASURES)) {
    const raw = f[`m_${m}`].value.trim();
    if (!raw) continue;
    const n = parseQtyInput(raw);
    if (!n) return invMsg(`<div class="warn bad">Cỡ ${MEASURES[m]} phải là số lớn hơn 0, vd 12 hoặc 7,5.</div>`);
    measures[m] = n;
  }
  const old = inv.levels.find((x) => x.ingredient_id === f.id.value);
  const same = (a = {}, b = {}) => Object.keys(MEASURES).every((m) => (Number(a[m]) || 0) === (Number(b[m]) || 0));
  invAction(async () => {
    const id = await inventory.saveIngredient({ id: f.id.value || null, name: f.name.value.trim(), unit: f.unit.value, lowStock: low, active: f.active.checked });
    let extra = '';
    if (!same(old?.measures, measures) || (old && old.unit !== f.unit.value)) {
      const n = await inventory.setMeasures(id ?? f.id.value, measures);
      if (n) extra = ` Đã tính lại ${n} dòng công thức theo cỡ dụng cụ mới.`;
    }
    return `Đã lưu nguyên liệu ${f.name.value.trim()}.${extra}`;
  }).then((ok) => ok && fillIngForm(''));
});

$('recipeForm').elements.product.addEventListener('change', fillRecipe);
$('recipeForm').elements.from.addEventListener('change', fillRecipe);
$('recipeRows').addEventListener('input', () => { syncRecipeRows(); updateRecipeCost(); });
$('recipeRows').addEventListener('change', () => { syncRecipeRows(); updateRecipeCost(); });
$('recipeRows').addEventListener('click', (e) => { if (e.target.closest('.rm')) { e.target.closest('.rline').remove(); updateRecipeCost(); } });
$('addLine').addEventListener('click', () => {
  $('recipeRows').insertAdjacentHTML('beforeend', recipeLine());
  $('recipeRows').lastElementChild.querySelector('select').focus();
});
$('menuCost').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pid]');
  if (!b) return;
  $('recipeForm').elements.product.value = b.dataset.pid;
  $('recipeForm').elements.from.value = today();
  fillRecipe();
  $('recipeForm').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('recipeForm').elements.product.focus({ preventScroll: true });
});
$('recipeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements; const p = inv.products.find((x) => x.id === f.product.value);
  let lines;
  try { lines = readRecipeLines(); } catch (err) { return invMsg(`<div class="warn bad">${esc(err.message)}</div>`); }
  invAction(async () => {
    await inventory.setRecipe(f.product.value, f.from.value, lines);
    const r = await inventory.sync();
    const extra = r?.completed ? ` Đã trừ bù kho cho ${r.completed} đơn bán trước đó.` : '';
    return (lines.length ? `Đã lưu công thức ${p?.name} từ ${f.from.value}, ${lines.length} nguyên liệu.` : `Đã đặt ${p?.name} không trừ kho từ ${f.from.value}.`) + extra;
  });
});

initAssistant({
  inventory,
  getInv: () => inv,
  afterWrite: async () => {
    await inventory.sync();
    inv = await inventory.load(currentRange());
    renderInventory();
    await refreshAssistant();
  },
});

function start() {
  const token = findSession();
  if (!token) return showLogin();
  client.useSession(token);
  load();
}

fillMonths();
$('month').value = today().slice(0, 7);
start();
