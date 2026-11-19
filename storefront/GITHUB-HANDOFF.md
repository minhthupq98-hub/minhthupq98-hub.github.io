# THE KHE storefront source handoff

Export of Sites project `appgprj_6a5d5900932081919f9a4692cc34c7e7`, THE KHE · Matcha Pop, saved version 8, source commit `a2c9bc37012a1ca1654b9fbea39f8591c2b63cab`. Current customer origin is https://thekhecoffee.com/. Historical DNS/setup statements in README.md and DOMAIN-SETUP.md describe an earlier setup stage.

This directory includes every tracked source file, including the six bundled fonts and logo, lockfile, scripts, tests and Sites manifest. The application uses the Next.js App Router layout under `app/`, with Vinext/Vite and a Cloudflare Worker. There is no missing `src/` directory. Dependencies and generated build/runtime directories are excluded.

The export changes public Supabase configuration to Vite build-time variables in `lib/supabase-public.ts`, adds `vite-env.d.ts`, and permits `.env.example` in `.gitignore`. Domain verification values in the historical `DOMAIN-SETUP.md` are replaced with placeholders. Source file checksums and export changes are recorded in `SOURCE-MANIFEST.json`.

## Local development

Use Node.js >=22.13.0 and npm with the committed package-lock.json. From this repository's root run:

```sh
cd storefront
cp .env.example .env.local
# Fill both VITE_SUPABASE_* values in .env.local.
npm ci --no-audit --no-fund
npm run dev -- --host 127.0.0.1 --port 5173
```

The two required public variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Obtain the project URL and browser publishable key from the existing Supabase project settings. These values are embedded in the browser build. Never use service_role, a Supabase secret key, owner login, database password or Sites token here. `SHOP_SLUG` remains `the-khe`. Use a development Supabase project when testing operations that write data. Read-only layout work can use a local fixture or the approved public menu configuration.

Build and run checks:

```sh
npx tsc --noEmit
# Portable build command, including macOS, without Linux timeout/flock helpers.
npx vinext build
node --experimental-strip-types --test tests/*.test.mjs
# Preview production with the installed Vinext CLI.
npm start -- --port 5173
```

On Linux with GNU timeout, the original `npm run build` runs the bounded build plus artifact checks. `npm test` rebuilds then runs all tests. `npm run install:ci` additionally requires Linux flock, timeout, curl and sha256sum. A full data-backed preview requires the configured Supabase RPCs and auth, which this source export does not recreate. Existing original integration documentation is in ORDER-IMPLEMENTATION.md. This is a server Worker app, so GitHub Pages cannot serve its application runtime directly.

## Return edited GitHub code to the existing Sites project

1. Commit the completed Cozy UI changes on the `storefront-source` branch or a feature branch and report the exact commit SHA. Run the checks above with the required configuration. Keep actual order creation and other write tests in a development backend.
2. In a session with the Sites connector, select the same project ID, read its current source and compare changes made since this export. Obtain a short-lived Sites source credential and open its configured repository using the Sites source helper. Never commit the credential.
3. Copy the contents of this GitHub `storefront/` directory to the root of that Sites checkout. Do not copy the GitHub repository root, `.git`, dependencies, generated output, ignored environment files or runtime state. Preserve `.openai/hosting.json` and the existing Site identity. Configure the two public Vite variables in the build environment, before building; restarting an existing build with different runtime-only values does not change the compiled browser values.
4. Build and test that exact source. Through the Sites source helper, commit/push the prepared source to the configured Sites repository and package the matching `dist` output. Save a Sites version using its pushed source commit and archive, then deploy that saved version to the same existing public Site. Verify deployment status and the custom domain.

Pushing this GitHub branch alone does not publish this Site. No GitHub-to-Sites deployment automation is configured by this export. The supported workflow uses the Sites source repository plus native save/deploy tools. An agent or developer with that project's Sites access can publish; this is not tied to a particular chat or person. GitHub credentials alone are insufficient. Private publish-on-push options in Sites apply to the Sites-managed repository and do not automatically connect this GitHub branch to the public domain.

This handoff performs a source export only. No Site version is saved/deployed by the export. The root admin and finance files in the GitHub repository are outside the export directory.
