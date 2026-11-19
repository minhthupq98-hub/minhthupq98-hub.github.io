# THE KHE · Matcha Pop

Production customer ordering website: https://the-khe-order.minhthupq98.chatgpt.site

The customer experience uses one Matcha Pop interface for the menu, item options, cart, phone/PIN sign-in, membership, vouchers, profile, saved addresses, order history and transfer/submission flow. Public menu data and authenticated customer operations use the existing THE KHE Supabase RPCs; there is no separate sample database.

## Existing GitHub app

The legacy Pages entry is maintained in `deployment/github-pages-index.html`. The GitHub homepage and old customer links redirect to the new customer site. The existing management application is retained on its original origin at https://minhthupq98-hub.github.io/#/staff to preserve its sessions and business workflow. The new site's `/operations` route opens that staff entry. Staff auth callbacks remain on GitHub and are never forwarded to the new site.

Update only the GitHub repository's `index.html` with the tested entry file; do not remove the current management bundle, stylesheet, logo or SQL schemas. That repository contains compiled assets rather than the editable source of the management application.

## Local checks

Requires Node.js >=22.13.0. Install with `npm ci` when dependencies are absent. Run `npx tsc --noEmit` and `npm test` (production build plus the catalog, cart, RPC payload, migration-entry and Worker checks). Run `npm run validate:artifact` to check the Worker package independently.

## Hosting

Retain `.openai/hosting.json` and its Sites project ID. Publish the pushed source and matching `dist` Worker artifact through Sites. HTML responses use `Cache-Control: no-store`; versioned asset URLs change with each build.

The custom domain thekhecoffee.com still needs DNS verification. See `DOMAIN-SETUP.md`. No DNS account is connected in this session. See `ORDER-IMPLEMENTATION.md` for integration contracts and verification limits.
