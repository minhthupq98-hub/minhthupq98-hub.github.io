// VND luôn là số nguyên đồng, không dùng số thực.
export function toVnd(value, field) {
  const text = String(value ?? '').trim();
  if (text === '') return { ok: false, error: `${field}: thiếu số tiền` };
  if (!/^-?\d+$/.test(text)) return { ok: false, error: `${field}: "${text}" không phải số nguyên VND` };
  const n = Number(text);
  if (n < 0) return { ok: false, error: `${field}: số âm (${n}), sai dấu tiền` };
  return { ok: true, value: n };
}

export function assertVnd(n, field) {
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`${field}: cần số nguyên VND không âm, nhận ${n}`);
  return n;
}

export const formatVnd = (n) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;
