import { spendingMethodLabel } from './lib/spending.js?v=ranking-payment-20261119';
import { UNITS } from './lib/inventory.js?v=ranking-payment-20261119';
import { parseVndInput } from './lib/shift-store.js?v=ranking-payment-20261119';
import { BUY_UNITS, RECEIPT_CATEGORIES, emptyReceiptLine, makeReceiptDraft, receiptQuantity, receiptTotals, receiptPayload, savedReceiptDraft } from './lib/receipt-draft.js?v=ranking-payment-20261119';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const vnd = (n) => `${new Intl.NumberFormat('vi-VN').format(n || 0)}đ`;
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const opt = (v, label, selected) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(label)}</option>`;
let instance = 0;

export async function invoiceFilePayload(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$|^application\/pdf$/.test(file.type)) throw new Error('Chọn ảnh JPG, PNG, WEBP, HEIC hoặc PDF.');
  const original = await file.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', original))].map((b) => b.toString(16).padStart(2, '0')).join('');
  let blob = file, mime = file.type;
  if (/^image\/(jpeg|png|webp)$/.test(mime) && file.size > 1200000) {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .85)); mime = 'image/jpeg';
      if (!blob) throw new Error('Không đọc được ảnh, thử ảnh khác.');
    } finally { bitmap.close(); }
  }
  const bytes = new Uint8Array(blob === file ? original : await blob.arrayBuffer());
  if (bytes.length > 6000000) throw new Error('Tệp quá lớn, tối đa 6 MB sau thu nhỏ.');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { hash, file: { mime, data: btoa(binary) } };
}

export function mountReceiptAssistant(container, { client, getIngredients = null, afterWrite = async () => {}, isCurrentSession = () => true, historyOnly = false }) {
  const id = `receipt-${++instance}`;
  let draft = null, ingredients = [], aliases = [], requestId = null, attempted = null, saving = false, scanning = false, editing = null, deleting = null, historyLimit = 20;
  const style = new URL('./receipt-assistant.css?v=ranking-payment-20261119', import.meta.url).href;
  if (!document.querySelector('link[data-receipt-style]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = style; link.dataset.receiptStyle = ''; document.head.append(link); }
  container.classList.add('receipt-assistant');
  container.innerHTML = `<div class="rc-start"><label class="rc-upload" for="${id}-file">Quét hóa đơn / phiếu mua hàng<input id="${id}-file" class="rc-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"></label><button type="button" data-action="manual">Nhập tay, không hóa đơn</button></div><p class="rc-status" role="status" aria-live="polite"></p><div class="rc-review"></div><details class="rc-history"${historyOnly ? ' open' : ''}><summary>Hóa đơn đã lưu: xem, sửa hoặc xóa</summary><div class="rc-history-content"></div></details>`;
  const start = container.querySelector('.rc-start'), status = container.querySelector('.rc-status'), review = container.querySelector('.rc-review');
  const fileInput = container.querySelector('.rc-file');
  if (historyOnly) start.hidden = true;
  async function refreshHistory() {
    const target = container.querySelector('.rc-history-content');
    try {
      const rows = await client.select('ops_receipt_docs', `select=id,supplier,doc_no,doc_date,total,paid_total,payment_source,payment_method,legacy_purchase_id&voided_at=is.null&order=created_at.desc,id.asc&limit=${historyLimit}`);
      if (!isCurrentSession()) return;
      target.innerHTML = rows.length ? `<ul>${rows.map((r) => `<li><b>${esc(r.supplier || 'Mua hàng')} ${esc(r.doc_no || '')}</b><br>${esc(r.doc_date)} · Tổng ${vnd(r.total)}<br>${r.payment_source === 'unpaid' ? (r.legacy_purchase_id ? 'Đã có kho, chưa ghi tiền chi' : 'Chưa thanh toán') : `Đã chi ${vnd(r.paid_total)} · ${esc(spendingMethodLabel(r))}`}<div class="rc-actions"><button type="button" class="rc-secondary" data-action="edit-receipt" data-id="${esc(r.id)}">Sửa</button><button type="button" class="rc-danger" data-action="delete-receipt" data-id="${esc(r.id)}">Xóa</button></div></li>`).join('')}</ul>${rows.length === historyLimit && historyLimit < 1000 ? '<button type="button" class="rc-secondary" data-action="more-history">Xem thêm hóa đơn</button>' : ''}` : '<p class="rc-help">Chưa có hóa đơn đã lưu.</p>';

    } catch { target.textContent = 'Chưa đọc được lịch sử chứng từ. Tải lại để thử lại.'; }
  }
  container.querySelector('.rc-history').addEventListener('toggle', () => { if (container.querySelector('.rc-history').open && isCurrentSession()) refreshHistory(); });
  const active = (selected = '') => ingredients.filter((i) => i.active !== false || i.ingredient_id === selected);
  async function loadReceipt(receiptId) {
    await loadLookups();
    const [docs, lines] = await Promise.all([
      client.select('ops_receipt_docs', `select=*&id=eq.${encodeURIComponent(receiptId)}&voided_at=is.null&limit=1`),
      client.select('ops_receipt_lines', `select=*&receipt_id=eq.${encodeURIComponent(receiptId)}&order=id.asc`),
    ]);
    if (!isCurrentSession()) throw new Error('Phiên đã đổi. Đăng nhập lại trước khi sửa.');
    if (!docs.length || !lines.length) throw new Error('Hóa đơn đã thay đổi hoặc không còn. Tải lại danh sách.');
    return { doc: docs[0], value: savedReceiptDraft(docs[0], lines, ingredients) };
  }
  async function editReceipt(receiptId) {
    if (draft && !confirm('Bỏ bản nháp đang mở để sửa hóa đơn đã lưu?')) return;
    const { doc, value } = await loadReceipt(receiptId);
    begin(value); editing = doc; render();
    status.textContent = 'Đang sửa hóa đơn đã lưu. Chỉ cập nhật tiền chi và kho sau khi bấm Lưu thay đổi.';
    review.querySelector('input')?.focus();
  }
  const loadLookups = async () => {
    const local = getIngredients?.();
    const [levels, aliasRows] = await Promise.all([
      local ? Promise.resolve(local) : client.select('ops_stock_levels', 'select=ingredient_id,name,unit,active&order=name.asc'),
      client.select('ops_ingredient_aliases', 'select=alias_norm,ingredient_id'),
    ]);
    ingredients = levels; aliases = aliasRows.map((a) => ({ alias: a.alias_norm, ingredient_id: a.ingredient_id }));
  };
  const field = (index, prop, label, value, extra = '') => `<label>${label}<input data-line="${index}" data-field="${prop}" value="${esc(value ?? '')}" ${extra}></label>`;
  function lineHTML(line, i) {
    const ingredient = ingredients.find((x) => x.ingredient_id === line.ingredientId);
    const base = ingredient?.unit || line.baseUnit;
    const quantity = receiptQuantity(line, ingredients);
    const direct = base === line.buyUnit || (base === 'g' && line.buyUnit === 'kg') || (base === 'ml' && line.buyUnit === 'l');
    return `<fieldset class="rc-line" data-row="${i}"><legend>Dòng ${i + 1}</legend><div class="rc-fields">
      ${field(i, 'name', 'Tên hàng / khoản chi', line.name, 'maxlength="200" required')}
      <label>Nhóm chi<select data-line="${i}" data-field="category">${RECEIPT_CATEGORIES.map((x) => opt(x, x, line.category)).join('')}</select></label>
      <label>Cách ghi<select data-line="${i}" data-field="kind">${opt('stock', 'Nhập kho', line.kind)}${opt('expense', 'Chi phí vận hành', line.kind)}</select></label>
      ${field(i, 'total', 'Thành tiền (đ)', line.total == null || line.total === '' ? '' : new Intl.NumberFormat('vi-VN').format(line.total), 'inputmode="numeric" required')}
      ${line.kind === 'stock' ? `<label class="rc-wide">Hàng tồn tương ứng<select data-line="${i}" data-field="ingredientId">${opt('', '+ Tạo hàng tồn mới', line.ingredientId)}${active(line.ingredientId).map((x) => opt(x.ingredient_id, `${x.name} (${x.unit})`, line.ingredientId)).join('')}</select></label>
      ${!line.ingredientId ? field(i, 'newName', 'Tên trong kho', line.newName, 'maxlength="80" required') + `<label>Đơn vị tồn kho<select data-line="${i}" data-field="baseUnit">${UNITS.map((u) => opt(u, u, line.baseUnit)).join('')}</select></label>` : ''}
      ${field(i, 'buyQty', 'Số lượng mua', line.buyQty, 'inputmode="decimal" required')}
      <label>Đơn vị mua<select data-line="${i}" data-field="buyUnit">${BUY_UNITS.map((u) => opt(u, u, line.buyUnit)).join('')}</select></label>
      ${!direct ? field(i, 'packSize', `1 ${esc(line.buyUnit)} chứa bao nhiêu ${esc(base)}?`, line.packSize, 'inputmode="decimal" required') : ''}
      <p class="rc-quantity rc-wide" data-quantity="${i}">${quantity > 0 ? `Sẽ nhập ${new Intl.NumberFormat('vi-VN').format(quantity)} ${esc(base)}` : 'Cần nhập số lượng hoặc quy cách để biết lượng vào kho.'}</p>` : '<p class="rc-help rc-wide">Dòng này ghi vào Chi phí để tính lãi, không tăng hàng tồn.</p>'}
      </div>${line.printed ? `<p class="rc-help">Hóa đơn ghi: ${esc(line.printed)}</p>` : ''}${line.flags.map((f) => `<p class="rc-help">${esc(f)}</p>`).join('')}
      <button type="button" class="rc-secondary" data-action="remove" data-line="${i}">Bỏ dòng ${i + 1}</button></fieldset>`;
  }
  function render() {
    if (!draft) { review.replaceChildren(); start.hidden = historyOnly; return; }
    const focusKey = document.activeElement?.dataset.field, focusLine = document.activeElement?.dataset.line;
    start.hidden = true;
    review.innerHTML = `<form class="rc-form"><h3>${editing ? 'Sửa hóa đơn đã lưu' : 'Soát hóa đơn và nhóm chi'}</h3><div class="rc-fields rc-document">
      <label>Nhà cung cấp<input data-doc="supplier" value="${esc(draft.supplier)}" maxlength="120"></label><label>Số hóa đơn<input data-doc="docNo" value="${esc(draft.docNo)}" maxlength="60"></label>
      <label>Ngày mua<input data-doc="docDate" type="date" value="${esc(draft.docDate)}" max="${today()}" required></label>
      <label>Thanh toán<select data-doc="paymentSource" required>${opt('', 'Chọn tình trạng / nguồn tiền', draft.paymentSource)}${opt('outside', 'Đã chi ngoài két', draft.paymentSource)}${opt('till', 'Đã chi từ két trong ca', draft.paymentSource)}${opt('unpaid', 'Chưa thanh toán', draft.paymentSource)}</select></label>
      ${draft.paymentSource === 'outside' ? `<label>Phương thức thanh toán<select data-doc="paymentMethod" required>${opt('', 'Chọn tiền mặt / chuyển khoản', draft.paymentMethod)}${opt('cash', 'Tiền mặt ngoài két', draft.paymentMethod)}${opt('transfer', 'Chuyển khoản', draft.paymentMethod)}</select></label>` : draft.paymentSource === 'till' ? '<p class="rc-help">Tiền mặt từ két ca đang mở, được trừ vào tiền két.</p>' : ''}
      ${draft.paymentSource && draft.paymentSource !== 'unpaid' ? `<label>Ngày chi tiền<input data-doc="paidDate" type="date" value="${esc(draft.paidDate || draft.docDate)}" max="${today()}" required></label>` : ''}
      <label>Tổng hóa đơn (đ)<input data-doc="grandTotal" value="${new Intl.NumberFormat('vi-VN').format(draft.grandTotal)}" inputmode="numeric" required></label></div>
      ${draft.allocatedExtra ? `<p class="rc-help">Đã phân bổ ${vnd(draft.allocatedExtra)} thuế/phí/giảm giá vào các dòng để khớp tổng hóa đơn.</p>` : ''}
      <div class="rc-lines">${draft.lines.map(lineHTML).join('')}</div><button type="button" class="rc-secondary" data-action="add">+ Thêm dòng</button>
      <div class="rc-totals" aria-live="polite"></div><p class="rc-help">Tiền mua nguyên liệu và bao bì được ghi vào báo cáo tiền chi; hàng nhập kho chưa trừ thêm vào lãi ròng. Giá vốn tính khi bán. Dòng chi phí vận hành ghi vào Chi phí.</p>
      ${editing ? `<label class="rc-reason">Lý do sửa<input data-doc="changeReason" value="${esc(draft.changeReason || '')}" maxlength="500" minlength="3" required></label><p class="rc-help">Lưu sẽ thay thế chứng từ cũ, cập nhật tiền chi và kho cùng nhau. Lịch sử được giữ lại. Kỳ đã chốt, ca đã đóng hoặc thay đổi kho có giao dịch tiếp theo sẽ được kiểm tra trước khi ghi.</p>` : ''}
      <div class="rc-errors" role="alert"></div><div class="rc-actions"><button type="submit">${editing ? 'Lưu thay đổi hóa đơn' : 'Ghi hóa đơn: tiền chi + kho'}</button><button type="button" class="rc-secondary" data-action="cancel">${editing ? 'Hủy sửa' : 'Bỏ bản nháp'}</button></div></form>`;
    totals();
    if (focusKey) review.querySelector(`[data-field="${CSS.escape(focusKey)}"][data-line="${CSS.escape(focusLine || '')}"]`)?.focus();
  }
  function totals() {
    if (!draft) return;
    const t = receiptTotals(draft);
    if (draft.autoTotal) { draft.grandTotal = t.total; const input = review.querySelector('[data-doc=grandTotal]'); if (input) input.value = new Intl.NumberFormat('vi-VN').format(t.total); }
    const el = review.querySelector('.rc-totals');
    if (el) el.innerHTML = `<div><span>Tiền đã chi</span><b>${t.paid == null ? 'Chưa chọn thanh toán' : vnd(t.paid)}</b></div><div><span>Giá trị nhập kho</span><b>${vnd(t.inventory)}</b></div><div><span>Chi phí tính lãi</span><b>${vnd(t.expense)}</b></div><ul>${Object.entries(t.byCategory).map(([name, value]) => `<li>${esc(name)}: ${vnd(value)}</li>`).join('')}</ul>`;
    for (const [i, line] of draft.lines.entries()) {
      const q = review.querySelector(`[data-quantity="${i}"]`);
      if (q) { const unit = ingredients.find((x) => x.ingredient_id === line.ingredientId)?.unit || line.baseUnit; const qty = receiptQuantity(line, ingredients); q.textContent = qty > 0 ? `Sẽ nhập ${new Intl.NumberFormat('vi-VN').format(qty)} ${unit}` : 'Cần nhập số lượng hoặc quy cách để biết lượng vào kho.'; }
    }
  }
  function begin(value) { editing = null; deleting = null; draft = value; requestId = crypto.randomUUID(); attempted = null; render(); review.querySelector('input')?.focus(); }
  async function scan(file) {
    if (scanning || saving || !file) return;
    if (!isCurrentSession()) { status.textContent = 'Đăng nhập lại trước khi đọc hóa đơn.'; return; }
    scanning = true; fileInput.disabled = true; status.textContent = 'AI đang đọc từng dòng, phân nhóm và quy cách mua...';
    try {
      await loadLookups();
      const upload = await invoiceFilePayload(file);
      const existing = await client.select('ops_receipt_docs', `select=id&voided_at=is.null&file_hash=eq.${upload.hash}&limit=1`);
      if (existing.length) { await editReceipt(existing[0].id); status.textContent = 'Hóa đơn này đã lưu. Đã mở bản sửa, không nhập kho lần hai.'; return; }
      const result = await client.invoke('ops-ai-import', { file: upload.file, ingredients: active().map((i) => ({ name: i.name, unit: i.unit })), mode: 'receipt' });
      if (!isCurrentSession()) throw new Error('Phiên đã đổi, đọc lại hóa đơn với tài khoản hiện tại.');
      const value = makeReceiptDraft(result.invoice, { ingredients, aliases, today: today(), fileHash: upload.hash });
      if (!value.lines.length) throw new Error('Chưa đọc được dòng nào. Chọn ảnh rõ hơn hoặc nhập tay.');
      if (value.supplier.trim() && value.docNo.trim()) {
        const matches = await client.select('ops_receipt_docs', `select=id,supplier&voided_at=is.null&doc_no=eq.${encodeURIComponent(value.docNo)}&limit=100`);
        const match = matches.find((r) => r.supplier.trim().toLocaleLowerCase() === value.supplier.trim().toLocaleLowerCase());
        if (match) { await editReceipt(match.id); status.textContent = 'Số hóa đơn này đã lưu. Đã mở bản sửa, không ghi trùng.'; return; }
      }
      begin(value); status.textContent = `AI đọc ${value.lines.length} dòng và phân nhóm sẵn. Soát nhóm, thanh toán và quy cách trước khi ghi.`;
    } catch (e) { status.textContent = e.message; }
    finally { scanning = false; fileInput.disabled = false; fileInput.value = ''; }
  }
  fileInput.addEventListener('change', () => scan(fileInput.files[0]));
  container.addEventListener('input', (e) => {
    const el = e.target;
    if (!draft) return;
    if (el.dataset.doc) { draft[el.dataset.doc] = el.dataset.doc === 'grandTotal' ? parseVndInput(el.value) : el.value; if (el.dataset.doc === 'grandTotal') draft.autoTotal = false; totals(); }
    if (el.dataset.field) {
      const line = draft.lines[Number(el.dataset.line)], prop = el.dataset.field;
      if (!line) return;
      if (prop === 'name' && (!line.newName || line.newName === line.name)) line.newName = el.value;
      line[prop] = prop === 'total' ? parseVndInput(el.value) : el.value;
      totals();
    }
  });
  container.addEventListener('change', (e) => {
    const el = e.target;
    if (!draft) return;
    if (el.dataset.doc === 'paymentSource') { draft.paymentSource = el.value; draft.paymentMethod = el.value === 'till' ? 'cash' : ''; draft.paidDate ||= draft.docDate; render(); }
    if (el.tagName === 'SELECT' && el.dataset.field) {
      const line = draft.lines[Number(el.dataset.line)]; line[el.dataset.field] = el.value;
      if (el.dataset.field === 'category') line.kind = ['Nguyên liệu', 'Bao bì', 'Vật tư'].includes(line.category) ? 'stock' : 'expense';
      render();
    }
  });
  container.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || saving || scanning) return;
    const action = b.dataset.action;
    if (!isCurrentSession()) { status.textContent = 'Đăng nhập lại trước khi thao tác.'; return; }
    if (action === 'more-history') { historyLimit += 20; await refreshHistory(); return; }
    if (action === 'edit-receipt') {
      b.disabled = true;
      try { await editReceipt(b.dataset.id); } catch (e) { status.textContent = e.message; } finally { b.disabled = false; }
      return;
    }
    if (action === 'delete-receipt') {
      if (draft && !confirm('Bỏ bản nháp đang mở để xem xác nhận xóa?')) return;
      b.disabled = true;
      try {
        const { doc } = await loadReceipt(b.dataset.id);
        draft = null; editing = null; deleting = doc; requestId = crypto.randomUUID(); attempted = null;
        start.hidden = true;
        review.innerHTML = `<form class="rc-delete-form"><h3>Xóa hóa đơn ${esc(doc.doc_no || doc.supplier)}</h3><p>Tổng ${vnd(doc.total)} · ${esc(doc.doc_date)}. Xóa sẽ bỏ khoản tiền chi, chi phí vận hành và lượng kho của hóa đơn này. Lịch sử vẫn được giữ lại.</p><label>Lý do xóa<input name="reason" required minlength="3" maxlength="500"></label><p class="rc-errors" role="alert"></p><div class="rc-actions"><button type="submit" class="rc-danger">Xác nhận xóa hóa đơn</button><button type="button" class="rc-secondary" data-action="cancel">Giữ hóa đơn</button></div></form>`;
        review.querySelector('input')?.focus(); status.textContent = '';
      } catch (e) { status.textContent = e.message; } finally { b.disabled = false; }
      return;
    }
    if (action === 'manual') {
      try { if (!isCurrentSession()) throw new Error('Đăng nhập lại trước khi nhập hàng.'); await loadLookups(); begin({ ...makeReceiptDraft({}, { today: today(), hasInvoice: false }), lines: [emptyReceiptLine()] }); status.textContent = 'Nhập hàng mua không có hóa đơn, chọn nhóm và nguồn tiền.'; } catch (e) { status.textContent = e.message; }
    } else if (action === 'add') { draft.lines.push(emptyReceiptLine()); render(); }
    else if (action === 'remove') { draft.lines.splice(Number(b.dataset.line), 1); render(); }
    else if (action === 'cancel') { draft = null; editing = null; deleting = null; status.textContent = ''; render(); }
  });
  container.addEventListener('submit', async (e) => {
    if (e.target.matches('.rc-delete-form')) {
      e.preventDefault();
      if (saving || !deleting || !e.target.reportValidity()) return;
      const form = e.target, box = form.querySelector('.rc-errors');
      if (!isCurrentSession()) { box.textContent = 'Đăng nhập lại trước khi xóa.'; return; }
      const payload = { p_receipt_id: deleting.id, p_request_id: requestId, p_action: 'delete', p_doc: null, p_lines: null, p_reason: form.elements.reason.value.trim() };
      const serialized = JSON.stringify(payload);
      if (attempted && attempted !== serialized) { box.textContent = 'Kiểm tra danh sách hóa đơn trước khi đổi nội dung lần gửi đang chờ xác nhận.'; return; }
      attempted = serialized; saving = true;
      for (const input of form.querySelectorAll('input,button')) input.disabled = true;
      try {
        const result = await client.rpc('ops_change_receipt', payload);
        if (result?.action !== 'delete') throw new Error('Chưa nhận xác nhận xóa.');
        deleting = null; render(); status.textContent = 'Đã xóa hóa đơn, cập nhật tiền chi và kho. Lịch sử thay đổi được giữ lại.';
        await refreshHistory(); await afterWrite();
      } catch (e) { box.textContent = e.message; if (e.status >= 400 && e.status < 500) attempted = null; for (const input of form.querySelectorAll('input,button')) input.disabled = false; }
      finally { saving = false; }
      return;
    }
    if (!e.target.matches('.rc-form')) return;
    e.preventDefault();
    if (saving || !draft || !e.target.reportValidity()) return;
    const { errors, payload: initialPayload } = receiptPayload(draft, ingredients, requestId);
    const payload = editing ? { ...initialPayload, p_receipt_id: editing.id, p_action: 'edit', p_reason: draft.changeReason?.trim() || '' } : initialPayload;
    if (editing && (payload.p_reason.length < 3 || payload.p_reason.length > 500)) errors.push('Nhập lý do sửa từ 3 đến 500 ký tự.');
    const errorBox = review.querySelector('.rc-errors');
    if (!isCurrentSession()) errors.push('Phiên đã đổi, đọc lại hóa đơn.');
    if (errors.length) { errorBox.textContent = errors.join('\n'); errorBox.tabIndex = -1; errorBox.focus(); return; }
    const serialized = JSON.stringify(payload);
    if (attempted && attempted !== serialized) { errorBox.textContent = 'Nội dung đã đổi sau lần gửi trước. Kiểm tra lịch sử chứng từ rồi lập nháp mới để tránh ghi trùng.'; return; }
    attempted = serialized; saving = true; errorBox.textContent = '';
    const form = e.target; for (const input of form.querySelectorAll('input,select,button')) input.disabled = true;
    status.textContent = 'Đang ghi chứng từ, tiền chi và kho trong cùng một lần...';
    try {
      const wasEditing = !!editing;
      const result = await client.rpc(wasEditing ? 'ops_change_receipt' : 'ops_commit_receipt', payload);
      if (!isCurrentSession()) throw new Error('Phiên đã đổi. Tải lại danh sách để kiểm tra kết quả.');
      if (!result?.receipt_id) throw new Error('Chưa nhận được xác nhận ghi chứng từ.');
      draft = null; editing = null; render();
      status.textContent = `${wasEditing ? 'Đã sửa hóa đơn' : 'Đã ghi hóa đơn'}: ${vnd(result.total)}; tiền chi ${vnd(result.paid_total)}; ${result.stock_lines} dòng vào kho, ${result.expense_lines} dòng chi phí.${result.duplicate ? ' Chứng từ đã ghi trước đó, không ghi trùng.' : ''}`;
      refreshHistory();
      try { await afterWrite(); } catch { status.textContent += ' Tải lại để cập nhật các ô số.'; }
    } catch (error) { errorBox.textContent = error.message; if (error.status >= 400 && error.status < 500) attempted = null; for (const input of form.querySelectorAll('input,select,button')) input.disabled = false; }
    finally { saving = false; }
  });
  if (historyOnly) refreshHistory();
  return { scan, refreshHistory, editReceipt, clear: () => { draft = null; editing = null; deleting = null; render(); status.textContent = ''; }, hasDraft: () => !!draft || !!deleting };
}
