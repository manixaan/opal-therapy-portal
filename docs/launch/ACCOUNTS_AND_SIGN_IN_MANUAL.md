# Opal Therapy Portal — Accounts & Sign-in Manual

*For the practice owner. Written from what the code does after the accounts &
access hardening of 18 Oct 2026 (commits 5eef761 → eab4a66). Where something
needs your attention there is a **Note**.*

---

## 1. The roles, in plain English

Every person has exactly one **role**. The server checks it on every request —
hiding a button in the browser is only a convenience.

| Role | Who it's for | Can | Cannot |
|---|---|---|---|
| **Owner** | You (and any co-owner) | Everything: finances, billing, Xero, users and roles, invites, integrations (Splose, Outlook), audit logs, all onboarding and interview records | Change their own role, suspend or deactivate themselves |
| **Admin** | Practice manager / scheduler | Every calendar, every client for scheduling, all travel, hours and kilometres, sync status | Financials, billing, contacts, Resource Hub, settings, user management, invites. Onboarding and interviews only if you grant those separately |
| **Therapist** ("Employee" on onboarding screens) | Clinicians and ordinary staff | Their own calendar, their assigned clients, their own travel/hours/km, their own Outlook | Anyone else's calendar or clients, practice-wide data |
| **Read-only** | Observers, auditors | View calendars, client summaries, therapists, travel and hours | Any change, except acknowledging their own onboarding items and changing their own password |
| **Pre-employee** | A new starter part-way through onboarding | Only their own onboarding page, assigned learning, the walkthrough, their notifications | Everything else |

**Delegated extras.** No role gets these by default (the Owner holds them
automatically). Grant them one at a time to a specific person:

- Day-to-day onboarding: `view`, `assign` (create and release), `review`, `verify`, `activate`
- Configuration: `manage_packages`, `manage_documents`, `manage_compliance`
- Sensitive: `payroll` (TFN, bank, super), `sensitive_identity` (ID, visas), `audit`
- Interviews: `interviews.access`, `interviews.view_all`

Onboarding can only ever hand out **Therapist, Admin or Read-only** — never
Owner. Making someone an Owner is always a deliberate change by an Owner in
Users & Roles.

---

## 2. First-time setup: the very first Owner (new database only)

Staging already has an Owner; this section is for a brand-new production database.

1. Set these on the server before go-live:
   - **`BOOTSTRAP_OWNER_EMAIL`** — your own email address. Outside development,
     only this address can create the first account. If it is not set, nobody can.
   - **`ALLOWED_EMAILS`** (or `ALLOWED_DOMAINS`) — must include that same address.
   - **`ORG_NAME`** (optional) — the practice name; defaults to "Opal Therapy".
2. Go to **`/register`**, enter that email, your name and a password.
3. You become **Owner, active immediately**, and the practice organisation is
   created at the same moment — so you can start inviting straight away.
4. You are sent to **Sign in**. Sign in with the password you just chose and
   complete the short profile wizard.

**Note:** once you are set up, clear `BOOTSTRAP_OWNER_EMAIL` and narrow or clear
`ALLOWED_DOMAINS` / `ALLOWED_EMAILS` (see §6). The bootstrap only works while no
active Owner exists.

`backend/setup/seed-users.js` is a development tool. It now refuses to run unless
`NODE_ENV=development` and the database is on this machine.

---

## 3. How staff sign in

- **Where:** `/login`, email and password. Email is not case-sensitive.
- **Password rules** (everywhere): at least 8 characters, with an uppercase
  letter, a lowercase letter and a number.
- **Session length:** 8 hours of inactivity. Sessions are stored in the
  database, so they survive a restart. There is no absolute maximum yet.
- **Sign out** ends this browser's session; **Sign out everywhere** (Settings)
  ends all of that person's sessions.
- **No two-factor sign-in** yet.
- **Microsoft:** there is no "Sign in with Microsoft". Microsoft is only used to
  connect a mailbox after signing in (§10).

**When sign-in fails**

| Situation | What happens |
|---|---|
| Wrong email or password | "Invalid email or password" — the same whether or not the account exists |
| 10 failed attempts on one account within 15 minutes | That account is paused: "Too many login attempts… try again in N minute(s)" |
| More than 10 attempts from one network address in 15 minutes | Same message, per address (the address is now read correctly behind Azure) |
| Email not yet verified | Sent to "check your inbox", with a Resend button (one every 2 minutes) |
| Awaiting your approval | Sent to "pending approval" |
| Suspended / deactivated | "Your account has been suspended…" / "This account is no longer active…" |
| Temporary password older than its expiry | "That temporary password has expired…" — they can use **Forgot password** to get going again |
| Signed in with a temporary password | Taken straight to **Create your password**; nothing else works until they do |

Status messages only appear **after** the correct password, so they don't reveal
whether an account exists. A suspended or deactivated person's open sessions stop
working on their very next click.

---

## 4. Inviting a new therapist or staff member

**Settings → Users & Roles → Invite team member** (Owner only). Use this for staff
who don't need the full employee-onboarding paperwork; for new employees with
contracts, TFN etc., use Onboarding (§8).

**What you do**
1. Enter their email, optionally their name, choose a role (Therapist / Read-only
   / Admin / Owner), tick **Treating therapist** if they see clients (this creates
   their calendar profile), and choose an expiry (1–30 days; the screen offers 3,
   7 or 14).
2. Press **Send invite**. You'll see one of:
   - **"✓ Invite email sent"** — the mail server accepted it.
   - **"Invite created — email NOT sent"** with a link box — email isn't set up
     or sending failed. **Copy the link** and send it yourself (text, Teams…).
   - An error — e.g. an account or a pending invite already exists for that email.

**What the new person does**
1. Opens **the link from their invitation** (`/register?token=…`). Their email is
   filled in and locked, and their role is shown.
2. Enters their full name, optional phone and a password.
3. Their account is **active straight away** — the link itself proves the email
   is theirs, so there is no verification email and no approval step. This works
   the same with or without email set up.
4. Signs in, then goes through the **profile wizard** (profile, professional
   details, Outlook, work location, travel bases, credentials, CPD,
   notifications, review). Finishing it makes sure therapists have a calendar profile.

**Note:** the invitation link is the only way in. Typing an invited email
address into the register page does **not** work — they'll be told to use the
link in their invitation. Keep the link private: whoever has it can claim the invite.

**Managing invites** (Users & Roles → the person's row)
- **Copy link** — shows the link again for a pending invite (each view is audited).
- **Resend** — re-sends the invite. If it had **expired, it is renewed** with a
  fresh link and expiry. If email isn't set up, the screen says
  **"Email not sent — copy the link instead"**.
- **Revoke** — the link stops working immediately.
- Invites can't be edited: revoke and re-invite, or change the role after they join.

Onboarding invitations (§8) are not listed here — they are managed from the
Onboarding screen, which sends the correct onboarding link.

---

## 5. Forgot password / reset / change password

**Forgot password** (`/forgot-password`, linked from sign-in)
1. The person enters their email and always sees "If an account exists… a reset
   link has been sent" — deliberate, so the page doesn't reveal accounts.
2. An email is sent to any **active** account (even one that never verified its
   email — receiving the link proves the mailbox) and to verified accounts
   awaiting approval. One email per address every 3 minutes.
3. The link (`/reset-password?token=…`) is valid for **1 hour**, works once, and
   signs that person out everywhere. A reset also clears any temporary-password
   state and marks the email as verified — so a new starter whose temporary
   password expired can reset and get in.

**Change password** (Settings → Security, or the forced "Create your password" screen)
- Needs the current password; 8 tries per 15 minutes; the new password must meet
  the rules and differ from the old one.
- Every **other** session for that person is signed out.

You can't set someone else's password from Users & Roles. The only
owner-issued credential is the Onboarding temporary password (§8).

**Note:** reset, invite and verification links are no longer written to the
server log outside development. Without email set up, use Copy link (invites)
or a temporary password (onboarding) instead.

---

## 6. Self-registration (no invite)

- Only possible if `ALLOWED_EMAILS` or `ALLOWED_DOMAINS` is set. Anyone else is
  told the email can't be used and to use their invitation link if they have one.
- Once an Owner exists, a self-registered person becomes a **Therapist**,
  **pending verification**. Once they click the verification email they become
  **pending approval** and can't sign in until you approve them.
- **Approve:** Users & Roles shows a "needs attention" count → open the person →
  **Approve account**. They get an "account approved" email if email is set up.
- **Approve only works after they've verified their email.** A person still
  waiting is marked **"Pending email"**, with the note "Waiting for them to
  verify their email address" — approve them once they've clicked the link. This needs email to be working — without email, invite
  people instead (§4).

**Recommendation:** for rollout, invite everyone (§4) and keep
`ALLOWED_DOMAINS` empty, so nobody can register an address on your domain
that isn't theirs.

---

## 7. Changing someone's role, suspending, deactivating

**Settings → Users & Roles** → click the person (Owner only).

- **Change role:** choose Owner / Admin / Therapist / Read-only → **Save**. It
  applies on their **next click**. Choosing Therapist creates their calendar
  profile. You can't change your own role — another Owner has to.
- **Suspend** (leave, investigation): signed out everywhere, can't sign in;
  optional reason. **Re-activate** reverses it.
- **Deactivate** (offboarding): signed out everywhere, data kept. If they have a
  portal-created Microsoft 365 account it is disabled and its licence released
  (needs the Microsoft grant, §10). **Restore** brings back the portal account,
  not Microsoft 365.
- **Suspend and Deactivate also disconnect their Outlook** — the portal forgets
  their Microsoft tokens and stops syncing their calendar. If you re-activate
  someone, they reconnect Outlook from Settings → Integrations.
- There is **no delete**.

**Note:** pending invites for that person aren't cancelled automatically —
revoke them yourself. If you change a pre-employee's role here, their onboarding
activation can later set it back to the role the onboarding proposed.

---

## 8. Employee onboarding: pre-employee → active staff

1. **Create the onboarding** (Onboarding → Start onboarding / assign a package).
   Choose their role for after onboarding: Therapist ("Employee"), Admin or Read-only.
2. **Give them a way in** — either:
   - **Release** (preferred): creates a **pre-employee** account with no password
     and emails an **onboarding link** (`/onboarding-invite?token=…`, 14 days by
     default, up to 60). They choose their password there and are signed straight
     in to their onboarding. Use the Onboarding screen's **Resend invitation** if needed.
   - **Create portal account** (Owner only): issues a **temporary password**
     (e.g. `Harbour-olive-dune-numbat-4821-0937`), shown to you **once**. It expires
     after 7 days unused (adjustable 1–30). On first sign-in they must set their own.
3. As a pre-employee they see **only** their own onboarding: forms, uploads,
   policy acknowledgements, assigned learning.
4. **Activation:** when every blocking requirement is approved/verified, someone
   with `onboarding.activate` presses **Activate**, or the portal activates them
   automatically once the documentation stage is complete. Their role changes to
   the one chosen in step 1; they get an "account active" email and notification.
5. On their next click they have their full role. For a therapist, link their
   Splose practitioner (§9) and ask them to connect Outlook.

**Release won't touch an existing account.** If the starter's email already
belongs to an account (a re-hire, or someone you've already invited), Release
stops with "An account already uses this email address…". Change the applicant
email, or manage the existing account from Users & Roles.

Onboarding won't release in production unless `ONBOARDING_ENCRYPTION_KEY` is set
(TFN and bank details must be encrypted).

---

## 9. Linking a portal account to a Splose practitioner

- **Owner:** Users & Roles → the person → **Splose practitioner** → pick →
  **Link**. Practitioners already linked to another active person are greyed out.
  **Disconnect** removes the link. Needs the Splose connection (Settings → Integrations).
- **The person themselves** can link only the practitioner whose Splose email
  exactly matches their portal sign-in email; otherwise they're told to ask you.
- Until a therapist is linked, their Splose appointments and travel don't show.

---

## 10. Microsoft: Outlook connection and Microsoft 365 accounts

- **Outlook connection** (each person, after signing in): Settings →
  Integrations → Connect Outlook. A mailbox can be connected to only one portal
  account. In production the Microsoft page never creates or signs in to a portal
  account; it only attaches a mailbox to whoever is signed in.
- **Microsoft 365 account creation** (Onboarding, Owner): creates a work mailbox
  and licence. Switched **off** until `M365_PROVISIONING_ENABLED=true` and your
  tenant administrator grants `User.ReadWrite.All` + `Organization.Read.All`
  (application permissions). Nothing is ever deleted in Microsoft.

---

## 11. Settings that must be right in production (names only)

| Setting | Why it matters |
|---|---|
| `NODE_ENV=production` | Secure cookies, strict origin checks, fail-closed OAuth |
| `SESSION_SECRET` | Signs session cookies; ≥ 32 random characters or the server won't start |
| `APP_BASE_URL` (https) | Every invite/verify/reset/onboarding link is built from it; required to start |
| `ALLOWED_ORIGINS` | Must contain the exact public URL, or sign-in and forms are rejected |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM` | Without host **and** user **and** password nothing is emailed (copy-link mode). Start-up now warns if host is set without user/password |
| `BOOTSTRAP_OWNER_EMAIL`, `ORG_NAME` | First-Owner setup on a new database (§2); clear `BOOTSTRAP_OWNER_EMAIL` afterwards |
| `ALLOWED_EMAILS` / `ALLOWED_DOMAINS` | Who can self-register; keep as narrow as possible |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored Outlook tokens |
| `ONBOARDING_ENCRYPTION_KEY` | Needed before Onboarding can release or create accounts |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI` | Outlook connection and M365 provisioning |
| `M365_PROVISIONING_ENABLED`, `M365_DOMAIN`, `M365_LICENCE_SKU_BASIC`, `M365_LICENCE_SKU_FULL`, `M365_USAGE_LOCATION` | M365 account creation (optional) |

---

## 12. Production-readiness checklist

- [ ] `NODE_ENV=production`, strong `SESSION_SECRET`, https `APP_BASE_URL`, `ALLOWED_ORIGINS` = the real URL.
- [ ] Email fully configured. Send yourself a test invite and a password reset; check every link starts with the real URL.
- [ ] `BOOTSTRAP_OWNER_EMAIL` = your address (and in `ALLOWED_EMAILS`); register yourself first; then clear it and narrow `ALLOWED_*`.
- [ ] No `@opaltherapy.dev` or test accounts exist in production.
- [ ] Invite everyone via Users & Roles (or Onboarding) rather than self-registration.
- [ ] Decide who (if anyone besides you) gets `onboarding.activate` / `onboarding.assign`.
- [ ] Offboarding routine: **Deactivate** (this also disconnects Outlook) → revoke any pending invite → disable their Microsoft 365 sign-in if it isn't portal-managed.
- [ ] On staging, confirm a burst of wrong passwords returns "Too many login attempts".

**Known limits, deferred (not blocking):** reset/invite tokens are stored as
plain values in the database (protect database access); email uniqueness is not
yet enforced case-insensitively at the database level; sessions have no absolute
maximum length; no two-factor sign-in; Users & Roles has no "Release Outlook"
button (Suspend/Deactivate cover the leaver case).
