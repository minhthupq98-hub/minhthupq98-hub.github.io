// Per-line details remain in orders.items JSON; product IDs and money stay intact.
const text = (value) => typeof value === 'string' ? value.trim() : '';
const unique = (values) => [...new Set(values.filter(Boolean))];
const newKey = () => globalThis.crypto.randomUUID();
export const quantity = (item) => Math.max(0, Math.trunc(Number(item.qty) || 0));
export const totalQuantity = (items) => items.reduce((sum, item) => sum + quantity(item), 0);
export const lineKey = (item, index) => item.lineKey || `legacy-${index}`;

export function normalizeLines(items) {
  const used = new Set();
  return items.map((item) => {
    let key = item.lineKey || newKey();
    if (used.has(key)) key = newKey();
    used.add(key);
    return { ...item, lineKey: key };
  });
}

export function extraNames(item) {
  return (Array.isArray(item.extras) ? item.extras : []).map((extra) =>
    typeof extra === 'string' ? text(extra) : text(extra?.name)
  ).filter(Boolean);
}

export function preparationDetails(item) {
  return unique([
    item.ice === 'Bình thường' ? '' : text(item.ice),
    item.sweetness === 'Bình thường' ? '' : text(item.sweetness),
    item.toppingMode === 'none' ? 'Không topping' :
      item.toppingMode === 'separate' ? 'Topping để riêng' : '',
    ...extraNames(item),
    text(item.lineNote),
    text(item.note),
  ]);
}

export function itemSummary(item) {
  return [text(item.recipientName) ? `Cho: ${text(item.recipientName)}` : '',
    ...preparationDetails(item)].filter(Boolean).join(' · ');
}

export function addProduct(items, product) {
  const index = items.findIndex((item) => String(item.id) === String(product.id) &&
    Number(item.price) === Number(product.price) &&
    Number(item.grabPrice) === Number(product.grabPrice) &&
    Number(item.cost) === Number(product.cost) &&
    !text(item.recipientName) && !preparationDetails(item).length);
  if (index < 0) return [...items, { ...product, lineKey: newKey(), qty: 1 }];
  return items.map((item, i) => i === index ? { ...item, qty: quantity(item) + 1 } : item);
}

export function updateLine(items, key, patch) {
  // Never allow a customization operation to overwrite a product ID or price.
  const fields = ['recipientName', 'lineNote', 'toppingMode', 'ice', 'sweetness'];
  const safe = Object.fromEntries(fields.filter((field) => field in patch).map((field) => [field, patch[field]]));
  return items.map((item, index) => lineKey(item, index) === key ? { ...item, ...safe } : item);
}

export function changeQuantity(items, key, delta) {
  return items.map((item, index) => lineKey(item, index) === key ?
    { ...item, qty: quantity(item) + delta } : item).filter((item) => quantity(item) > 0);
}

export function splitLine(items, key, all = false) {
  return items.flatMap((item, index) => {
    if (lineKey(item, index) !== key || quantity(item) <= 1) return [item];
    if (all) return Array.from({ length: quantity(item) }, (_, i) => ({
      ...item, lineKey: i === 0 ? item.lineKey || newKey() : newKey(), qty: 1,
    }));
    return [{ ...item, qty: quantity(item) - 1 }, { ...item, lineKey: newKey(), qty: 1 }];
  });
}

function numberedLines(items) {
  let next = 1;
  return items.filter((item) => quantity(item) > 0).map((item) => {
    const start = next;
    next += quantity(item);
    return { item, start, end: next - 1, count: quantity(item) };
  });
}

export function cupRange(line) {
  const pad = (number) => String(number).padStart(2, '0');
  return line.start === line.end ? pad(line.start) : `${pad(line.start)}-${pad(line.end)}`;
}

export function buildPrepGroups(items) {
  const groups = new Map();
  for (const line of numberedLines(items)) {
    const item = line.item;
    const key = JSON.stringify([String(item.id), item.name]);
    if (!groups.has(key)) groups.set(key, { key, name: item.name, qty: 0, variants: [] });
    const group = groups.get(key);
    const details = preparationDetails(item);
    const signature = JSON.stringify(details);
    let variant = group.variants.find((entry) => entry.signature === signature);
    if (!variant) {
      variant = { signature, details, qty: 0, lines: [] };
      group.variants.push(variant);
    }
    variant.qty += line.count;
    variant.lines.push(line);
    group.qty += line.count;
  }
  return [...groups.values()];
}

export function groupByRecipient(items) {
  const groups = new Map();
  for (const line of numberedLines(items)) {
    const name = text(line.item.recipientName) || 'Chưa ghi người nhận';
    if (!groups.has(name)) groups.set(name, { name, qty: 0, lines: [] });
    const group = groups.get(name);
    group.qty += line.count;
    group.lines.push(line);
  }
  return [...groups.values()];
}

// The live app supplies its own Preact renderer and hooks. No second framework.
export function createCupUI(h, useState) {
  const el = (tag, props, ...children) => h(tag, { ...props, children });
  const button = (label, onClick, props = {}) => el('button', { type: 'button', onClick, ...props }, label);
  const label = (title, control) => el('label', { className: 'tk-field' }, el('span', {}, title),
    h(control.type, { ...control.props, 'aria-label': title }));

  function OrderPanel({ className, children }) {
    const [form, dock] = children[4].props.children;
    return el('aside', { className: `${className} tk-order-panel` },
      children[0], children[1], children[2],
      el('div', { className: 'tk-order-body' }, children[3],
        el('div', { className: 'order-footer' }, form)), dock);
  }

  function CupEditor({ items, onChange, unitPrice, money }) {
    if (!items.length) return null;
    return el('section', { className: 'tk-cup-editor', 'aria-label': 'Người nhận và yêu cầu từng ly' },
      el('div', { className: 'tk-editor-hint' },
        el('strong', {}, 'Đơn nhiều người? Ghi tên ngay dưới từng món.'),
        el('span', {}, 'Các ly khác yêu cầu: tách ly rồi chỉnh riêng. Ghi chú áp dụng cho toàn bộ số lượng của dòng đó.')),
      ...items.map((item, index) => {
        const key = lineKey(item, index);
        const patch = (fields) => onChange((current) => updateLine(current, key, fields));
        const select = (name, values) => el('select', {
          value: item[name] || '', onChange: (event) => patch({ [name]: event.target.value }),
        }, ...[...new Set(['', ...values, item[name] || ''])].map((value) =>
          el('option', { value, key: value }, value || 'Theo công thức')));
        return el('article', { className: 'tk-cup-card', key, 'data-cup-key': key },
          el('div', { className: 'tk-cup-head' },
            el('span', { className: 'tk-line-index', 'aria-hidden': 'true' }, String(index + 1).padStart(2, '0')),
            el('div', { className: 'tk-cup-name' }, el('strong', {}, item.name), el('small', {}, money(unitPrice(item)))),
            el('div', { className: 'tk-quantity' },
              button('−', () => onChange((current) => changeQuantity(current, key, -1)), { 'aria-label': `Giảm số lượng ${item.name}, dòng ${index + 1}` }),
              el('b', { 'aria-label': 'Số lượng' }, item.qty),
              button('+', () => onChange((current) => changeQuantity(current, key, 1)), { 'aria-label': `Tăng số lượng ${item.name}, dòng ${index + 1}` }))),
          el('div', { className: 'tk-cup-fields' },
            label(`Người nhận / nhóm${item.qty > 1 ? ` (cả ${item.qty} ly)` : ''}`,
              el('input', { value: item.recipientName || '', maxLength: 80, autoComplete: 'off',
                placeholder: 'Ví dụ: Tầng 4, Chị Nương', onInput: (event) => patch({ recipientName: event.target.value }) })),
            label('Ghi chú pha chế', el('input', { value: item.lineNote || '', maxLength: 250,
              placeholder: 'Ví dụ: không kem, để riêng...', onInput: (event) => patch({ lineNote: event.target.value }) }))),
          el('div', { className: 'tk-cup-options' },
            label('Topping', el('select', { value: item.toppingMode || '', onChange: (event) => patch({ toppingMode: event.target.value }) },
              el('option', { value: '' }, 'Theo công thức'), el('option', { value: 'none' }, 'Không topping'),
              el('option', { value: 'separate' }, 'Topping để riêng'))),
            label('Độ ngọt', select('sweetness', ['Ít ngọt', '50% ngọt', 'Không đường', 'Bình thường', 'Không ngọt'])),
            label('Lượng đá', select('ice', ['Ít đá', 'Không đá', 'Nhiều đá', 'Bình thường']))),
          (item.note || extraNames(item).length > 0) && el('p', { className: 'tk-existing-details' },
            [...extraNames(item), text(item.note)].filter(Boolean).join(' · ')),
          el('div', { className: 'tk-cup-foot' },
            item.qty > 1 ? el('div', { className: 'tk-split-actions' },
              button('Tách 1 ly', () => onChange((current) => splitLine(current, key)), { title: 'Giữ nguyên tên và ghi chú, tách 1 ly ra để chỉnh' }),
              button('Tách từng ly', () => onChange((current) => splitLine(current, key, true)))) :
              el('span', { className: 'tk-single-hint' }, 'Yêu cầu riêng cho ly này'),
            el('strong', {}, money(unitPrice(item) * item.qty))));
      }));
  }

  function PrepTicket({ order, byRecipient }) {
    const groups = byRecipient ? groupByRecipient(order.items) : buildPrepGroups(order.items);
    const time = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      .format(new Date(order.createdAt));
    return el('article', { className: 'bill-paper tk-prep-paper' },
      el('header', { className: 'tk-prep-header' },
        el('span', { className: 'tk-prep-eyebrow' }, 'THE KHE'),
        el('h2', {}, 'PHIẾU PHA CHẾ'),
        el('div', {}, el('strong', {}, order.code), el('span', {}, time)),
        el('p', {}, `${order.customerName || 'Khách lẻ'} · ${order.channel || ''}`),
        el('div', { className: 'tk-prep-total' }, el('span', {}, 'TỔNG SỐ LƯỢNG'), el('strong', {}, totalQuantity(order.items)))),
      order.note && el('aside', { className: 'tk-order-note' }, el('strong', {}, 'Ghi chú chung: '), order.note),
      el('p', { className: 'tk-prep-view-name' }, byRecipient ? 'GIAO THEO NGƯỜI NHẬN' : 'PHA THEO MÓN'),
      ...groups.map((group) => el('section', { className: 'tk-prep-group', key: group.key || group.name },
        el('header', {}, el('h3', {}, group.name), el('strong', {}, `×${group.qty}`)),
        ...(byRecipient ? group.lines.map((line) => el('div', { className: 'tk-recipient-line', key: line.start },
          el('span', { className: 'tk-cup-number' }, `#${cupRange(line)}`),
          el('div', {}, el('strong', {}, `${line.count} × ${line.item.name}`),
            el('p', {}, preparationDetails(line.item).join(' · ') || 'Theo công thức')))) :
          group.variants.map((variant) => el('div', { className: 'tk-prep-variant', key: variant.signature },
            el('div', { className: `tk-variant-heading${variant.details.length ? ' has-notes' : ''}` },
              el('strong', {}, `×${variant.qty}`), el('b', {}, variant.details.join(' · ') || 'Theo công thức')),
            ...variant.lines.map((line) => el('div', { className: 'tk-prep-recipient', key: line.start },
              el('span', { className: 'tk-cup-number' }, `#${cupRange(line)}`),
              el('span', {}, text(line.item.recipientName) || 'Chưa ghi người nhận'),
              el('b', {}, `×${line.count}`)))))))),
      order.deliveryAddress && el('p', { className: 'tk-prep-delivery' }, `Giao: ${order.deliveryAddress}`),
      el('footer', { className: 'tk-prep-footer' }, 'Đối chiếu tên người nhận và yêu cầu trước khi giao.'));
  }

  function BillDialog({ order, children, onClose }) {
    const [mode, setMode] = useState('bill');
    const [byRecipient, setByRecipient] = useState(false);
    return el('div', { className: 'bill-dialog tk-bill-dialog', onClick: (event) => event.stopPropagation(),
      onKeyDown: (event) => { if (event.key === 'Escape') onClose(); } },
      el('nav', { className: 'tk-bill-modes tk-print-controls', 'aria-label': 'Loại phiếu' },
        button('Hóa đơn', () => setMode('bill'), { 'aria-pressed': mode === 'bill', className: mode === 'bill' ? 'active' : '' }),
        button('Phiếu pha chế', () => setMode('prep'), { 'aria-pressed': mode === 'prep', className: mode === 'prep' ? 'active' : '' })),
      mode === 'prep' && el('div', { className: 'tk-prep-controls tk-print-controls', 'aria-label': 'Cách sắp xếp phiếu pha chế' },
        button('Gom theo món', () => setByRecipient(false), { 'aria-pressed': !byRecipient, className: !byRecipient ? 'active' : '' }),
        button('Theo người nhận', () => setByRecipient(true), { 'aria-pressed': byRecipient, className: byRecipient ? 'active' : '' })),
      mode === 'bill' ? children[0] : h(PrepTicket, { order, byRecipient }),
      children[1]);
  }
  return { CupEditor, BillDialog, OrderPanel };
}
