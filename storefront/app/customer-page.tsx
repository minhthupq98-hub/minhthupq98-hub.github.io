import StorefrontView from "./storefront-view";
import { emptyStorefront, parseStorefront } from "../lib/storefront";
import { SHOP_SLUG, SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "../lib/supabase-public";
export default async function CustomerPage({ initialPanel }: { initialPanel?: "overview" | "orders" } = {}) {
  let storefront = emptyStorefront;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_storefront`, { method: "POST", headers: { apikey: SUPABASE_PUBLIC_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ p_shop_slug: SHOP_SLUG }), cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (response.ok) storefront = parseStorefront(await response.json());
  } catch { /* The client offers retry; never substitute made-up menu prices. */ }
  return <StorefrontView initialStorefront={storefront} initialPanel={initialPanel}/>;
}
