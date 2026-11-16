import { SUPABASE_URL, SUPABASE_KEY, ADMIN_SESSION_KEY } from './config.js';
import { SupabaseClient, SupabaseOrderReader, readSupabaseOrders, readExpenses, readSettings } from './lib/supabase-order-source.js';
import { buildOwnerDashboard, monthRange, rangeToIso } from './lib/owner-dashboard.js';

const OWN_KEY = 'the-khe-ops-session';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const vnd = (n) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'chưa có');

const client = new SupabaseClient({ url: SUPABASE_URL, key: SUPABASE_KEY });
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

function start() {
  const token = findSession();
  if (!token) return showLogin();
  client.useSession(token);
  load();
}

$('month').value = today().slice(0, 7);
start();
