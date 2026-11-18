// Dòng tiền chi có cả hàng mua vào kho. Không cộng tổng này vào Chi phí tính lãi.
export function summarizeSpending(entries) {
  const groups = new Map(); let total = 0, stock = 0, expense = 0;
  for (const e of entries) {
    const amount = Number(e.amount) || 0;
    total += amount; if (e.kind === 'stock') stock += amount; else expense += amount;
    const name = e.category || 'Khác'; groups.set(name, (groups.get(name) || 0) + amount);
  }
  return { total, stock, expense, byCategory: [...groups].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount) };
}

export async function readSpendingEntries(client, { from, to }) {
  const entries = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const rows = await client.select('ops_spending_entries', `select=id,receipt_id,paid_date,name,category,kind,amount,payment_source&paid_date=gte.${from}&paid_date=lt.${to}&order=paid_date.desc,id.asc&limit=500&offset=${offset}`);
    entries.push(...rows); if (rows.length < 500) return entries;
  }
  throw new Error('Quá nhiều dòng chi tiền, chọn kỳ ngắn hơn.');
}
