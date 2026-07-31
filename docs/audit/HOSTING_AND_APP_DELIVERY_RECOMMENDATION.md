# Hosting & App Delivery — Recommendation

Question: where should the Opal Portal live, and how should staff access
it, with a therapist starting in ~1 month?

**Recommendation up front: browser-based Azure web app, provision a real
production environment now, bind portal.opaltherapy.com.au to it, keep
staging as the test target. Skip Teams/Outlook add-ins/PWA/desktop for
now.** Reasoning and per-option assessment below.

## Current facts (verified live 2026-07-31)

- Only staging exists: `https://opal-portal-staging.azurewebsites.net`
  (HTTPS-only, TLS≥1.2, valid *.azurewebsites.net cert, Always On, B1).
- Production has never been provisioned; `deploy-production.yml` targets a
  nonexistent app. Custom domain documented but never bound.
- Staging runs `NODE_ENV=staging`, which silently disables the `secure`
  cookie flag and CSRF 403 enforcement (`server.js:243,183`) — the one
  environment real users touch has weakened protections.
- Every push to `main` auto-deploys staging: the app users depend on can
  restart mid-day on any merge, with no deployment slot fallback.
- The whole backend is single-instance by design (in-process pollers,
  in-memory webhook map/rate limiter) — fine at this scale, must not
  scale out.

## Options assessed

### 1. Azure web app + custom domain — ✅ RECOMMENDED
Realistic: yes — it is literally what exists, minus one scripted
provisioning run and a DNS/cert binding (both already documented in
`deploy/AZURE_DEPLOYMENT.md` and `staging-provision.sh` is reusable).
Pros: zero new architecture; keeps CI/CD, Key Vault, App Insights;
`NODE_ENV=production` turns the strict protections ON; separates "users'
app" from "CI deploy target"; professional URL for the new hire.
Cons: a few hours of owner/dev CLI work + DNS access; small extra cost
(second B1 App Service + B1ms PG ≈ tens of AUD/month).
Needed before therapist: **yes — this is the launch decision.**

### 2. Microsoft/Outlook add-in — ❌ not now
Realistic: technically possible later (the app is already Entra-integrated)
but a new development track: manifest, iframe constraints, CSP rework,
add-in review UX. The portal's value (calendar mirror, booking, HR) does
not need to live inside Outlook. Cost: weeks. Needed before therapist: no.

### 3. Teams tab — ❌ not now
Same as above: a Teams tab is just an iframe + SSO plumbing, but the app's
session-cookie auth + SameSite settings would need rework, and the practice
does not appear to run on Teams as its hub. Revisit only if staff live in
Teams daily. Needed before therapist: no.

### 4. PWA installed to laptop — ⚠️ later
Realistic: cheap (manifest + icon + service worker), gives an "app-like"
dock icon. But the frontend is a single 24k-line file with no offline
strategy, and a service worker that caches it would complicate the already
fragile refresh story (the app currently never refreshes data post-load).
Do it after the refresh mechanism is fixed. Needed before therapist: no.

### 5. Desktop wrapper (Electron etc.) — ❌
All cost, no benefit at this scale. No.

### 6. Mobile-friendly web app — ⚠️ later (P2)
The app is desktop-only today (one @media query in 24,460 lines; the
13-tab nav cannot wrap). Making the calendar/profile usable on a phone is
real work on the current frontend. For launch: state clearly "laptop
required"; schedule responsive work after the pilot.

### 7. Staying staging-only temporarily — ⚠️ acceptable fallback ONLY with hardening
If the month gets tight, the therapist *could* pilot on staging, but only
after: NODE_ENV strictness fix (treat staging as strict for cookies/CSRF —
one-line change each), synthetic-account removal, email configured, and an
agreed "deploys happen after hours" rule (or a temporary freeze on main).
This is a compromise, not a home: the CI-target-equals-user-app problem
remains. If chosen, set a hard date to stand up production anyway.

### 8. Creating a production environment — ✅ part of option 1
`staging-provision.sh` is idempotent and re-usable with new names; Entra
redirect URIs, Splose key, KV secrets, alert rules, DNS + managed cert are
the manual steps (checklist already exists: `EXTERNAL_ACTIONS_CHECKLIST.md`
items 2/14/16). Estimated half a day of focused work + DNS propagation.

## Direct answers

- **Should staff access it via browser?** Yes. Chrome/Edge on a laptop is
  the supported surface; say so explicitly in the quick-start.
- **Own URL?** Yes — `portal.opaltherapy.com.au` on the production app.
  An azurewebsites.net staging URL says "prototype" to a new employee.
- **Inside Outlook / Teams tab?** No — revisit post-pilot if there's pull.
- **Installable like an app?** Later; PWA after the refresh fix.
- **Production separate from staging?** Yes — this is the single biggest
  operational fix available: users stop riding the CI target, and
  NODE_ENV=production activates the strict cookie/CSRF path that already
  exists in code.
- **Safest setup for a therapist joining in one month?**
  1. This week: provision `opal-portal-prod` (script), bind DNS + managed
     cert, load KV secrets (new SESSION_SECRET/ENCRYPTION_KEY; same Entra
     app with added redirect URI or a prod app registration; Splose key),
     set all write flags false, EMAIL_* configured, ALLOWED_EMAILS empty
     (invite-only).
  2. Keep auto-deploy → staging; production deploys stay manual +
     approval-gated (workflow already exists).
  3. Restore-test the production PG once before go-live (drill is
     documented, never executed).
  4. Onboard the therapist on production with the custom domain.
  Fallback if time runs out: hardened staging per option 7, with a
  scheduled production cutover date.
