// Gross margin uses the selling price as its denominator, before discounts and fees.
export function grossMarginPercent(price, cost) {
  if (price == null || cost == null || price === '' || cost === '') return null;
  const sales = Number(price), basis = Number(cost);
  if (!Number.isFinite(sales) || !Number.isFinite(basis) || sales <= 0 || basis < 0) return null;
  const percent = Math.round((sales - basis) / sales * 1000) / 10;
  return Number.isFinite(percent) ? (percent === 0 ? 0 : percent) : null;
}

const percentFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
export function formatGrossMargin(price, cost) {
  const percent = grossMarginPercent(price, cost);
  return percent == null ? '-' : `${percentFormat.format(percent)}%`;
}
