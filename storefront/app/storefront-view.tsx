"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { SHOP_SLUG, SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "../lib/supabase-public";
import { ICE_OPTIONS, SWEETNESS_OPTIONS, isExclusiveModifier, modifierSection, applicableExtras, categoryEnglish, description, DRINK_CATEGORIES, linePrice, MODIFIER_CATEGORIES, orderItems, parseStorefront, productName, reconcileCart, type CartLine, type CatalogProduct, type Storefront } from "../lib/storefront";
import ShippingQuote from "./shipping-quote";
import { SHIPPING_ORIGIN, deliveryBudget, feeLabel, shippingZone, shippingOrderNote, type ShippingZone } from "../lib/shipping";
import "./order.css";

const money = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + " ₫";
const CART_KEY = "khe-live-cart-v2";
type Database = { public: {
  Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>;
  Functions: {
    get_customer_addresses: { Args: { p_shop_slug: string }; Returns: CustomerAddress[] };
    update_customer_profile: { Args: { p_shop_slug: string; p_name: string; p_birth_date: string | null }; Returns: unknown };
    save_customer_address: { Args: { p_shop_slug: string; p_address_id: string | null; p_label: string; p_address: string; p_is_default: boolean }; Returns: unknown };
    get_customer_account: { Args: { p_shop_slug: string }; Returns: Account };
    get_customer_pin_status: { Args: { p_shop_slug: string }; Returns: { mustChangePin: boolean } };
    request_customer_pin_reset: { Args: { p_shop_slug: string; p_phone: string; p_name: string }; Returns: { message: string } };
    complete_customer_pin_change: { Args: { p_shop_slug: string }; Returns: boolean };
    prepare_online_order: { Args: { p_shop_slug: string; p_customer_name: string; p_items: ReturnType<typeof orderItems>; p_fulfillment_type: string; p_delivery_address: string; p_note: string; p_points_redeemed: number; p_voucher_id: string | null }; Returns: Draft };
    submit_online_order: { Args: { p_draft_id: string }; Returns: { code: string } };
  };
} };
let browserClient: SupabaseClient<Database> | undefined;
function client() {
  browserClient ??= createClient<Database>(SUPABASE_URL, SUPABASE_PUBLIC_KEY, { auth: { storageKey: "the-khe-customer-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  return browserClient;
}
async function publicMenu() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_storefront`, { method: "POST", headers: { apikey: SUPABASE_PUBLIC_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ p_shop_slug: SHOP_SLUG }), cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Menu unavailable");
  return parseStorefront(await response.json());
}
type Voucher = { id: string; amount: number; minimumOrder: number };
type CustomerAddress = { id: string; label: string; address: string; isDefault: boolean };
type CustomerOrder = { id: string; code: string; createdAt: string; fulfillmentType: string; items: { name: string; qty: number }[]; revenue: number; status: string; pointsEarned?: number; pointsRedeemed?: number };
type Account = { name?: string; phone?: string; birthDate?: string; pointsBalance?: number; discountPercent?: number; vouchers?: Voucher[]; tierName?: string; programName?: string; rollingSpend?: number; nextTierName?: string; spendToNextTier?: number; benefits?: string[]; orders?: CustomerOrder[]; pointHistory?: { id: string; note: string; createdAt: string; points: number }[] };
function accountDate(value: string, en: boolean) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(en ? "en-GB" : "vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bangkok" }).format(date);
}
type Draft = { draftId: string; total: number; bankCode: string; bankAccount: string; bankAccountName: string; paymentReference: string };
function ProductImage({ product, className = "", eager = false }: { product: CatalogProduct; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  return product.imageUrl && !failed ? <img className={className} src={product.imageUrl} alt={product.name} loading={eager ? "eager" : "lazy"} onError={() => setFailed(true)}/> : <span className="khe-photo-fallback" aria-label={product.name}>{product.icon}<small>THE KHE</small></span>;
}
function Icon({ name, size = 20 }: { name: "search" | "bag" | "plus" | "arrow" | "chevron" | "pin" | "cup" | "grid" | "sugar" | "ice" | "user"; size?: number }) {
  const paths = {
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    bag: <><path d="M5 7h14l1 14H4L5 7Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    chevron: <path d="m6 9 6 6 6-6"/>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
    cup: <><path d="m6 8 2 13h9l2-13M4 8h17M15 8l2-6"/><path d="M10 13h.01M15 13h.01m-5 3c2 2 3 2 5 0"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    sugar: <><path d="m12 3 8 5v9l-8 5-8-5V8l8-5Zm-8 5 8 5 8-5m-8 5v9m-4-17 8 5"/></>,
    ice: <><path d="m12 3 8 5v9l-8 5-8-5V8l8-5Zm-8 5 8 5 8-5m-8 5v9"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function OptionGroup({ title, icon, hint, selection, children, defaultOpen = false }: { title: string; icon: "sugar" | "ice" | "grid" | "cup"; hint: string; selection: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return <details className="khe-option-group" open={defaultOpen || undefined}><summary><span className="khe-group-icon"><Icon name={icon}/></span><span className="khe-group-heading"><strong>{title}</strong><small>{hint}</small></span><span className="khe-group-selected">{selection}</span><Icon name="chevron" size={17}/></summary><div className="khe-option-content">{children}</div></details>;
}
function Dialog({ title, close, children, kind = "cart" }: { title: string; close: () => void; children: React.ReactNode; kind?: "cart" | "product" }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    function keydown(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab") return;
      const elements = ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),textarea,a[href],select");
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  return <div className="khe-overlay" onClick={close}><section ref={ref} className={`khe-dialog khe-${kind}-dialog`} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}><button className="khe-close" onClick={close} aria-label="Đóng / Close">×</button>{children}</section></div>;
}

export default function StorefrontView({ initialStorefront, initialPanel }: { initialStorefront: Storefront; initialPanel?: "overview" | "orders" }) {
  const [store, setStore] = useState(initialStorefront);
  const [en, setEn] = useState(false);
  const [category, setCategory] = useState("Bán chạy");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const savedCart = useRef<unknown>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [menuError, setMenuError] = useState(false);
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const [qty, setQty] = useState(1);
  const [sugar, setSugar] = useState("Bình thường");
  const [ice, setIce] = useState("Đá chung");
  const [note, setNote] = useState("");
  const [extras, setExtras] = useState<string[]>([]);
  const [bag, setBag] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [mode, setMode] = useState("pickup");
  const [address, setAddress] = useState("");
  const [shippingZoneId, setShippingZoneId] = useState("");
  const [draftShipping, setDraftShipping] = useState<{ zone: ShippingZone | null; destination: string } | null>(null);
  const [orderNote, setOrderNote] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [memberOpen, setMemberOpen] = useState(!!initialPanel);
  const [memberTab, setMemberTab] = useState<string>(initialPanel || "overview");
  const [accountRevision, setAccountRevision] = useState(0);
  const [profileName, setProfileName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressDraft, setAddressDraft] = useState<{ id: string | null; label: string; address: string; isDefault: boolean } | null>(null);
  const [mustChangePin, setMustChangePin] = useState(false);
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [authMode, setAuthMode] = useState("signin");
  const [authName, setAuthName] = useState("");
  const [points, setPoints] = useState(0);
  const [voucher, setVoucher] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [successCode, setSuccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const t = (vi: string, eng: string) => en ? eng : vi;
  const notify = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(""), 3500); };
  function friendly(error: unknown) {
    const text = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "";
    if (/invalid login credentials/i.test(text)) return t("Số điện thoại hoặc PIN chưa đúng.", "Phone number or PIN is incorrect.");
    if (/rate limit/i.test(text)) return t("Vui lòng chờ một chút rồi thử lại.", "Please wait a moment and try again.");
    return en ? "Unable to complete this step. Please retry or contact staff." : text || "Chưa kết nối được. Vui lòng thử lại.";
  }
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { const next = await publicMenu(); setStore(next); setMenuError(false); return next; }
    catch { setMenuError(true); return null; }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    try {
      setEn(localStorage.getItem("khe-language") === "en");
      savedCart.current = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (initialStorefront.available) setCart(reconcileCart(savedCart.current, initialStorefront.products).lines);
    } catch { /* Corrupt browser storage does not block menu access. */ }
    setLoaded(initialStorefront.available);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void refresh(), 60000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(interval); };
  }, [initialStorefront, refresh]);
  useEffect(() => {
    if (!store.available) return;
    if (!loaded) { setCart(reconcileCart(savedCart.current, store.products).lines); setLoaded(true); return; }
    setCart(current => reconcileCart(current, store.products).lines);
  }, [store, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); localStorage.setItem("khe-language", en ? "en" : "vi"); } catch { /* Storage is optional. */ }
    document.documentElement.lang = en ? "en" : "vi";
  }, [cart, en, loaded]);
  useEffect(() => {
    let active = true;
    const supabase = client();
    void supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setAuthReady(true); } });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { if (active) { setSession(next); setAuthReady(true); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    let active = true;
    setAccount(null); setAddresses([]); setAccountReady(false); setMustChangePin(false); setDraft(null);
    if (!session) return;
    void Promise.all([client().rpc("get_customer_account", { p_shop_slug: SHOP_SLUG }), client().rpc("get_customer_pin_status", { p_shop_slug: SHOP_SLUG }), client().rpc("get_customer_addresses", { p_shop_slug: SHOP_SLUG })]).then(([profile, status, savedAddresses]) => {
      if (!active) return;
      if (profile.error || status.error || savedAddresses.error) { setError(t("Chưa tải được tài khoản. Hãy thử lại hoặc đăng nhập lại.", "Unable to load your account. Please retry or sign in again.")); return; }
      setAccount(profile.data); setProfileName(profile.data?.name || ""); setBirthDate(profile.data?.birthDate || ""); setAddresses(savedAddresses.data || []); setCustomerName(name => name || profile.data?.name || ""); setMustChangePin(status.data?.mustChangePin === true); setAccountReady(true);
    }).catch(() => { if (active) setError("Unable to load account / Chưa tải được tài khoản"); });
    return () => { active = false; };
  // Account is fetched after a session change; language changes do not invalidate payment drafts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, accountRevision]);

  useEffect(() => {
    function followBookmark() {
      if (["#account", "#orders"].includes(window.location.hash)) {
        setBag(false); setMemberOpen(true); setMemberTab(window.location.hash === "#orders" ? "orders" : "overview");
      }
    }
    followBookmark(); window.addEventListener("hashchange", followBookmark);
    return () => window.removeEventListener("hashchange", followBookmark);
  }, []);

  const products = store.products.filter(p => !MODIFIER_CATEGORIES.has(p.category));
  const categoryOrder = ["Matcha", "Trà sữa", "Trà", "Cà phê", "Bánh", "Đồ tráng miệng", "Nước khác", "Mì"];
  const categories = [...new Set(products.map(p => p.category))].sort((a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b));
  const normalized = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
  const shown = products.filter(p => (category === "Bán chạy" || p.category === category) && normalized(p.name + " " + productName(p, true)).includes(normalized(search)));
  const count = cart.reduce((sum, l) => sum + l.qty, 0);
  const total = cart.reduce((sum, l) => sum + linePrice(l) * l.qty, 0);
  const deliveryQuote = shippingZone(address, shippingZoneId);
  const draftBudget = draftShipping && draft ? deliveryBudget(draft.total, draftShipping.zone) : null;
  const availableExtras = selected ? applicableExtras(selected, store.products) : [];
  const groups = [...new Set(["Topping", "Kích cỡ", ...availableExtras.map(modifierSection)])];
  const selectedPrice = selected ? selected.price + availableExtras.filter(p => extras.includes(p.id)).reduce((sum, p) => sum + p.price, 0) : 0;
  const heroProduct = products.find(p => p.name === "Matcha Latte" && p.imageUrl) || products.find(p => p.imageUrl);
  const optionName = (value: string) => !en ? value : ({ "Bình thường": "Regular", "Ít ngọt": "Less sweet", "50% ngọt": "50% sweet", "Không ngọt": "No sugar", "Ít đá": "Less ice", "Nhiều đá": "Extra ice", "Không đá": "No ice", "Đổi sữa": "Milk", "Đổi bột": "Matcha upgrade", "Topping": "Toppings", "Khác": "Other", "Upsize": "Upsize", "Kích cỡ": "Size", "Đá chung": "Ice in cup", "Đá riêng": "Ice on the side", "30% ngọt": "30% sweet", "120% ngọt": "120% sweet" }[value] || value);
  function open(product: CatalogProduct) { setSelected(product); setQty(1); setSugar("Bình thường"); setIce("Đá chung"); setNote(""); setExtras([]); }
  function toggleExtra(product: CatalogProduct) {
    setExtras(current => {
      if (current.includes(product.id)) return current.filter(id => id !== product.id);
      const exclusive = isExclusiveModifier(product);
      return [...current.filter(id => { const existing = availableExtras.find(p => p.id === id); return !!existing && (!exclusive || modifierSection(existing) !== modifierSection(product)); }), product.id];
    });
  }
  function add() {
    if (!selected) return;
    const selectedExtras = availableExtras.filter(p => extras.includes(p.id));
    const key = JSON.stringify([selected.id, sugar, ice, note.trim(), [...extras].sort()]);
    setCart(current => current.some(l => l.key === key) ? current.map(l => l.key === key ? { ...l, qty: Math.min(99, l.qty + qty) } : l) : [...current, { key, product: selected, qty, sugar, ice, note: note.trim(), extras: selectedExtras }]);
    setSelected(null); setDraft(null); notify(t("Đã thêm vào giỏ của bạn", "Added to your bag"));
  }
  function change(key: string, delta: number) { setCart(current => current.map(l => l.key === key ? { ...l, qty: Math.min(99, l.qty + delta) } : l).filter(l => l.qty > 0)); setDraft(null); }
  async function authenticate(e: React.FormEvent) {
    e.preventDefault(); if (inFlight.current) return;
    const digits = phone.replace(/\D/g, "").replace(/^84(?=\d{9}$)/, "0");
    if (!/^0\d{9}$/.test(digits)) { setError(t("Nhập số điện thoại Việt Nam gồm 10 số, hoặc +84.", "Enter a Vietnamese 10-digit phone number, or +84. International guests can order at the counter.")); return; }
    if (authMode !== "forgot" && !/^\d{6}$/.test(pin)) { setError(t("PIN phải gồm 6 số.", "Your PIN must contain 6 digits.")); return; }
    if (authMode === "forgot" && authName.trim().length < 2) { setError(t("Nhập tên đã dùng khi đặt hàng.", "Enter the name used for your orders.")); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (authMode === "forgot") {
        const result = await client().rpc("request_customer_pin_reset", { p_shop_slug: SHOP_SLUG, p_phone: digits, p_name: authName.trim() });
        if (result.error) throw result.error;
        notify(t("Đã gửi yêu cầu. Quán sẽ xác minh và cấp PIN tạm.", "Request sent. Staff will verify your details and issue a temporary PIN."));
      } else {
        const credentials = { email: `c84${digits.slice(1)}@login.thekhe.app`, password: pin };
        const result = authMode === "signin" ? await client().auth.signInWithPassword(credentials) : await client().auth.signUp({ ...credentials, options: { data: { customer_phone: digits } } });
        if (result.error) throw result.error;
        if (!result.data.session) setError(t("Tài khoản chưa được kích hoạt. Vui lòng liên hệ quán.", "Your account needs activation. Please contact staff."));
        setPin("");
      }
    } catch (cause) { setError(friendly(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function changePin(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin) || pin !== pinConfirm || /^(\d)\1{5}$/.test(pin) || ["123456", "654321"].includes(pin)) { setError(t("Nhập hai PIN trùng nhau gồm 6 số, tránh PIN quá dễ đoán.", "Enter matching 6-digit PINs. Avoid easily guessed PINs.")); return; }
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const updated = await client().auth.updateUser({ password: pin }); if (updated.error) throw updated.error;
      const completed = await client().rpc("complete_customer_pin_change", { p_shop_slug: SHOP_SLUG }); if (completed.error) throw completed.error;
      setMustChangePin(false); setPin(""); setPinConfirm(""); notify(t("Đã đổi PIN.", "PIN updated."));
    } catch (cause) { setError(friendly(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function prepare() {
    if (inFlight.current || !session || !accountReady || mustChangePin || !cart.length) return;
    if (customerName.trim().length < 2 || (mode === "delivery" && address.trim().length < 5)) { setError(t("Nhập tên người nhận và địa chỉ giao hàng (nếu giao tận nơi).", "Enter the recipient name and delivery address if applicable.")); return; }
    if (mode === "delivery" && !deliveryQuote && shippingZoneId !== "unknown") { setError(t("Chọn khu vực giao hàng để xem phí ship, hoặc chọn Chưa rõ để quán xác nhận.", "Choose a delivery area to see the fee, or select Not sure for staff confirmation.")); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const latest = await publicMenu(); setStore(latest);
      if (!latest.available || !latest.paymentReady) throw new Error("Quán đang tạm ngưng nhận đơn online.");
      const reconciled = reconcileCart(cart, latest.products);
      if (reconciled.changed) { setCart(reconciled.lines); setError(t("Menu vừa thay đổi. Hãy kiểm tra lại món và giá trước khi tiếp tục.", "The menu has changed. Please review items and prices before continuing.")); return; }
      const result = await client().rpc("prepare_online_order", { p_shop_slug: SHOP_SLUG, p_customer_name: customerName.trim(), p_items: orderItems(reconciled.lines), p_fulfillment_type: mode, p_delivery_address: mode === "delivery" ? address.trim() : "", p_note: shippingOrderNote(orderNote, mode, deliveryQuote), p_points_redeemed: points, p_voucher_id: voucher || null });
      if (result.error) throw result.error;
      const data = result.data;
      if (!data || typeof data.draftId !== "string" || !Number.isSafeInteger(data.total) || data.total < 0 || !data.bankCode || !data.bankAccount || !data.bankAccountName || !data.paymentReference) throw new Error("Chưa nhận được thông tin thanh toán hợp lệ. Vui lòng liên hệ quán.");
      setDraftShipping(mode === "delivery" ? { zone: deliveryQuote, destination: address.trim() } : null);
      setDraft(data);
    } catch (cause) { setError(friendly(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function submit() {
    if (!draft || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await client().rpc("submit_online_order", { p_draft_id: draft.draftId });
      if (result.error) throw result.error;
      if (!result.data?.code) throw new Error("Chưa nhận được mã đơn. Hãy kiểm tra lịch sử đơn trước khi gửi lại.");
      setSuccessCode(String(result.data.code)); setCart([]); setDraft(null); setPoints(0); setVoucher(""); setAccountRevision(r => r + 1);
    } catch (cause) { setError(friendly(cause) + " " + t("Nếu kết nối bị ngắt, hãy kiểm tra lịch sử đơn trước khi gửi lại.", "If the connection dropped, check your order history before retrying.")); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function changeDeliveryAddress(value: string) { setAddress(value); setShippingZoneId(""); setDraft(null); setDraftShipping(null); }
  function changeDeliveryZone(value: string) { setShippingZoneId(value); setDraft(null); setDraftShipping(null); }
  function closeBag() { if (!busy) setBag(false); }
  const qr = draft ? `https://img.vietqr.io/image/${encodeURIComponent(draft.bankCode)}-${encodeURIComponent(draft.bankAccount)}-compact2.png?amount=${draft.total}&addInfo=${encodeURIComponent(draft.paymentReference)}&accountName=${encodeURIComponent(draft.bankAccountName)}` : "";

  function closeAccount() {
    if (busy) return;
    setMemberOpen(false);
    if (initialPanel) window.history.replaceState(null, "", "/");
  }
  async function signOut() {
    if (inFlight.current) return;
    setBusy(true); inFlight.current = true;
    try { const result = await client().auth.signOut(); if (result.error) throw result.error; setAccount(null); setAddresses([]); setAddressDraft(null); setPoints(0); setVoucher(""); setDraft(null); setPin(""); setError(""); }
    catch (cause) { setError(friendly(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault(); if (inFlight.current || !session || profileName.trim().length < 2) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await client().rpc("update_customer_profile", { p_shop_slug: SHOP_SLUG, p_name: profileName.trim(), p_birth_date: birthDate || null });
      if (result.error) throw result.error;
      setAccountRevision(r => r + 1); notify(t("Đã lưu thông tin thành viên.", "Your profile was updated."));
    } catch (cause) { setError(friendly(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function saveAddress(e: React.FormEvent) {
    e.preventDefault(); if (inFlight.current || !session || !addressDraft || addressDraft.address.trim().length < 5) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await client().rpc("save_customer_address", { p_shop_slug: SHOP_SLUG, p_address_id: addressDraft.id, p_label: addressDraft.label.trim() || t("Nhà", "Home"), p_address: addressDraft.address.trim(), p_is_default: addressDraft.isDefault });
      if (result.error) throw result.error;
      setAddressDraft(null); setAccountRevision(r => r + 1); notify(t("Đã lưu địa chỉ.", "Address saved."));
    } catch (cause) { setError(friendly(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const authForm = <form className="khe-auth" onSubmit={authenticate}><h3>{authMode === "forgot" ? t("Quên PIN", "Forgot PIN") : authMode === "signup" ? t("Tạo tài khoản Khe", "Create a Khe account") : t("Chào bạn quay lại", "Welcome back")}</h3><p>{t("Dùng số điện thoại Việt Nam và PIN của tài khoản Khe. Khách chưa có số Việt Nam vui lòng đặt tại quầy.", "Use your Vietnamese phone number and Khe PIN. Guests without a Vietnamese number can order at the counter.")}</p><label className="khe-field">{t("Số điện thoại", "Phone number")}<input required type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={20} onChange={e => setPhone(e.target.value)} placeholder="0901 234 567 / +84…"/></label>{authMode === "forgot" ? <label className="khe-field">{t("Tên đã dùng đặt món", "Name used for orders")}<input required autoComplete="name" maxLength={80} value={authName} onChange={e => setAuthName(e.target.value)}/></label> : <label className="khe-field">{t("PIN 6 số", "6-digit PIN")}<input required type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete={authMode === "signup" ? "new-password" : "current-password"} value={pin} onChange={e => setPin(e.target.value)}/></label>}<button className="khe-primary khe-full" disabled={busy} type="submit">{busy ? t("Đang xử lý…", "Please wait…") : authMode === "forgot" ? t("Gửi yêu cầu đặt lại PIN", "Request PIN reset") : authMode === "signup" ? t("Tạo tài khoản", "Create account") : t("Đăng nhập", "Sign in")}</button><div className="khe-auth-links">{["signin", "signup", "forgot"].filter(v => v !== authMode).map(v => <button type="button" disabled={busy} key={v} onClick={() => { setAuthMode(v); setError(""); setPin(""); }}>{v === "signin" ? t("Đăng nhập", "Sign in") : v === "signup" ? t("Tạo tài khoản", "Create account") : t("Quên PIN?", "Forgot PIN?")}</button>)}</div></form>;
  const pinForm = <form onSubmit={changePin}><h3>{t("Đổi PIN tạm trước khi đặt món", "Replace your temporary PIN before ordering")}</h3><label className="khe-field">{t("PIN mới 6 số", "New 6-digit PIN")}<input required type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin} onChange={e => setPin(e.target.value)}/></label><label className="khe-field">{t("Nhập lại PIN", "Confirm PIN")}<input required type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pinConfirm} onChange={e => setPinConfirm(e.target.value)}/></label><button type="submit" className="khe-primary khe-full" disabled={busy}>{t("Lưu PIN mới", "Save new PIN")}</button></form>;
  return <div className="khe-site">
    <header className="khe-header"><a className="khe-logo" href="#" aria-label="THE KHE"><img src="/the-khe-logo.png" alt=""/><span>THE KHE<small>TEA, COFFEE & LITTLE JOYS</small></span></a><nav><a href="#menu">{t("Thực đơn", "Our menu")}</a><a href="#delivery">{t("Phí giao hàng", "Delivery fees")}</a><a href="/account">{t("Hội nhà Khe", "Khe members")}</a></nav><div className="khe-header-actions"><div className="khe-language" aria-label="Language"><button aria-pressed={!en} onClick={() => setEn(false)}>VI</button><button aria-pressed={en} onClick={() => setEn(true)}>EN</button></div><a className="khe-member-button" href="/account" aria-label={t("Tài khoản và lịch sử đơn", "Account and order history")}><Icon name="user" size={18}/></a><button className="khe-bag" onClick={() => { setBag(true); setError(""); }} aria-label={`${t("Giỏ món", "Your bag")} · ${count}`}><Icon name="bag"/><span>{count}</span></button></div></header>
    <main><section className="khe-hero"><div className="khe-hero-copy"><p className="khe-eyebrow"><span/> A LITTLE SIP. A LITTLE JOY.</p><h1>{t("Trà ngon", "Good sips,")}<br/>{t("mỗi ngày cùng", "happy days with")}<br/><span className="khe-highlight">THE KHE</span><span className="khe-title-spark" aria-hidden="true">✧</span></h1><p className="khe-intro">{t("Chọn một ly bạn thích. Thêm chút vui cho ngày mình!", "Your favourite cup. A little more joy in your day!")}</p><a className="khe-primary khe-hero-cta" href="#menu">{t("Mình gọi món nhé", "Let’s find your cup")} <Icon name="arrow" size={17}/></a></div><div className="khe-hero-art"><span className="khe-hero-blob"/><span className="khe-art-star" aria-hidden="true">✧</span>{heroProduct ? <ProductImage product={heroProduct} eager className="khe-hero-photo"/> : <span className="khe-hero-placeholder">THE KHE</span>}<span className="khe-art-sticker"><span>made with</span><strong>a little joy ♡</strong></span><span className="khe-doodle-cup" aria-hidden="true"><Icon name="cup" size={65}/></span><span className="khe-art-dot"/></div></section>
      <div className="khe-ticker" aria-hidden="true"><span>GOOD SIPS</span> ✳ <span>LITTLE MOMENTS</span> ✳ <span>THE KHE</span> ✳ <span>YOUR DAILY LITTLE JOY</span> ✳ <span>GOOD SIPS</span></div>
      <a className="khe-shipping-shortcut" href="#delivery"><Icon name="pin"/><span><strong>{t("Khe giao tới bạn", "A little joy, delivered")}</strong><small>{t("Xem phí ship theo khu vực · Hiship Phú Quốc", "Check area delivery fees · Hiship Phú Quốc")}</small></span><Icon name="arrow" size={17}/></a>
      <section id="menu" className="khe-menu">
        {store.available && <div className="khe-toolbar"><label className="khe-search"><Icon name="search"/><input aria-label={t("Tìm món", "Search menu")} placeholder={t("Tìm món bạn thích…", "Find your favourite…")} value={search} onChange={e => setSearch(e.target.value)}/>{search && <button onClick={() => setSearch("")} aria-label={t("Xóa tìm kiếm", "Clear search")}>×</button>}</label><nav aria-label={t("Nhóm món", "Menu categories")}><button aria-pressed={category === "Bán chạy"} className={category === "Bán chạy" ? "is-active" : ""} onClick={() => setCategory("Bán chạy")}><span aria-hidden="true">✦</span> {t("Bán chạy", "Bestsellers")}</button>{categories.map(cat => <button key={cat} aria-pressed={category === cat} className={category === cat ? "is-active" : ""} onClick={() => setCategory(cat)}>{en ? categoryEnglish[cat] || cat : cat}</button>)}</nav></div>}
        <div className="khe-section-head"><div><p className="khe-eyebrow">FIND YOUR LITTLE JOY</p><h2>{search ? t("Kết quả tìm món", "Your search results") : category === "Bán chạy" ? t("Bán chạy", "Bestsellers") : en ? categoryEnglish[category] || category : category}<span aria-hidden="true">✳</span></h2></div><span className="khe-menu-caption">{t("Một ly ngon, vui cả ngày.", "A lovely cup. A happier day.")}</span></div>
        {(!store.available || menuError) && <div className="khe-live-status" role="status"><span>{!store.available ? t("Chưa thể mở menu. Hãy làm mới hoặc liên hệ quán.", "The menu is unavailable. Please refresh or contact staff.") : t("Chưa làm mới được menu, hãy thử lại.", "Unable to refresh the menu. Please retry.")}</span><button disabled={refreshing} onClick={() => void refresh()}>{refreshing ? t("Đang tải…", "Refreshing…") : t("Làm mới ↻", "Refresh ↻")}</button></div>}
        {store.available && <><div className="khe-products">{shown.map(p => <article className="khe-product" key={p.id}><button className="khe-product-image" style={{ backgroundColor: p.color }} onClick={() => open(p)} aria-label={t("Tùy chọn ", "Customize ") + productName(p, en)}><ProductImage product={p}/></button><div className="khe-product-info"><h3><button onClick={() => open(p)}>{productName(p, en)}</button></h3><p>{description(p, en) || (en ? categoryEnglish[p.category] || p.category : p.category)}</p><div className="khe-product-price"><strong>{money(p.price)}</strong><button className="khe-product-add" onClick={() => open(p)} aria-label={t("Thêm ", "Add ") + productName(p, en)}><Icon name="plus"/></button></div></div></article>)}</div>{!shown.length && <div className="khe-no-results"><span>⌕</span><h3>{t("Chưa tìm thấy món bạn thích?", "Can’t find your favourite?")}</h3><button className="khe-primary" onClick={() => { setSearch(""); setCategory("Bán chạy"); }}>{t("Khám phá menu", "Explore the menu")}</button></div>}</>}
      </section>
      <section id="delivery" className="khe-delivery-section"><ShippingQuote address={address} onAddressChange={changeDeliveryAddress} zoneId={shippingZoneId} onZoneChange={changeDeliveryZone} itemTotal={total} en={en}/></section>
      <section id="how" className="khe-how"><div><p className="khe-eyebrow">MAKE YOURSELF AT HOME</p><h2>{t("Gọi món thật nhẹ nhàng.", "A little easier to order.")}</h2></div>{[["01", t("Tìm món yêu thích", "Find your favourite"), t("Xem ảnh thật và chọn món, topping hợp tâm trạng.", "Explore the real menu and choose your favourites and extras.")], ["02", t("Nhận tại quán hoặc giao tận nơi", "Pickup or delivery"), t("Đăng nhập bằng số điện thoại và PIN để dùng tài khoản Khe hiện có.", "Sign in with your Vietnamese phone number and PIN to use your Khe account.")], ["03", t("Chuyển khoản & gửi đơn", "Transfer & submit"), t("Dùng thông tin thanh toán từ quán, rồi bấm gửi đơn. Quán xác nhận tiền trước khi làm món.", "Use the shop’s payment details, then submit your order. Staff verify payment before preparing it.")]].map(([n, h, d]) => <article key={n}><span>{n}</span><h3>{h}</h3><p>{d}</p></article>)}</section>
    </main>
    <footer className="khe-footer"><div className="khe-footer-brand">THE KHE<span>coffee & little moments</span></div><div><p>{t("Hẹn bạn bên một ly ngon.", "See you over a lovely cup.")}</p>{store.pickupAddress && <address>{store.pickupAddress}</address>}<a className="khe-footer-account" href="/orders">{t("Tài khoản & lịch sử đơn", "Account & order history")}</a></div><span>thekhecoffee.com<a className="khe-staff-link" href="/operations">{t("Dành cho nhân viên", "Staff access")}</a></span></footer>
    {count > 0 && <button className="khe-mobile-cart" onClick={() => setBag(true)}><Icon name="bag"/><span><strong>{count} {t("món", "items")} · {money(total)}</strong><small>{t("Thêm chút vui vào giỏ", "A little joy in your bag")}</small></span><b>{t("Xem giỏ", "View bag")} <Icon name="arrow" size={16}/></b></button>}
    {message && <div className="khe-toast" role="status">✓ {message}</div>}
    {selected && <Dialog kind="product" title={t("Tùy chỉnh món", "Make it yours")} close={() => setSelected(null)}><div className="khe-sheet-handle"/><div className="khe-item-heading"><div className="khe-item-photo"><ProductImage product={selected}/></div><div><p className="khe-eyebrow">MAKE IT YOURS</p><h2>{productName(selected, en)}</h2><strong>{money(selected.price)}</strong></div></div>{description(selected, en) && <p className="khe-item-description">{description(selected, en)}</p>}<div className="khe-sheet-title"><h3>{t("Tùy chỉnh món", "Make it yours")}</h3><span>{t("Đúng gu của bạn", "Just your style")} ♡</span></div>
      {DRINK_CATEGORIES.has(selected.category) && <><OptionGroup title={t("Độ ngọt", "Sweetness")} icon="sugar" hint={t("Chọn 1 mức", "Choose one")} selection={sugar === "Bình thường" ? "100%" : sugar === "Không ngọt" ? "0%" : sugar.replace(" ngọt", "")} defaultOpen><fieldset className="khe-radio-row"><legend className="khe-sr-only">{t("Độ ngọt", "Sweetness")}</legend>{SWEETNESS_OPTIONS.map(v => <label key={v} className={sugar === v ? "is-selected" : ""}><input type="radio" name="sweetness" value={v} checked={sugar === v} onChange={() => setSugar(v)}/><span>{v === "Bình thường" ? "100%" : v === "Không ngọt" ? "0%" : v.replace(" ngọt", "")}</span></label>)}</fieldset></OptionGroup><OptionGroup title={t("Mức đá", "Ice level")} icon="ice" hint={t("Chọn 1 mức", "Choose one")} selection={optionName(ice)} defaultOpen><fieldset className="khe-radio-row khe-ice-options"><legend className="khe-sr-only">{t("Mức đá", "Ice level")}</legend>{ICE_OPTIONS.map(v => <label key={v} className={ice === v ? "is-selected" : ""}><input type="radio" name="ice" value={v} checked={ice === v} onChange={() => setIce(v)}/><span>{optionName(v)}</span></label>)}</fieldset></OptionGroup></>}
      {groups.map(group => {
        const items = availableExtras.filter(p => modifierSection(p) === group);
        const chosen = items.filter(p => extras.includes(p.id));
        const exclusive = group !== "Topping" && items.some(isExclusiveModifier);
        const summary = chosen.length ? `${chosen.length} ${t("đã chọn", "selected")}` : group === "Kích cỡ" ? t("Tiêu chuẩn", "Regular") : t("Tùy chọn", "Optional");
        return <OptionGroup key={group} title={optionName(group)} icon={group === "Kích cỡ" ? "cup" : "grid"} hint={exclusive ? t("Chọn tối đa 1", "Choose up to one") : t("Chọn theo sở thích", "Pick what you love")} selection={summary}>
          {!items.length ? <p className="khe-group-empty">{group === "Kích cỡ" ? t("Món này dùng kích cỡ tiêu chuẩn của quán.", "This item comes in the shop’s regular size.") : t("Món này chưa có topping thêm.", "No extra toppings for this item.")}</p> : <fieldset className="khe-modifier-list"><legend className="khe-sr-only">{optionName(group)}</legend>{exclusive && <label><input type="radio" name={`modifier-${group}`} checked={!chosen.length} onChange={() => setExtras(current => current.filter(id => !items.some(p => p.id === id)))}/><span>{group === "Kích cỡ" ? t("Tiêu chuẩn", "Regular") : t("Công thức gốc", "Original recipe")}</span><b>+0 ₫</b></label>}{items.map(p => <label key={p.id}><input type={exclusive ? "radio" : "checkbox"} name={`modifier-${group}`} checked={extras.includes(p.id)} onChange={() => toggleExtra(p)}/><span>{productName(p, en)}</span><b>+{money(p.price)}</b></label>)}</fieldset>}
        </OptionGroup>;
      })}
      <label className="khe-field khe-item-note">{t("Nhắn Khe một chút", "A little note for Khe")}<textarea value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder={t("Ví dụ: lưu ý dị ứng, không lấy ống hút…", "For example: allergies, no straw…")}/></label><div className="khe-dialog-bottom"><div className="khe-qty"><button disabled={qty <= 1} onClick={() => setQty(q => q - 1)} aria-label={t("Giảm số lượng", "Decrease quantity")}>−</button><b>{qty}</b><button disabled={qty >= 99} onClick={() => setQty(q => q + 1)} aria-label={t("Tăng số lượng", "Increase quantity")}>+</button></div><button className="khe-primary khe-add-item" onClick={add}><span>{t("Thêm vào giỏ", "Add to bag")}</span><strong>{money(selectedPrice * qty)}</strong><Icon name="plus" size={17}/></button></div>
    </Dialog>}
    {bag && <Dialog title={t("Giỏ món & đặt hàng", "Your bag & checkout")} close={closeBag}><p className="khe-eyebrow">YOUR LITTLE PICKS</p><h2>{successCode ? t("Quán đã nhận đơn", "Your order was received") : draft ? t("Thanh toán chuyển khoản", "Bank transfer") : t("Giỏ món của bạn", "Your lovely little bag")}</h2>
      {error && <p className="khe-error" role="alert">{error}</p>}
      {successCode ? <div className="khe-success"><span>✓</span><h3>{successCode}</h3><p>{t("Đơn đã gửi vào hệ thống của quán. Quán sẽ kiểm tra tiền vào trước khi làm món. Đây chưa phải xác nhận thanh toán.", "Your order is in the shop’s system. Staff will verify the transfer before preparing it. Payment has not yet been confirmed.")}</p><a className="khe-primary" href="/orders">{t("Xem lịch sử đơn", "View order history")}</a><button className="khe-text-button" onClick={() => { setSuccessCode(""); setCheckout(false); setBag(false); }}>{t("Tiếp tục xem menu", "Back to menu")}</button></div>
      : draft ? <><p>{t("Tiền món chuyển khoản cho quán", "Item payment to the shop")}</p><div className="khe-total"><b>{money(draft.total)}</b></div>{draftShipping && <section className="khe-draft-shipping"><h3>{t("Giao hàng từ THE KHE", "Delivery from THE KHE")}</h3><p><b>{t("Lấy tại", "From")}:</b> {SHIPPING_ORIGIN}</p><p><b>{t("Giao tới", "To")}:</b> {draftShipping.destination}</p><div><span>{t("Ship trả riêng tài xế", "Delivery paid separately")}</span><strong>{draftShipping.zone ? feeLabel(draftShipping.zone) : t("Quán xác nhận", "Staff to confirm")}</strong></div><div><span>{t("Tổng món + ship dự kiến", "Estimated items + delivery")}</span><b>{draftBudget ? feeLabel(draftBudget) : t("Chờ xác nhận phí ship", "Delivery fee pending")}</b></div></section>}<img className="khe-qr" src={qr} alt={t("QR chuyển khoản cho đơn này", "Bank transfer QR for this order")}/><dl className="khe-payment-details"><dt>{t("Ngân hàng", "Bank")}</dt><dd>{draft.bankCode}</dd><dt>{t("Số tài khoản", "Account number")}</dt><dd>{draft.bankAccount}</dd><dt>{t("Chủ tài khoản", "Account holder")}</dt><dd>{draft.bankAccountName}</dd><dt>{t("Nội dung chuyển khoản", "Transfer reference")}</dt><dd><strong>{draft.paymentReference}</strong></dd></dl><p className="khe-disclosure">{t("Chuyển đúng số tiền và nội dung trên. Sau khi chuyển khoản, bấm nút dưới để gửi đơn về quán. Quán sẽ kiểm tra tiền vào trước khi làm món.", "Transfer the exact amount using this reference. After transferring, press the button below to send your order. Staff will verify payment before preparing it.")}</p><button className="khe-primary khe-full" disabled={busy} onClick={() => void submit()}>{busy ? t("Đang gửi…", "Submitting…") : t("Tôi đã chuyển khoản · Gửi đơn", "I’ve transferred · Submit order")}</button><button className="khe-text-button" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>{t("Quay lại chỉnh thông tin", "Back to edit details")}</button></>
      : !cart.length ? <div className="khe-empty"><span>✳</span><h3>{t("Một chiếc giỏ chờ niềm vui", "A little bag waiting for joy")}</h3><button className="khe-primary" onClick={closeBag}>{t("Khám phá menu", "Explore the menu")}</button></div>
      : <>{cart.map(l => <div className="khe-cart-line" key={l.key}><span>{l.product.icon}</span><div><h3>{productName(l.product, en)}</h3>{DRINK_CATEGORIES.has(l.product.category) && <small>{t("Ngọt", "Sweetness")}: {optionName(l.sugar)} · {t("Đá", "Ice")}: {optionName(l.ice)}</small>}{l.extras.map(p => <small key={p.id}>+ {productName(p, en)} · {money(p.price)}</small>)}{l.note && <small>{l.note}</small>}<strong>{money(linePrice(l) * l.qty)}</strong></div><div className="khe-qty"><button disabled={busy} aria-label={t("Giảm ", "Decrease ") + productName(l.product, en)} onClick={() => change(l.key, -1)}>−</button><b>{l.qty}</b><button disabled={busy || l.qty >= 99} aria-label={t("Tăng ", "Increase ") + productName(l.product, en)} onClick={() => change(l.key, 1)}>+</button></div></div>)}<div className="khe-total"><span>{t("Tạm tính", "Subtotal")}</span><b>{money(total)}</b></div>
        {!checkout ? <><p className="khe-disclosure">{t("Đăng nhập để đặt món và sử dụng ưu đãi thành viên. Tổng thanh toán cuối cùng được tính tại bước tiếp theo.", "Sign in to order and use member benefits. The final total is calculated in the next step.")}</p><button className="khe-primary khe-full" disabled={!store.available || menuError} onClick={() => { setCheckout(true); setError(""); }}>{t("Tiếp tục đặt món", "Continue to checkout")} →</button></>
        : !authReady ? <p role="status">{t("Đang kiểm tra tài khoản…", "Checking your account…")}</p>
        : !session ? authForm
        : !accountReady ? <div><p>{t("Đang tải tài khoản. Nếu chờ lâu, hãy đăng nhập lại.", "Loading account. If this takes too long, sign in again.")}</p><button className="khe-text-button" onClick={() => void signOut()}>{t("Đăng xuất", "Sign out")}</button></div>
        : mustChangePin ? pinForm
        : <div className="khe-checkout"><div className="khe-member"><span>{account?.name || account?.phone || t("Thành viên Khe", "Khe member")}{" · "}{account?.pointsBalance || 0} {t("điểm", "points")}</span><button disabled={busy} onClick={() => void signOut()}>{t("Đăng xuất", "Sign out")}</button></div><label className="khe-field">{t("Tên người nhận", "Recipient name")}<input required value={customerName} minLength={2} maxLength={80} onChange={e => setCustomerName(e.target.value)} autoComplete="name"/></label><div className="khe-mode">{[["pickup", t("Tự đến lấy", "Pickup")], ["delivery", t("Giao hàng", "Delivery")]].map(([v, label]) => <button aria-pressed={mode === v} className={mode === v ? "is-active" : ""} key={v} disabled={busy} onClick={() => setMode(v)}>{label}</button>)}</div>{mode === "pickup" ? <p className="khe-pickup-address">{SHIPPING_ORIGIN}</p> : <>{!!addresses.length && <div className="khe-saved-addresses">{addresses.map(item => <button key={item.id} type="button" onClick={() => changeDeliveryAddress(item.address)} aria-pressed={address === item.address}><strong>{item.label}</strong><span>{item.address}</span></button>)}</div>}<label className="khe-field">{t("Địa chỉ giao hàng", "Delivery address")}<textarea required minLength={5} maxLength={500} value={address} onChange={e => changeDeliveryAddress(e.target.value)} autoComplete="street-address"/></label><ShippingQuote compact address={address} onAddressChange={changeDeliveryAddress} zoneId={shippingZoneId} onZoneChange={changeDeliveryZone} itemTotal={total} en={en}/></>}
          <label className="khe-field">{t("Ghi chú cho đơn", "Order note")}<textarea value={orderNote} maxLength={500} onChange={e => setOrderNote(e.target.value)}/></label>
          {(account?.pointsBalance || 0) > 0 && <label className="khe-field">{t("Điểm muốn dùng (bội số 10)", "Points to redeem (multiples of 10)")}<input type="number" min={0} max={account?.pointsBalance || 0} step={10} value={points} onChange={e => setPoints(Math.max(0, Math.floor(Number(e.target.value) / 10) * 10))}/><small>{t("Giới hạn và ưu đãi được hệ thống xác nhận ở bước thanh toán.", "Redemption limits and discounts are confirmed at payment.")}</small></label>}
          {!!account?.vouchers?.length && <label className="khe-field">Voucher<select value={voucher} onChange={e => setVoucher(e.target.value)}><option value="">{t("Không dùng voucher", "No voucher")}</option>{account.vouchers.map(v => <option value={v.id} key={v.id}>{money(v.amount)} · {t("Đơn từ", "Min.")} {money(v.minimumOrder)}</option>)}</select></label>}
          <button className="khe-primary khe-full" disabled={busy || !store.available || !store.paymentReady} onClick={() => void prepare()}>{busy ? t("Đang xác nhận giá…", "Confirming prices…") : t("Tiếp tục thanh toán", "Continue to payment")}</button>{!store.paymentReady && <p>{t("Quán chưa sẵn sàng nhận chuyển khoản online.", "Online bank transfer is currently unavailable.")}</p>}
        </div>}
      </>}
    </Dialog>}
    {memberOpen && <Dialog title={t("Hội nhà Khe", "Khe members")} close={closeAccount}>
      <p className="khe-eyebrow">YOUR LITTLE KHE CLUB</p><h2>{t("Hội nhà Khe", "Your Khe account")}</h2>
      {error && <p className="khe-error" role="alert">{error}</p>}
      {!authReady ? <p role="status">{t("Đang kiểm tra tài khoản…", "Checking your account…")}</p>
      : !session ? authForm
      : !accountReady ? <div><p role="status">{t("Đang tải tài khoản…", "Loading your account…")}</p><button className="khe-text-button" onClick={() => { setError(""); setAccountRevision(r => r + 1); }}>{t("Tải lại", "Retry")}</button><button className="khe-text-button" disabled={busy} onClick={() => void signOut()}>{t("Đăng xuất", "Sign out")}</button></div>
      : mustChangePin ? pinForm
      : <><div className="khe-member-greeting"><span>✦</span><div><strong>{account?.name || t("Chào bạn!", "Hello, you!")}</strong><small>{account?.phone}</small></div><button disabled={busy} onClick={() => void signOut()}>{t("Đăng xuất", "Sign out")}</button></div>
        <nav className="khe-account-tabs" aria-label={t("Tài khoản", "Account sections")}>{[["overview", t("Thành viên", "Membership")], ["orders", t("Đơn của bạn", "Your orders")], ["profile", t("Thông tin", "Profile")]].map(([value, label]) => <button key={value} disabled={busy} aria-pressed={memberTab === value} onClick={() => setMemberTab(value)}>{label}</button>)}</nav>
        {memberTab === "overview" && <div className="khe-account-overview"><section className="khe-tier-card"><p>{account?.programName || t("Hội nhà Khe", "Khe members")}</p><h3>{account?.tierName || t("Thành viên Khe", "Khe member")}</h3>{!!account?.discountPercent && <small>{t("Ưu đãi hạng", "Tier discount")} · {account.discountPercent}%</small>}{account?.nextTierName && <p>{t("Còn", "Spend another")} {money(account.spendToNextTier || 0)} {t("để lên", "to reach")} {account.nextTierName}</p>}</section><div className="khe-account-metrics"><article><small>{t("Điểm hiện có", "Your points")}</small><strong>{account?.pointsBalance || 0}</strong></article><article><small>{t("Chi tiêu 12 tháng", "12-month spend")}</small><strong>{money(account?.rollingSpend || 0)}</strong></article></div>
          {!!account?.benefits?.length && <section className="khe-account-card"><h3>{t("Quyền lợi của bạn", "Your member benefits")}</h3>{account.benefits.map(benefit => <p key={benefit}>✓ {benefit}</p>)}</section>}
          <section className="khe-account-card"><h3>{t("Voucher của bạn", "Your vouchers")}</h3>{!account?.vouchers?.length ? <p>{t("Chưa có voucher. Hẹn bạn thêm những ly ngon cùng Khe!", "No vouchers yet. More lovely cups await!")}</p> : account.vouchers.map(v => <article className="khe-voucher" key={v.id}><strong>{money(v.amount)}</strong><span>{t("Áp dụng cho đơn từ", "For orders from")} {money(v.minimumOrder)}</span></article>)}</section>
          {!!account?.pointHistory?.length && <details className="khe-account-card"><summary>{t("Lịch sử tích điểm", "Points history")}</summary>{account.pointHistory.map(item => <article className="khe-point-entry" key={item.id}><div><strong>{item.note}</strong><small>{accountDate(item.createdAt, en)}</small></div><b>{item.points > 0 ? "+" : ""}{item.points}</b></article>)}</details>}
        </div>}
        {memberTab === "orders" && <section className="khe-account-orders"><div className="khe-account-section-head"><h3>{t("Lịch sử đơn hàng", "Your order history")}</h3><button onClick={() => { setError(""); setAccountRevision(r => r + 1); }}>{t("Làm mới ↻", "Refresh ↻")}</button></div>{!account?.orders?.length ? <p className="khe-account-empty">{t("Bạn chưa có đơn nào. Chọn một ly bạn thích nhé!", "No orders yet. Find a cup you love!")}</p> : account.orders.map(order => <article className="khe-history-card" key={order.id}><header><strong>{order.code}</strong><span data-status={order.status}>{order.status === "completed" ? t("Đã làm", "Completed") : order.status === "cancelled" ? t("Đã hủy", "Cancelled") : t("Đang xử lý", "Processing")}</span></header><small>{accountDate(order.createdAt, en)} · {order.fulfillmentType === "delivery" ? t("Giao hàng", "Delivery") : t("Tự đến lấy", "Pickup")}</small><ul>{order.items.map((item, index) => <li key={index}><span>{item.qty} × {item.name}</span></li>)}</ul><footer><span>{t("Tổng món", "Order total")}</span><strong>{money(order.revenue)}</strong></footer>{(!!order.pointsEarned || !!order.pointsRedeemed) && <p>{order.pointsEarned ? `+${order.pointsEarned} ${t("điểm", "points")}` : ""}{order.pointsRedeemed ? ` · ${t("Đã dùng", "Redeemed")} ${order.pointsRedeemed} ${t("điểm", "points")}` : ""}</p>}</article>)}</section>}
        {memberTab === "profile" && <div><form className="khe-account-card" onSubmit={saveProfile}><h3>{t("Thông tin của bạn", "Your profile")}</h3><label className="khe-field">{t("Tên của bạn", "Your name")}<input required minLength={2} maxLength={80} value={profileName} onChange={e => setProfileName(e.target.value)} autoComplete="name"/></label><label className="khe-field">{t("Ngày sinh", "Date of birth")}<input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} autoComplete="bday"/></label><button type="submit" className="khe-primary khe-full" disabled={busy}>{t("Lưu thông tin", "Save profile")}</button></form>
          <section className="khe-account-card"><div className="khe-account-section-head"><h3>{t("Địa chỉ của bạn", "Your addresses")}</h3><button disabled={busy} onClick={() => setAddressDraft({ id: null, label: t("Nhà", "Home"), address: "", isDefault: !addresses.length })}>{t("+ Thêm", "+ Add")}</button></div>{!addresses.length && <p>{t("Chưa có địa chỉ lưu sẵn.", "No saved addresses yet.")}</p>}{addresses.map(item => <article className="khe-address-card" key={item.id}><strong>{item.label}{item.isDefault ? t(" · Mặc định", " · Default") : ""}</strong><p>{item.address}</p><button disabled={busy} onClick={() => setAddressDraft({ ...item })}>{t("Chỉnh sửa", "Edit")}</button></article>)}</section>
          {addressDraft && <form className="khe-account-card" onSubmit={saveAddress}><h3>{addressDraft.id ? t("Chỉnh địa chỉ", "Edit address") : t("Địa chỉ mới", "New address")}</h3><label className="khe-field">{t("Tên địa chỉ", "Address label")}<input required maxLength={50} value={addressDraft.label} onChange={e => setAddressDraft({ ...addressDraft, label: e.target.value })}/></label><label className="khe-field">{t("Địa chỉ giao hàng", "Delivery address")}<textarea required minLength={5} maxLength={500} value={addressDraft.address} onChange={e => setAddressDraft({ ...addressDraft, address: e.target.value })} autoComplete="street-address"/></label><label className="khe-address-default"><input type="checkbox" checked={addressDraft.isDefault} onChange={e => setAddressDraft({ ...addressDraft, isDefault: e.target.checked })}/>{t("Đặt làm địa chỉ mặc định", "Make this my default address")}</label><button type="submit" className="khe-primary khe-full" disabled={busy}>{t("Lưu địa chỉ", "Save address")}</button><button type="button" className="khe-text-button" disabled={busy} onClick={() => setAddressDraft(null)}>{t("Hủy", "Cancel")}</button></form>}
        </div>}
      </>}
    </Dialog>}
  </div>;
}
