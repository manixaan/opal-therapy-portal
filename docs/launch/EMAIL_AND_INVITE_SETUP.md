# Email & Invite Setup

Stage 1 launch-blocker fix (2026-07-31). The identity lifecycle (invite →
verify → approve → reset) previously depended on email that could not send
anywhere, with links pointing at localhost and a UI that claimed "Invite
sent!" regardless. This documents the fixed behaviour and the owner setup.

## How it works now

- Every emailed link (invite / verification / password reset) is built from
  **`APP_BASE_URL`** (`backend/email.js getBaseUrl()`), which is now
  **boot-critical in staging/production** and must be `https://…`
  (`backend/env-validation.js`). Outside development/test the app refuses to
  build a localhost link — it fails loudly instead.
- Email delivery is a single nodemailer SMTP abstraction (`backend/email.js`)
  supporting any SMTP provider (Microsoft 365 `smtp.office365.com:587`
  recommended). Every send returns one of three states, and the UI shows
  the truth:
  - **sent** — the invite modal says "✓ Invite email sent to …" (only then)
  - **skipped** (email not configured) — the modal shows "Invite created.
    Email is not configured…" with the registration link + Copy button
  - **failed** (SMTP errored) — same copy-link fallback, marked as a failure
- Owner/admin can retrieve the link for any still-pending invite later:
  **"Copy link"** in Settings → Users & Roles → Pending invites, backed by
  the audited `GET /api/invites/:id/link` endpoint (`invite.link_retrieved`
  audit event). Tokens are never present in list responses.
- Invite creation remains owner/admin-only (admin: therapist/read_only
  invites only); therapists and read_only get 403 (integration-tested).

## Required environment variables

| Var | Required? | Example |
|---|---|---|
| `APP_BASE_URL` | **Boot-critical (staging/prod)**, https only | `https://opal-portal-staging.azurewebsites.net` / `https://portal.opaltherapy.com.au` |
| `EMAIL_HOST` | Optional — without it the app runs in copy-link mode | `smtp.office365.com` |
| `EMAIL_PORT` | Optional (default 587) | `587` |
| `EMAIL_SECURE` | Optional (`true` only for port 465) | `false` |
| `EMAIL_USER` | Required for sending | `portal@opaltherapy.com.au` |
| `EMAIL_PASS` | Required for sending — **Key Vault reference, never plaintext** | KV secret `email-pass` |
| `EMAIL_FROM` | Optional | `Opal Therapy <portal@opaltherapy.com.au>` |

Azure Key Vault: store the SMTP password as secret `email-pass` in
`opal-portal-stg-kv` (prod: the prod KV) and set the app setting as a KV
reference, same pattern as the other secrets. Remember the platform gotcha:
after rotating a KV secret, **rewrite the app setting** — restart alone does
not re-resolve, and the old worker overlaps ~100s.

## Owner actions to enable real email (Microsoft 365 SMTP)

1. **Which mailbox sends invites**: use a dedicated practice mailbox —
   recommended `portal@opaltherapy.com.au` (create it in M365 admin, a
   cheap Exchange licence is enough). Avoid your personal mailbox: invite
   and reset emails should come from a neutral sender the practice keeps.
   `adminservices@opaltherapy.com.au` also works if you prefer no new
   mailbox.
2. **SMTP AUTH / app password — yes, required**: in the Microsoft 365
   admin center → Users → [the mailbox] → Mail → **enable "Authenticated
   SMTP"**. If the account has MFA (it should), create an **app password**
   (My sign-ins → Security info → App password) — that is the value the
   portal uses, never your real password.

### Exact terminal session (run on your Mac, az CLI signed in)

Nothing below echoes the secret; `read -s` keeps it out of shell history
and the screen. Names come from `deploy/staging-resources.txt`.

```bash
cd "~/Documents/Claude/Projects/Therapy Scheduling Application"
source deploy/staging-resources.txt   # sets APP, RG, KV

# 3. Store the app password in Key Vault (typed invisibly)
read -s -p "M365 app password: " EMAIL_PASS_VALUE && echo
az keyvault secret set --vault-name "$KV" --name email-pass \
  --value "$EMAIL_PASS_VALUE" -o none && unset EMAIL_PASS_VALUE
echo "✓ email-pass stored in $KV"

# 4-5. App Service settings (EMAIL_PASS as a Key Vault reference)
SECRET_URI=$(az keyvault secret show --vault-name "$KV" --name email-pass --query id -o tsv)
az webapp config appsettings set -g "$RG" -n "$APP" --settings \
  EMAIL_HOST=smtp.office365.com \
  EMAIL_PORT=587 \
  EMAIL_SECURE=false \
  EMAIL_USER=portal@opaltherapy.com.au \
  EMAIL_FROM="Opal Therapy <portal@opaltherapy.com.au>" \
  EMAIL_PASS="@Microsoft.KeyVault(SecretUri=$SECRET_URI)" -o none
echo "✓ app settings written (this restarts the app automatically)"

# 6. Verify the new worker picked them up (~2 min; uptime resets)
sleep 120 && curl -s https://opal-portal-staging.azurewebsites.net/health
```

(Replace `portal@opaltherapy.com.au` in both places if you chose a
different mailbox. Rotation later: re-run the `read -s` + `secret set`
steps, then **re-write the EMAIL_PASS app setting** — a restart alone does
not re-resolve Key Vault references.)

### 7–8. Send and verify a test invite

Settings → Users & Roles → Invite: invite a personal mailbox you control
as **read_only**. The modal must say "✓ Invite email sent to …" — if the
copy-link box appears instead, email did not send (check the mailbox's
SMTP AUTH setting and the App Insights logs; no secrets are ever logged).
Open the received email; the button link must start with
`https://opal-portal-staging.azurewebsites.net/register?token=` —
**never localhost** (item 9). Then revoke the test invite.

### 10. Fallback if SMTP stays unavailable

Nothing blocks the pilot: every invite shows a **copy-link box** in the
modal and a **Copy link** button under Pending invites (audited endpoint).
You deliver the link over SMS/Teams/phone yourself. Password reset has no
copy-link equivalent — until SMTP works, a forgotten password is an
owner-assisted event, so configuring email before the pilot is strongly
recommended.

If M365 blocks SMTP AUTH by tenant policy: alternatives (documented, not
built) are Microsoft Graph `sendMail` via an app registration, or an SMTP
relay (SendGrid etc.) — the abstraction needs only host/user/pass.

## Testing staging email

1. Settings → Users & Roles → Invite: invite a mailbox you control
   (e.g. a personal address) as **read_only**.
2. Expect the modal to say "✓ Invite email sent" — if it shows the copy-link
   box instead, email is not configured/failing; check App Insights logs.
3. Open the email: the link must start with the staging URL — **never
   localhost**. Complete registration, then revoke/suspend the test account.
4. Password reset: use "Forgot password" with the same mailbox; the reset
   link must arrive and use the staging URL.
5. Verification email: same check during the registration from step 3.

## Verifying links never point at localhost

- `backend/tests/email-links.test.js` pins this: base-URL derivation,
  localhost refusal in staging/production, and link content for all three
  email types (34 assertions run in CI).
- Live check: create an invite and inspect `registerUrl` in the response —
  it must start with `APP_BASE_URL`.

## Setting the production base URL later

When production is cut over (see PRODUCTION_ENVIRONMENT_CUTOVER_PLAN.md),
set `APP_BASE_URL=https://portal.opaltherapy.com.au` as a production app
setting, along with production EMAIL_* values. Nothing in code changes;
links follow the setting. The boot validator enforces https and presence.

## What is deliberately NOT done in Stage 1

- No email queue/retry; a failed send falls back to copy-link mode.
- No Graph sendMail implementation (SMTP path only; abstraction ready).
- Invited users still land in `pending_approval` after verifying (the
  owner approves in Settings → Team) — flow works but has this extra step;
  scheduled for Stage 2 polish.
