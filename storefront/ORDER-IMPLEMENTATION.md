# THE KHE live customer storefront

Customer site: https://the-khe-order.minhthupq98.chatgpt.site

## Authoritative app and database

The user identified https://github.com/minhthupq98-hub/minhthupq98-hub.github.io as the running app. Inspected commit: 31f4dfec4c394c1ad01178494592eacf2b4f6c22, active bundle assets/index-BpABOaN7.js, README and SQL migrations. The repository contains compiled production assets and Supabase schemas, not the editable application source. The previous Sites app was not the authoritative running business app.

The live Supabase endpoint is https://exhtbbqenrtfxkbcxewr.supabase.co. lib/supabase-public.ts uses only the existing app's explicitly public publishable browser key. No service-role key, owner login or private table access is used.

## Public menu

`get_public_storefront({p_shop_slug: 'the-khe'})` supplies current active products, prices, images, descriptions, applicable modifier groups, shop pickup address and payment readiness. Server rendering and browser refresh both read this RPC. The browser refreshes every minute and on focus. At implementation time it returned 22 main products and 7 modifiers. No old 12-item sample menu remains.

The site exposes no cost, owner_id, private revenue, customer records or owner settings. Bank details are not serialized into the menu; payment instructions come from the authenticated order draft. Product/extra IDs and current prices are reconciled before checkout, and the database is authoritative for the final amount.

## Customer and order workflow

The customer browser client uses the existing app's `the-khe-customer-auth` storage key, phone-to-email convention and PIN login/signup. Sessions are origin-specific, so customers need to sign in on this site separately. Forgot PIN uses `request_customer_pin_reset`. Temporary PIN changes use `get_customer_pin_status`, auth.updateUser and `complete_customer_pin_change`.

`get_customer_account` supplies member profile, point balance and vouchers. Checkout calls `prepare_online_order` with product IDs, quantities, the existing ice/sweetness labels, extra IDs, pickup/delivery details, notes and optional loyalty redemption. It never sends client prices, owner IDs, cost or revenue. Final total and bank reference come from the returned draft. The customer explicitly confirms transfer before `submit_online_order({p_draft_id})`. Only a successful response with the actual order code displays receipt confirmation. This is not a claim that payment has been verified; staff retain their existing payment verification workflow.

No production customer accounts, drafts or orders were created during implementation or tests. No database migrations were applied. The GitHub entry page is updated separately to retire the old customer landing page while preserving staff operations. The storefront uses existing authorized RPCs and RLS. The `/operations` path redirects to the GitHub-hosted management app at `#/staff`. Customer account and history screens are native to the new storefront.

The existing system requires a Vietnamese phone number for PIN authentication. English language support does not change that backend constraint; guests without a Vietnamese number are directed to order at the counter.

## Validation and remaining checks

- `npx tsc --noEmit`
- `npm test`: build, 10 catalog/cart/payload tests and 2 Worker rendering/redirect tests.
- Real read-only `get_public_storefront` call succeeded; Supabase CORS preflight from the deployed site origin succeeded.
- The deployed page returned HTTP 200 and rendered all 22 main products, actual Supabase image URLs and the pickup address. `/operations` returned HTTP 307 to the GitHub staff app.
- Browser visual QA is unavailable because the managed Sites environment has no supported cua_repl.js entrypoint. Authenticated end-to-end checkout and actual transfer/submission require a customer session and were not executed against production.
- Custom domain remains subject to DNS verification; see DOMAIN-SETUP.md.

## Approved Matcha Pop redesign

The user selected concept 01 from the three-image style board. The storefront now uses warm ivory, forest green and bright matcha, self-hosted Nunito with its OFL license, a compact photo hero with cup doodles, clearly separated product cards and a fixed cart action. The first browsing tab is named Bán chạy / Bestsellers at the user's request and retains the shop's current public menu ordering; the public RPC exposes no sales ranking, so no sales counts or popularity order are invented. Categories remain based on the live menu.

Customer options are presented as accessible accordion groups with native radios and checkboxes: sweetness 0/30/50/100/120 percent, ice in cup/on the side/no ice, toppings, sizes and any additional applicable modifier groups. Existing saved cart choices remain compatible. The current database labels Upsize products as Topping; the UI groups their explicit Upsize names under Kích cỡ and allows only one size without changing database records. IDs, prices and category applicability still come from Supabase. The bottom-sheet add action remains visible while scrolling.

TypeScript, production build and all 12 tests pass. Browser visual QA remains unavailable in this managed environment because the required cua_repl.js entrypoint is absent; no substitute browser was installed. No production orders, accounts or database migrations were created while testing this redesign.

## Single-interface production cutover

All customer sign-in, PIN recovery/change, membership, vouchers, points history, order history, profile and saved-address screens are now native to Matcha Pop. The external customer fallback link and all customer-facing GitHub links are removed. Profile and address edits use the existing authenticated `update_customer_profile` and `save_customer_address` RPCs; viewing saved addresses uses `get_customer_addresses`. No private account data is server-rendered or stored in public content. Opening history refreshes the authenticated account data.

The GitHub Pages `index.html` is replaced with the tested `deployment/github-pages-index.html`: ordinary visits and old `#/order` bookmarks go to the new storefront; `#/staff` and `#/admin` retain the current management assets on the original origin. The staff bundle waits for DOMContentLoaded before mounting. Auth callbacks stay on the original origin without forwarding credentials. The new footer exposes a staff-only entry link through `/operations`. Existing database records and staff functionality are retained.

Removed unused template SVGs and old Geist/Geist Mono font assets from this source tree. Only the Matcha Pop font and product assets are packaged. HTML responses set Cache-Control to no-store. The source repository keeps normal Git history; this is not a deletion of historical backups.

Validation: TypeScript, production build and all 17 tests passed. These include redirect behavior for the legacy homepage, customer links, staff routes, auth callbacks and DOM readiness. No production accounts, drafts, orders, profile edits or address edits were created by verification. Browser visual QA and authenticated end-to-end account/payment testing remain unverified in this environment.

## Explicit member and order routes

The two reported navigation controls now use same-origin URLs: Hội nhà Khe and the profile icon open `/account`; the footer account/history link and post-checkout history action open `/orders`. External-link arrow glyphs have been removed from these customer controls. Both routes server-render the same Matcha Pop storefront with the member panel initially open, then load private account data only through the authenticated browser client. No GitHub redirect or legacy fallback is part of either route. Closing the panel returns the address bar to `/` without another origin. Existing hash bookmarks remain compatible.

Before this change, live HTML already used internal click buttons for these controls, so the user's specific reported return to the old app could not be reproduced through a server-side inspection alone. The user's actual URL has been requested; a cache cause has not been established. TypeScript, build and 18 tests passed, including HTTP 200/no external Location assertions for `/account` and `/orders`. Browser interaction and a real authenticated customer session remain unverified.

## Hiship delivery estimates

The owner supplied a delivery tariff image and the pickup point `138 đường 30/4, phường Dương Đông, Phú Quốc`. `lib/shipping.ts` transcribes all 31 fixed/ranged area rates. This is a zone tariff, not a distance-based formula; no map API, geocoding service or live courier booking is used. Narrow place-name suggestions accept accent-insensitive whole phrases. Ambiguous addresses and the broad Dương Đông ward name require an explicit area selection; the ward name alone is not treated as the 10,000 VND central-zone rate. An unknown area remains unpriced instead of showing a zero delivery fee.

A public estimator is accessible at `/#delivery` before sign-in, with the complete tariff table and a mobile shortcut near the hero. Checkout shows the same estimator for delivery orders, including saved addresses. Editing an address or area invalidates any existing payment draft. Delivery fees preserve ranges, and the combined budget is item subtotal plus the minimum/maximum fee. The final payment view uses the server-calculated item total, including any backend member adjustments, plus a separate delivery estimate.

The existing collection policy is preserved: QR pays only for items; the courier is paid separately. No shipping fee is added to `draft.total`, customer revenue, item prices or the bank QR amount. The courier, origin, selected area, quoted range and separate-payment policy are sent through the existing authenticated `prepare_online_order.p_note`; no RPC signature or database migration was changed. The final prepared quote is held separately with its destination until that draft is edited or replaced.

Validation: TypeScript, production build and 25 tests passed. Shipping tests independently cover all fixed/ranged tariffs, arithmetic, ambiguous/unknown addresses, whole-word suggestions and the note/payment separation. No production orders or courier bookings were created by testing. Browser visual QA and live authenticated payment submission are not verified in this environment.
