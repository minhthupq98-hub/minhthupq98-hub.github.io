// Ngày nghiệp vụ đã là ngày theo Asia/Ho_Chi_Minh (YYYY-MM-DD), kỳ là YYYY-MM.
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isDate = (s) => DATE.test(String(s ?? ''));
export const isPeriod = (s) => PERIOD.test(String(s ?? ''));
export const periodOf = (date) => date.slice(0, 7);

export function periodEnd(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, '0')}`;
}
