# Rule — frontend (`frontend/current/**`)

Applies when you change HTML/CSS/JS under `frontend/current/`.

## Shape
- No framework, no bundler, no build step. `backend/server.js` serves
  `frontend/current/` statically; edit a file and reload.
- `mockup_v3.html` (~29k lines) is the whole authenticated shell. Everything else
  is a standalone page (`login.html`, `onboarding.html`, `register.html`,
  `service-agreement-sign.html`, …).
- One feature = one `<feature>.js` + `<feature>.css`, loaded from the `<script>`
  block at the top of `mockup_v3.html`. Globals on `window`, no modules.

## Navigating the shell without reading it
- Tabs are marked `<!-- ============ NAME TAB ============ -->`.
  `grep -n '============ .* TAB' frontend/current/mockup_v3.html` gives the index.
- Then read a bounded slice (`sed -n 'START,ENDp'`). Never open the whole file.
- Tab switching / visibility lives in `navigation.js`.

## Cache-bust pins — mandatory
Every `<script src="/x.js?v=N">` pin in `mockup_v3.html` is asserted by
`backend/tests/assessment-surface-guards.test.js`. The Azure staging proxy does
not revalidate, so a missed bump serves stale JS against a new API.

1. Change `foo.js` → bump `?v=` in `mockup_v3.html` → update the pin in the guard test.
2. Stage all three, then run `node scripts/check-asset-pins.js` (it compares what
   is **staged**, which is the failure mode that keeps recurring here).

## Boundaries
- Frontend role checks are UI convenience only. Never treat a UI hide as
  enforcement — the backend guard is the real one.
- A frontend task does not license a backend audit. Only read backend code when a
  specific endpoint's contract is genuinely in question.
- Never edit `frontend/archive/**`.
