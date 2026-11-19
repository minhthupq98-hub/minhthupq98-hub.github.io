export type CatalogProduct = {
  id: string; name: string; category: string; price: number; icon: string;
  color: string; imageUrl: string; description: string;
  modifierGroup: string; appliesToCategories: string[];
};
export type Storefront = { available: boolean; shopName: string; pickupAddress: string; paymentReady: boolean; products: CatalogProduct[] };
export type CartLine = { key: string; product: CatalogProduct; qty: number; sugar: string; ice: string; note: string; extras: CatalogProduct[] };
export const MODIFIER_CATEGORIES = new Set(["Extra đồ uống", "Topping đồ ăn", "Topping bánh"]);
export const DRINK_CATEGORIES = new Set(["Matcha", "Trà", "Trà sữa", "Cà phê", "Nước khác"]);
export const emptyStorefront: Storefront = { available: false, shopName: "THE KHE", pickupAddress: "", paymentReady: false, products: [] };
export function parseStorefront(value: unknown): Storefront {
  if (!value || typeof value !== "object") throw new Error("Invalid storefront response");
  const data = value as Record<string, unknown>;
  if (data.available !== true) return emptyStorefront;
  if (!Array.isArray(data.products)) throw new Error("Invalid menu");
  const products = data.products.map((item: Record<string, unknown>): CatalogProduct => {
    if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.category !== "string" || !Number.isSafeInteger(item.price) || Number(item.price) < 0) throw new Error("Invalid product");
    return { id: item.id, name: item.name, category: item.category, price: Number(item.price), icon: typeof item.icon === "string" ? item.icon : "🥤", color: typeof item.color === "string" ? item.color : "#e1e8d0", imageUrl: typeof item.imageUrl === "string" && /^https:\/\//.test(item.imageUrl) ? item.imageUrl : "", description: typeof item.description === "string" ? item.description : "", modifierGroup: typeof item.modifierGroup === "string" ? item.modifierGroup : "Topping", appliesToCategories: Array.isArray(item.appliesToCategories) ? item.appliesToCategories.filter((v): v is string => typeof v === "string") : [] };
  });
  return { available: true, shopName: typeof data.shopName === "string" ? data.shopName : "THE KHE", pickupAddress: typeof data.pickupAddress === "string" ? data.pickupAddress : "", paymentReady: data.paymentReady === true, products };
}
export const SWEETNESS_OPTIONS = ["Không ngọt", "30% ngọt", "50% ngọt", "Bình thường", "120% ngọt"] as const;
export const ICE_OPTIONS = ["Đá chung", "Đá riêng", "Không đá"] as const;
export function modifierSection(product: CatalogProduct) {
  // The current database labels existing Upsize items as Topping. Group their
  // explicit size names for display without changing database records or IDs.
  return product.modifierGroup === "Upsize" || /^upsize\b/i.test(product.name.trim()) ? "Kích cỡ" : product.modifierGroup;
}
export function isExclusiveModifier(product: CatalogProduct) {
  return ["Đổi sữa", "Đổi bột", "Kích cỡ"].includes(modifierSection(product));
}
export function applicableExtras(product: CatalogProduct, products: CatalogProduct[]) {
  return products.filter(p => MODIFIER_CATEGORIES.has(p.category) && p.appliesToCategories.includes(product.category));
}
export function linePrice(line: CartLine) { return line.product.price + line.extras.reduce((sum, e) => sum + e.price, 0); }
// Reconcile persisted selections against current active products and current prices.
export function reconcileCart(saved: unknown, products: CatalogProduct[]): { lines: CartLine[]; changed: boolean } {
  if (!Array.isArray(saved)) return { lines: [], changed: true };
  let changed = false;
  const lines: CartLine[] = [];
  for (const item of saved) {
    if (!item || typeof item !== "object") { changed = true; continue; }
    const product = products.find(p => p.id === item.product?.id && !MODIFIER_CATEGORIES.has(p.category));
    if (!product || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99 || typeof item.key !== "string") { changed = true; continue; }
    const allowed = applicableExtras(product, products);
    const groups = new Set<string>();
    const extras: CatalogProduct[] = [];
    for (const extra of Array.isArray(item.extras) ? item.extras : []) {
      const current = allowed.find(p => p.id === extra?.id);
      if (!current || extras.some(p => p.id === current.id)) { changed = true; continue; }
      if (isExclusiveModifier(current)) {
        if (groups.has(modifierSection(current))) { changed = true; continue; }
        groups.add(modifierSection(current));
      }
      if (current.price !== extra.price) changed = true;
      extras.push(current);
    }
    if (product.price !== item.product.price) changed = true;
    lines.push({ key: item.key, product, qty: item.qty, sugar: [...SWEETNESS_OPTIONS, "Ít ngọt"].includes(item.sugar) ? item.sugar : "Bình thường", ice: [...ICE_OPTIONS, "Bình thường", "Ít đá", "Nhiều đá"].includes(item.ice) ? item.ice : "Bình thường", note: typeof item.note === "string" ? item.note.slice(0, 300) : "", extras });
  }
  return { lines, changed };
}
export function orderItems(lines: CartLine[]) {
  return lines.map(l => ({ product_id: l.product.id, qty: l.qty, ice: DRINK_CATEGORIES.has(l.product.category) ? l.ice : "", sweetness: DRINK_CATEGORIES.has(l.product.category) ? l.sugar : "", note: l.note, extras: l.extras.map(p => p.id) }));
}
export const categoryEnglish: Record<string,string> = { "Matcha":"Matcha", "Trà":"Fruit tea", "Trà sữa":"Milk tea", "Cà phê":"Coffee", "Bánh":"Bakes", "Đồ tráng miệng":"Desserts", "Nước khác":"Other drinks", "Mì":"Noodles" };
const english: Record<string,string> = { "Ô Long Nhài Sữa":"Jasmine oolong milk tea", "Trà Sữa Truyền Thống":"Classic milk tea", "Bạc xỉu Caramel":"Caramel milk coffee", "Cà phê đen":"Vietnamese black coffee", "Cà phê sữa":"Vietnamese milk coffee", "Bạc xỉu bơ đậu phộng":"Peanut butter milk coffee", "Đổi sang OATSIDE":"Switch to OATSIDE", "Trà Khế":"Starfruit tea", "Kem cheese":"Cheese foam", "Matcha Kem Dẻo Oreo":"Oreo cream matcha", "Thêm trân châu":"Extra tapioca pearls", "Bánh Cheese Dẻo 8 Bánh":"Chewy cheese bites · 8 pieces", "Bưởi Hồng Lài":"Pink grapefruit jasmine tea", "Bạc xỉu":"Vietnamese white coffee", "Bánh Cheese Dẻo 12 Bánh":"Chewy cheese bites · 12 pieces", "Bánh Cheese Dẻo 4 Bánh Lớn":"Chewy cheese bites · 4 large pieces", "Sữa Chua Việt Quất":"Blueberry yogurt" };
export function productName(p: CatalogProduct, en: boolean) { return en ? english[p.name.trim()] || p.name : p.name; }
export function description(p: CatalogProduct, en: boolean) {
  if (!en) return p.description;
  const translated: Record<string,string> = { "Kèm topping trân châu đen":"Includes black tapioca pearls", "Kèm topping thạch nha đam":"Includes aloe vera jelly", "Kèm topping vụn dừa nướng":"Includes toasted coconut flakes", "Kèm topping thạch dừa":"Includes coconut jelly", "Sữa hạt":"Plant-based milk", "Phần 8 bánh":"8 pieces" };
  return translated[p.description] || p.description;
}
