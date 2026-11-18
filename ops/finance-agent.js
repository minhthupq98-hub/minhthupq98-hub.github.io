import { SUPABASE_URL, SUPABASE_KEY, ADMIN_SESSION_KEY } from './config.js?v=receipts-20261118';
import { SupabaseClient } from './lib/supabase-order-source.js?v=receipts-20261118';
import { monthRange } from './lib/owner-dashboard.js?v=receipts-20261118';
import { mountReceiptAssistant } from './receipt-assistant.js?v=receipts-20261118';

const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const vnd = (v) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`;
const readSession = () => {
  const stores = document.getElementById('root') ? [[localStorage, ADMIN_SESSION_KEY]]
    : [[sessionStorage, 'the-khe-ops-session'], [localStorage, ADMIN_SESSION_KEY]];
  for (const [storage, key] of stores) {
    try {
      const s = JSON.parse(storage.getItem(key) || 'null');
      if (s?.access_token && Number(s.expires_at) * 1000 > Date.now() + 10000) return s.access_token;
    } catch { /* bỏ qua phiên cũ/hỏng */ }
  }
  return null;
};
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};

export function mountFinanceAgent({ client = new SupabaseClient({ url: SUPABASE_URL, key: SUPABASE_KEY }),
  getRange = () => monthRange(today().slice(0, 7)), afterWrite = async () => {} } = {}) {
  if (document.getElementById('tkFinanceAgent')) return window.theKheFinanceAgent;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./finance-agent.css', import.meta.url).href;
  document.head.append(stylesheet);

  const launcher = node('button', 'Trợ lý quản lý', 'tk-finance-launcher');
  launcher.type = 'button'; launcher.id = 'tkFinanceLauncher';
  if (document.getElementById('root')) launcher.classList.add('tk-staff-agent');
  launcher.setAttribute('aria-haspopup', 'dialog'); launcher.setAttribute('aria-controls', 'tkFinanceAgent');
  launcher.hidden = true;
  const dialog = node('dialog');
  dialog.id = 'tkFinanceAgent'; dialog.setAttribute('aria-labelledby', 'tkFinanceTitle');
  // Chỉ phần khung cố định là HTML. Mọi câu trả lời/tên từ AI dùng textContent.
  dialog.innerHTML = `<header class="tk-ai-head"><div><h2 id="tkFinanceTitle">Trợ lý quản lý</h2><p>Toàn bộ admin · dữ liệu quán đang đăng nhập</p></div><button type="button" class="tk-ai-close" aria-label="Đóng trợ lý">× Đóng</button></header>
    <div class="tk-ai-scroll"><p class="tk-ai-intro">Hỏi về doanh thu, thu chi, lãi món, ca và tiền két, kho, công thức, Grab hoặc chốt kỳ. AI có thể lập nháp khoản chi để bạn soát và ghi.</p>
    <form class="tk-ai-range"><label>Từ ngày<input type="date" name="from" required></label><label>Đến hết ngày<input type="date" name="until" required></label></form>
    <div class="tk-ai-prompts" aria-label="Câu hỏi gợi ý"></div>
    <details class="rc-chat-panel"><summary>Đính kèm hóa đơn: AI chia nhóm chi và nhập kho</summary><h3>Quét hóa đơn ngay trong trợ lý</h3><p class="tk-ai-intro">AI phân nhóm từng dòng. Nguyên liệu, bao bì vào kho; khoản vận hành ghi chi phí. Một lần xác nhận ghi cả chứng từ và tiền chi.</p><div class="tk-ai-receipts"></div></details>
    <div class="tk-ai-messages" role="log" aria-label="Hội thoại với trợ lý"></div>
    <p class="tk-ai-status" role="status" aria-live="polite"></p><p class="tk-ai-error" role="alert"></p></div>
    <form class="tk-ai-compose"><label for="tkFinanceQuestion">Bạn cần hỗ trợ gì?</label><div><textarea id="tkFinanceQuestion" rows="2" maxlength="3000" placeholder="Ví dụ: Tháng này lãi thế nào? Hoặc: Chi điện hôm nay 300.000đ" required></textarea><button type="submit">Gửi</button></div><p>AI đọc số và lập nháp. Chỉ ghi khi bạn bấm xác nhận.</p></form>`;
  document.body.append(launcher, dialog);
  const close = dialog.querySelector('.tk-ai-close');
  const from = dialog.querySelector('[name=from]'), until = dialog.querySelector('[name=until]');
  const question = dialog.querySelector('textarea'), compose = dialog.querySelector('.tk-ai-compose');
  const messages = dialog.querySelector('.tk-ai-messages'), scroll = dialog.querySelector('.tk-ai-scroll');
  const status = dialog.querySelector('.tk-ai-status'), error = dialog.querySelector('.tk-ai-error');
  const submit = compose.querySelector('button');
  const history = [];
  let lastToken = null, returnFocus = null, busy = false;
  let receiptToken = null;
  const receipt = mountReceiptAssistant(dialog.querySelector('.tk-ai-receipts'), { client, afterWrite,
    isCurrentSession: () => { const token = readSession(); if (!token) return false; if (!receiptToken) receiptToken = token; client.useSession(token); return token === receiptToken; } });
  const receiptDetails = dialog.querySelector('.rc-chat-panel');
  receiptDetails.addEventListener('toggle', () => {
    dialog.classList.toggle('tk-ai-receipt-mode', receiptDetails.open);
    dialog.querySelector('#tkFinanceTitle').textContent = receiptDetails.open ? 'Quét hóa đơn' : 'Trợ lý quản lý';
    receiptDetails.querySelector('summary').textContent = receiptDetails.open ? '← Quay lại hỏi AI' : 'Đính kèm hóa đơn: AI chia nhóm chi và nhập kho';
  });
  const plusDay = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const syncRange = () => { const r = getRange(); from.value = r.from; until.value = plusDay(r.to, -1); };
  const available = () => Boolean(readSession()) && !document.querySelector('#login:not([hidden])');
  const updateAvailability = () => {
    launcher.hidden = !available();
    if (!available()) { if (dialog.open) dialog.close(); messages.replaceChildren(); history.splice(0); lastToken = null; receiptToken = null; receipt.clear(); }
  };
  const addMessage = (role, text) => {
    const box = node('section', null, `tk-ai-message tk-ai-${role}`);
    box.append(node('b', role === 'user' ? 'Bạn' : 'Trợ lý'), node('div', text, 'tk-ai-text'));
    messages.append(box); return box;
  };
  const displaySnapshot = (box, snapshot) => {
    if (!snapshot) return;
    const r = snapshot.range;
    box.append(node('p', `Dữ liệu ${r.from} đến ${plusDay(r.to, -1)} · đọc lúc ${new Date(snapshot.asOf).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`, 'tk-ai-source'));
    const facts = node('div', null, 'tk-ai-facts');
    for (const [label, value] of [['Doanh thu', vnd(snapshot.kpi.revenue)], ['Lãi gộp', vnd(snapshot.kpi.grossProfit)], ['Chi phí đã nhập', vnd(snapshot.kpi.expenses)]]) {
      const fact = node('div'); fact.append(node('span', label), node('strong', value)); facts.append(fact);
    }
    box.append(facts);
    const details = node('details');
    details.append(node('summary', 'Nguồn số và giới hạn dữ liệu'));
    details.append(node('p', 'Đọc trực tiếp từ đơn hàng, chi phí và các sổ quản lý theo quyền tài khoản. Lãi ròng tạm tính cho đến khi nhập đủ chi phí; giá vốn kho là số riêng.'));
    if (snapshot.unavailable?.length) details.append(node('p', `Chưa đọc được: ${snapshot.unavailable.join(', ')}.`));
    for (const warning of snapshot.warnings || []) details.append(node('p', warning));
    box.append(details);
  };

  function draftForm(box, draft) {
    const requestId = crypto.randomUUID();
    const form = node('form', null, 'tk-ai-draft');
    form.innerHTML = `<h3>Soát khoản chi trước khi ghi</h3><p>Hàng mua để nhập kho dùng mục Nhập kho. Khoản chi từ két sẽ trừ vào ca đang mở.</p>
      <label>Nội dung<input name="name" maxlength="200" required></label>
      <div class="tk-ai-fields"><label>Số tiền (đ)<input name="amount" type="number" min="1" max="2147483647" step="1" inputmode="numeric" required></label><label>Ngày đã chi<input type="date" name="date" required></label></div>
      <div class="tk-ai-fields"><label>Nhóm chi phí<input name="category" maxlength="100" required></label><label>Nguồn tiền<select name="source" required><option value="">Chọn nguồn tiền</option><option value="outside">Chi ngoài két</option><option value="till">Chi từ két trong ca</option></select></label></div>
      <div class="tk-ai-draft-actions"><button type="submit">Ghi khoản chi</button><button type="button" class="tk-ai-discard">Bỏ nháp</button></div><p class="tk-ai-save-status" role="status" aria-live="polite"></p>`;
    form.elements.name.value = draft.name; form.elements.amount.value = draft.amount;
    form.elements.date.value = draft.expense_date; form.elements.date.max = today();
    form.elements.category.value = draft.category; form.elements.source.value = draft.payment_source || '';
    form.querySelector('.tk-ai-discard').addEventListener('click', () => form.remove());
    const saveStatus = form.querySelector('.tk-ai-save-status');
    let attemptedPayload = null;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const save = form.querySelector('[type=submit]');
      if (save.disabled || !form.reportValidity()) return;
      const token = readSession();
      if (!token || token !== lastToken) { saveStatus.textContent = 'Phiên đã đổi. Hỏi lại để lập nháp với tài khoản hiện tại.'; return; }
      const args = { p_request_id: requestId, p_name: form.elements.name.value.trim(), p_amount: Number(form.elements.amount.value),
        p_date: form.elements.date.value, p_category: form.elements.category.value.trim(), p_payment_source: form.elements.source.value };
      if (attemptedPayload && JSON.stringify(args) !== attemptedPayload) {
        saveStatus.textContent = 'Nội dung đã đổi sau lần gửi trước. Kiểm tra mục Chi phí rồi lập nháp mới để tránh ghi hai lần.'; return;
      }
      attemptedPayload = JSON.stringify(args); save.disabled = true; saveStatus.textContent = 'Đang ghi khoản chi...';
      try {
        client.useSession(token);
        const result = await client.rpc('ops_record_expense', args);
        if (!result?.expense_id) throw new Error('Chưa xác nhận được kết quả ghi.');
        saveStatus.textContent = result.duplicate ? 'Khoản chi này đã ghi trước đó, không ghi trùng.' : 'Đã ghi khoản chi vào sổ admin.';
        for (const field of form.querySelectorAll('input,select,button')) field.disabled = true;
        try { await afterWrite(); } catch { saveStatus.textContent += ' Tải lại để cập nhật các ô số.'; }
      } catch (err) { saveStatus.textContent = err.message; save.disabled = false; }
    });
    box.append(form);
  }

  async function ask(text) {
    if (busy || !text.trim()) return;
    error.textContent = '';
    if (!from.value || !until.value || from.value > until.value) { error.textContent = 'Chọn lại khoảng ngày hợp lệ.'; return; }
    const token = readSession();
    if (!token) { error.textContent = 'Phiên đăng nhập hết hạn. Đăng nhập lại tài khoản admin.'; return; }
    if (lastToken && lastToken !== token) { messages.replaceChildren(); history.splice(0); }
    lastToken = token; client.useSession(token);
    addMessage('user', text);
    busy = true; submit.disabled = true; question.disabled = true;
    status.textContent = 'Đang đọc số liệu của quán và phân tích...'; scroll.scrollTop = scroll.scrollHeight;
    try {
      const answer = await client.invoke('ops-finance-agent', { message: text, range: { from: from.value, to: plusDay(until.value, 1) }, history: history.slice(-8) });
      if (readSession() !== token) { updateAvailability(); return; }
      const box = addMessage('assistant', answer.answer);
      displaySnapshot(box, answer.snapshot);
      const links = node('div', null, 'tk-ai-links');
      const allowed = new Set(['tong-quan','ca','nhap-kho','kho','nguyen-lieu','cong-thuc','chi-phi','doi-soat']);
      for (const link of answer.links || []) if (allowed.has(link.view)) {
        const a = node('a', link.label); a.href = new URL(`./#${link.view}`, import.meta.url).href;
        a.addEventListener('click', () => dialog.close()); links.append(a);
      }
      box.append(links);
      if (answer.expenseDraft) draftForm(box, answer.expenseDraft);
      history.push({ role: 'user', content: text }, { role: 'assistant', content: answer.answer });
      question.value = '';
      from.value = answer.snapshot.range.from; until.value = plusDay(answer.snapshot.range.to, -1);
    } catch (err) { error.textContent = err.message; question.value = text; }
    finally {
      busy = false; submit.disabled = false; question.disabled = false; status.textContent = '';
      scroll.scrollTop = scroll.scrollHeight;
    }
  }

  for (const [label, text] of [['Tình hình quán', 'Tóm tắt tài chính kỳ đang xem, so kỳ trước và việc cần xử lý.'],
    ['Lãi từng món', 'Món nào có biên lãi thấp, nên xem lại giá hay giá vốn?'],
    ['Thu chi', 'Phân tích chi phí đã nhập và tiền về theo kênh.'],
    ['Ca, kho và Grab', 'Kiểm tra ca tiền mặt, kho và đối soát Grab còn việc gì cần xử lý?']]) {
    const b = node('button', label); b.type = 'button'; b.addEventListener('click', () => { question.value = text; question.focus(); });
    dialog.querySelector('.tk-ai-prompts').append(b);
  }
  const api = {
    open(prompt = '') { updateAvailability(); if (!available()) return; returnFocus = document.activeElement; syncRange();
      if (!dialog.open) dialog.showModal(); if (prompt) question.value = prompt; question.focus(); },
    close: () => dialog.close(),
  };
  window.theKheFinanceAgent = api;
  launcher.addEventListener('click', () => api.open());
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); });
  compose.addEventListener('submit', (e) => { e.preventDefault(); ask(question.value); });
  question.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(question.value); } });
  window.addEventListener('storage', updateAvailability);
  document.addEventListener('visibilitychange', updateAvailability);
  // Admin gốc đổi phiên sau đăng nhập/đăng xuất mà không tải lại trang.
  let availabilityTimer;
  new MutationObserver(() => { clearTimeout(availabilityTimer); availabilityTimer = setTimeout(updateAvailability, 100); })
    .observe(document.getElementById('root') || document.getElementById('app') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  updateAvailability();
  return api;
}

// Cùng một trợ lý được tải từ admin bán hàng, không cần nhân đôi mã hay khóa.
if (document.getElementById('root') && /^#\/(staff|admin)(\/|$)/.test(location.hash)) mountFinanceAgent();
