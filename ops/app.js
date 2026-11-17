import { SUPABASE_URL, SUPABASE_KEY, ADMIN_SESSION_KEY } from './config.js';
import { SupabaseClient, SupabaseOrderReader, readSupabaseOrders, readExpenses, readSettings } from './lib/supabase-order-source.js';
import { buildOwnerDashboard, monthRange, rangeToIso } from './lib/owner-dashboard.js';
import { SupabaseSettlementStore, ordersForReconcile, previewGrabFile } from './lib/settlement-store.js';
import { buildReconcileReport } from './lib/reconcile-report.js';

const OWN_KEY = 'the-khe-ops-session';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const vnd = (n) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'chưa có');

const client = new SupabaseClient({ url: SUPABASE_URL, key: SUPABASE_KEY });
const store = new SupabaseSettlementStore(client);
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
  document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
  load();
}));
$('month').addEventListener('change', () => { quick = 'month'; document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x.dataset.q === 'month')); load(); });
$('reload').addEventListener('click', load);
document.addEventListener('keydown', (e) => { if (e.key === 'r' && !e.metaKey && !e.ctrlKey && e.target.tagName !== 'INPUT') load(); });

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
  ? `<table><thead><tr>${head.map(([h, n]) => `<th class="${n ? 'n' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${head[i][1] ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  : '<p class="muted">Không có dữ liệu.</p>';

const KIND = { data: 'Dữ liệu lệch', refund: 'Kiểm hoàn tiền', unpaid: 'Chưa thu', stale: 'Đơn treo', no_cost: 'Thiếu giá vốn' };

function render(d, settings) {
  $('login').hidden = true;
  $('app').hidden = false;
  $('logout').hidden = false;
  const cmp = d.previousRange.partial ? `cùng ${d.days.length} ngày kỳ trước` : 'kỳ trước';
  $('meta').textContent = `${settings?.shop_name || 'THE KHE'} · ${d.range.from} đến ${addDays(d.range.to, -1)} · so với ${d.previousRange.from} đến ${addDays(d.previousRange.to, -1)} · đọc lúc ${fmtTime(d.syncedAt)} · đơn cập nhật gần nhất ${fmtTime(d.lastOrderAt)}`;
  $('warnings').innerHTML = d.warnings.map((w) => `<div class="warn ${d.sourceStatus !== 'ok' && w.startsWith('Nguồn') ? 'bad' : ''}">${esc(w)}</div>`).join('');
  const k = d.kpi;
  const est = (on) => (on ? '<span class="tag">ước tính</span>' : '');
  const cards = [
    ['Doanh thu ghi nhận', vnd(k.revenue), delta(d.change.revenue, cmp)],
    ['Số đơn hoàn tất', k.orders, delta(d.change.orders, cmp)],
    ['Giá trị TB/đơn', vnd(k.avgTicket), delta(d.change.avgTicket, cmp)],
    ['Lãi gộp (sau giá vốn)', vnd(k.grossProfit), delta(d.change.grossProfit, cmp)],
    [`Lãi đóng góp${est(k.grabRevenue > 0)}`, vnd(k.contribution), '<span class="muted small">sau phí Grab</span>'],
    ['Chi phí đã nhập', vnd(k.expenses), d.complete ? '' : '<span class="muted small">kỳ chưa nhập đủ</span>'],
    [`Lãi ròng quản trị${est(!d.complete || d.estimated)}`, vnd(k.netProfit), ''],
    ['Tiền về tại quầy', vnd(k.cashIn.cash + k.cashIn.transfer), `<span class="muted small">TM ${vnd(k.cashIn.cash)} · CK ${vnd(k.cashIn.transfer)}</span>`],
    [`Grab còn phải trả${est(k.grabRevenue > 0)}`, vnd(k.grabReceivableEstimate), ''],
    ['Giảm giá đã cho', vnd(k.discounts), ''],
  ];
  $('kpis').innerHTML = cards.map(([l, v, s]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${s}</div>`).join('');

  const max = Math.max(1, ...d.days.map((x) => x.revenue));
  $('days').innerHTML = d.days.map((x) => `<div style="height:${Math.round((x.revenue / max) * 100)}%" title="${x.date}: ${vnd(x.revenue)}, ${x.orders} đơn"></div>`).join('') || '<p class="muted">Chưa có ngày nào.</p>';

  $('channels').innerHTML = table([['Kênh'], ['Đơn', 1], ['Doanh thu', 1], ['Lãi gộp', 1]],
    d.channels.map((c) => [esc(c.label), c.orders, vnd(c.revenue), vnd(c.revenue - c.cost)]));

  $('issueCount').textContent = d.issues.length;
  const issueRows = d.issues.map((i) => [`#${esc(i.orderNumber)}`, esc(i.businessDate), esc(i.channel), `<b>${KIND[i.kind]}</b> ${esc(i.label)}`, vnd(i.amount)]);
  $('issues').innerHTML = d.issues.length ? table([['Đơn'], ['Ngày'], ['Kênh'], ['Vấn đề'], ['Tiền', 1]], issueRows) : '<p class="muted">Không có đơn lệch trong kỳ.</p>';

  const itemRows = (xs) => xs.map((i) => [esc(i.name), i.qty, vnd(i.listRevenue), vnd(i.margin)]);
  const head = [['Món'], ['SL', 1], ['Doanh thu', 1], ['Lãi gộp', 1]];
  $('topItems').innerHTML = table(head, itemRows(d.items.slice(0, 8)));
  $('lowItems').innerHTML = table(head, itemRows(d.items.slice(-8).reverse().filter((i) => !d.items.slice(0, 8).includes(i))));

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
    const live = buildReconcileReport({
      period: p,
      orderSync: { ...src, orders: ordersForReconcile(src.orders), source: 'supabase:orders' },
      lines: ledger.lines,
      pendingRevisionCount: ledger.pending.length,
      locked: close?.status === 'locked',
    });
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

function start() {
  const token = findSession();
  if (!token) return showLogin();
  client.useSession(token);
  load();
}

$('month').value = today().slice(0, 7);
start();
