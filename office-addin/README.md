# Opal Assist — the Office add-in

The same assistant as `/assist` on the portal, inside Word, Excel and Outlook.
The task pane IS the portal page (`/assist?surface=word|excel|outlook`); the
add-in itself is only a manifest and the icons. Nothing runs outside the
portal, and every API call behind the pane is guarded by the portal
(Microsoft 365 bearer sign-in, `backend/assist/entra-auth.js`).

## One-time setup (practice owner)

1. **Entra app registration** — https://entra.microsoft.com → App registrations
   → New registration → name `Opal Assist`, single tenant, redirect URI
   (Single-page application) `https://<portal host>/assist` → Register.
   Copy the **Application (client) ID**.
2. **Expose an API** → *Set* the Application ID URI to exactly
   `api://<portal host>/<client id>` → *Add a scope* `access_as_user`
   (admins and users can consent) → *Add a client application* for each
   Office client id below, ticking the scope (these five were accepted by the
   OT Services tenant on 18 Sep 2026; `ea5a67f6-…` from older docs is rejected):
   `d3590ed6-52b3-4102-aeff-aad2292ab01c`, `bc59ab01-8403-45c6-8796-ac3ef710b3e3`,
   `93d53678-613d-4013-afc1-62e9e444a0a5`, `57fb890c-0dab-4253-a5e0-7188c88b2bb4`,
   `08e18876-6177-487e-b8b5-cf950c1e598c`.

   Done for staging on 18 Sep 2026: app **Opal Assist**, client id
   `21ca9a73-1152-4f7e-ae66-d0b853e679e0`, Application ID URI
   `api://opal-portal-staging.azurewebsites.net/21ca9a73-1152-4f7e-ae66-d0b853e679e0`.
3. **API permissions** → Microsoft Graph → Delegated → `openid`, `profile`,
   `email`, `User.Read` → Grant admin consent.
4. **Portal settings** (App Service → Environment variables):
   `OPAL_ASSIST_ENABLED=true`, `OPAL_ASSIST_ENTRA_CLIENT_ID=<client id>`,
   `MICROSOFT_TENANT_ID` (already set for Outlook), and make sure
   `ALLOWED_ORIGINS` includes `https://<portal host>`.
5. **Build the manifests** (from the repo root):

       node scripts/build-office-manifest.js --host https://<portal host> --client-id <client id>

   → `office-addin/dist/opal-assist-word-excel.xml` and `opal-assist-outlook.xml`.

## Installing for the practice (Microsoft 365 admin centre)

https://admin.microsoft.com → Settings → Integrated apps → Upload custom apps
→ Office Add-in → upload `opal-assist-word-excel.xml` → assign to everyone →
Deploy. Repeat for `opal-assist-outlook.xml`. Staff see **Opal Assist** on the
Home ribbon in Word and Excel and on the message ribbon in Outlook within a day.

## Trying it on one Mac first (sideload)

Word/Excel for Mac: copy `opal-assist-word-excel.xml` into
`~/Library/Containers/com.microsoft.Word/Data/Documents/wef/` (create `wef`
if missing; same path under `com.microsoft.Excel` for Excel), quit and reopen
Word → Insert → Add-ins → My Add-ins → Opal Assist.
Outlook: https://aka.ms/olksideload → Add-ins → My add-ins → Add a custom
add-in → Add from file → `opal-assist-outlook.xml`.

The pane needs the portal over **https** — it works against staging or
production, not a plain `http://localhost` server.

# Opal in the Outlook app bar — the whole portal

An **Opal** icon in Outlook's left app bar (beside Mail and Calendar; also in
Teams and the Microsoft 365 app) that opens the full portal inside Outlook,
signed in with the person's Microsoft 365 account. It is a Microsoft 365 app
(Teams manifest 1.17, one personal tab at `/outlook`), not an Office add-in.
Server side: `backend/outlook-embed.js`.

## One-time setup

1. **Reuse the Opal Assist app registration** (steps 1–3 above). Under
   *Expose an API* → *Add a client application*, add these Microsoft 365
   host ids for the `access_as_user` scope (Teams desktop/mobile, Teams web,
   Microsoft 365 web, Microsoft 365 desktop, Outlook desktop, Outlook web,
   Outlook mobile): `1fec8e78-bce4-4aaf-ab1b-5451cc387264`,
   `5e3ce6c0-2b1f-4285-8d4b-75ee78787346`, `4765445b-32c6-49b0-83e6-1d93765276ca`,
   `0ec893e0-5785-4de6-99da-4ed124e5296c`, `d3590ed6-52b3-4102-aeff-aad2292ab01c`,
   `bc59ab01-8403-45c6-8796-ac3ef710b3e3`, `27922004-5251-4030-b22d-91ecd9a37ea4`.
2. **Portal setting**: `OPAL_OUTLOOK_TAB_ENABLED=true` (the Opal Assist Entra
   settings must already be there). Without it the tab says it is not switched
   on and no embed session is ever issued.
3. **Build the package** (repo root):

       node scripts/build-m365-app.js --host https://<portal host> --client-id <client id>

   → `office-addin/dist/opal-portal-m365.zip`.
4. **Install**: https://admin.microsoft.com → Settings → Integrated apps →
   Upload custom apps → *Teams app* → upload the zip → assign to everyone →
   Deploy. Within a day it appears under **More apps** (the four squares) in
   Outlook; right-click → **Pin** keeps it in the bar.

## How sign-in works inside Outlook

Outlook shows the tab as a cross-site frame, where the portal's ordinary
(SameSite=Lax) cookie is never sent. `/outlook` asks Outlook for a Microsoft
SSO token, `POST /api/auth/entra-embed` validates it (same checks and same
refusals as Opal Assist) and issues a **separate** session cookie,
`opal.embed.sid` — SameSite=None; Secure; Partitioned — that exists only
under Outlook/Teams. Only requests on that session may be framed by the
Microsoft 365 hosts, and their writes must be same-origin
(`Sec-Fetch-Site`). Signing out inside Outlook signs straight back in with
Microsoft, by design. A browser that refuses partitioned cookies gets an
"Open Opal in the browser" button instead of a sign-in loop. Needs **https**.
