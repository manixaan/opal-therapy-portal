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
   Office client id below, ticking the scope:
   `ea5a67f6-b6f3-4338-99d1-1a5c3c5b0a6c`, `d3590ed6-52b3-4102-aeff-aad2292ab01c`,
   `bc59ab01-8403-45c6-8796-ac3ef710b3e3`, `93d53678-613d-4013-afc1-62e9e444a0a5`,
   `57fb890c-0dab-4253-a5e0-7188c88b2bb4`, `08e18876-6177-487e-b8b5-cf950c1e598c`.
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
