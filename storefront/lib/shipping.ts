export const SHIPPING_ORIGIN = "138 đường 30/4, phường Dương Đông, Phú Quốc";
export const SHIPPING_PROVIDER = "Hiship Phú Quốc";
export type ShippingZone = { id: string; name: string; min: number; max: number; aliases: string[] };
// Transcribed from the Hiship shop tariff supplied by the owner. Prices are VND,
// zone based, and not a per-km formula or a live courier booking quote.
export const SHIPPING_ZONES: ShippingZone[] = [
  { id: "duong-dong", name: "Nội ô Dương Đông", min: 10000, max: 10000, aliases: [] },
  { id: "cmt8", name: "CMT8", min: 15000, max: 15000, aliases: ["CMT8", "CMT 8", "Cách Mạng Tháng Tám", "Cách Mạng Tháng 8"] },
  { id: "67ha", name: "67HA", min: 20000, max: 20000, aliases: ["67HA", "67 HA"] },
  { id: "bung-goi", name: "Búng Gội", min: 30000, max: 30000, aliases: ["Búng Gội"] },
  { id: "ong-lang", name: "Ông Lang", min: 40000, max: 45000, aliases: ["Ông Lang"] },
  { id: "cua-can", name: "Cửa Cạn", min: 60000, max: 80000, aliases: ["Cửa Cạn"] },
  { id: "grandworld", name: "Grandworld", min: 100000, max: 100000, aliases: ["Grandworld", "Grand World"] },
  { id: "ganh-dau", name: "Gành Dầu", min: 130000, max: 130000, aliases: ["Gành Dầu"] },
  { id: "holiday", name: "Holiday", min: 15000, max: 15000, aliases: ["Holiday"] },
  { id: "cau-ba-keo", name: "Cầu Bà Kèo", min: 20000, max: 20000, aliases: ["Cầu Bà Kèo"] },
  { id: "cau-ba-phong", name: "Cầu Bà Phong", min: 25000, max: 25000, aliases: ["Cầu Bà Phong"] },
  { id: "suoi-may", name: "Suối Mây", min: 30000, max: 35000, aliases: ["Suối Mây"] },
  { id: "cho-duong-bao", name: "Chợ Đường Bào", min: 50000, max: 50000, aliases: ["Chợ Đường Bào"] },
  { id: "san-bay", name: "Sân bay", min: 55000, max: 55000, aliases: ["Sân bay", "Phu Quoc Airport"] },
  { id: "bai-truong", name: "Bãi Trường", min: 70000, max: 70000, aliases: ["Bãi Trường"] },
  { id: "dia-trung-hai", name: "Địa Trung Hải", min: 120000, max: 120000, aliases: ["Địa Trung Hải", "Sunset Town"] },
  { id: "ben-tram", name: "Bến Tràm", min: 20000, max: 20000, aliases: ["Bến Tràm"] },
  { id: "cay-thong-ngoai", name: "Cây Thông Ngoài", min: 25000, max: 40000, aliases: ["Cây Thông Ngoài"] },
  { id: "cay-thong-trong", name: "Cây Thông Trong", min: 35000, max: 40000, aliases: ["Cây Thông Trong"] },
  { id: "suoi-da-ban", name: "Suối Đá Bàn", min: 30000, max: 45000, aliases: ["Suối Đá Bàn"] },
  { id: "k8", name: "K8", min: 35000, max: 40000, aliases: ["K8", "K 8"] },
  { id: "vong-xoay-moi", name: "Vòng xoay mới", min: 50000, max: 50000, aliases: ["Vòng xoay mới"] },
  { id: "rach-vem", name: "Rạch Vẹm", min: 110000, max: 110000, aliases: ["Rạch Vẹm"] },
  { id: "bai-thom", name: "Bãi Thơm", min: 150000, max: 180000, aliases: ["Bãi Thơm"] },
  { id: "cong-chao-suoi-da", name: "Cổng chào Suối Đá", min: 20000, max: 20000, aliases: ["Cổng chào Suối Đá"] },
  { id: "nga-3-so-10", name: "Ngã 3 số 10", min: 45000, max: 45000, aliases: ["Ngã 3 số 10", "Ngã ba số 10"] },
  { id: "ham-ninh", name: "Hàm Ninh", min: 70000, max: 70000, aliases: ["Hàm Ninh"] },
  { id: "suoi-lon", name: "Suối Lớn", min: 80000, max: 80000, aliases: ["Suối Lớn"] },
  { id: "chua-ho-quoc", name: "Chùa Hộ Quốc", min: 110000, max: 110000, aliases: ["Chùa Hộ Quốc"] },
  { id: "bon-con-cho", name: "Bốn Con Chó", min: 120000, max: 120000, aliases: ["Bốn Con Chó", "4 Con Chó"] },
  { id: "an-thoi", name: "An Thới", min: 130000, max: 130000, aliases: ["An Thới"] },
];
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function suggestedZones(address: string): ShippingZone[] {
  const text = ` ${normalize(address)} `;
  return SHIPPING_ZONES.filter(zone => zone.aliases.some(alias => text.includes(` ${normalize(alias)} `)));
}
export function shippingZone(address: string, selectedId: string): ShippingZone | null {
  if (selectedId === "unknown") return null;
  if (selectedId) return SHIPPING_ZONES.find(zone => zone.id === selectedId) || null;
  const matches = suggestedZones(address);
  return matches.length === 1 ? matches[0] : null;
}
export function feeLabel(zone: Pick<ShippingZone, "min" | "max">): string {
  const value = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
  return zone.min === zone.max ? `${value(zone.min)} ₫` : `${value(zone.min)}–${value(zone.max)} ₫`;
}
export function deliveryBudget(itemTotal: number, zone: ShippingZone | null): { min: number; max: number } | null {
  if (!Number.isSafeInteger(itemTotal) || itemTotal < 0) throw new Error("Invalid item total");
  return zone ? { min: itemTotal + zone.min, max: itemTotal + zone.max } : null;
}
export function shippingOrderNote(note: string, fulfillment: string, zone: ShippingZone | null): string {
  if (fulfillment !== "delivery") return note.trim();
  const quote = zone ? `${zone.name}: ${feeLabel(zone)}` : "Khu vực khác/chưa rõ: quán xác nhận phí trước khi giao";
  return `[${SHIPPING_PROVIDER}] Lấy tại ${SHIPPING_ORIGIN}. Phí ship tham khảo ${quote}. Ship trả riêng tài xế, không cộng vào QR tiền món.${note.trim() ? `\n${note.trim()}` : ""}`;
}
