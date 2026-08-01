# Production Rollback & Recovery

For `opal-portal-prod`. Written at first provisioning (2026-08-01). Every
command is safe to paste; nothing here enables writes or touches staging.

## 1. Roll back a bad deployment

Preferred: re-run **Deploy Production** from the last known-good commit —
Actions → Deploy Production → Run workflow on that commit (confirm phrase
`deploy-production`, then approve the environment gate). CI rebuilds the
bundle from that exact commit.

Manual fallback (artifact redeploy, kept 14 days): download `deploy-package`
from the known-good run, then:
```bash
az webapp deploy -g opal-portal-prod-rg -n opal-portal-prod --src-path deploy.zip --type zip
```
Migrations are additive-only by policy, so rolling code back never needs a
schema rollback.

## 2. Disable production access immediately (kill switch)

```bash
az webapp stop -g opal-portal-prod-rg -n opal-portal-prod
```
Site returns 403 for everyone within seconds; nothing is deleted. Resume:
```bash
az webapp start -g opal-portal-prod-rg -n opal-portal-prod
```
(Softer options: suspend the affected account — §3 — or put staging's rule
of after-hours deploys into effect; there is no auto-deploy to production,
so a bad merge can never reach it on its own.)

## 3. Suspend a therapist (or any) account

Portal: Settings → Users & Roles → **Suspend** next to the account — kills
their sessions immediately; reversible with Re-activate. This is the
first-line response to any account concern. Their Outlook connection can
be cleared from their own Settings (Disconnect) or by the developer.

## 4. Restore the database from backup

PG Flexible has **14-day point-in-time recovery** (provisioned). Restores
create a NEW server — nothing overwrites in place:
```bash
az postgres flexible-server restore \
  -g opal-portal-prod-rg --name opal-portal-prod-pg-restored \
  --source-server opal-portal-prod-pg \
  --restore-time "2026-08-01T10:00:00Z"   # UTC point to restore to
```
Then point the app at it (rewrite `DB_HOST` app setting → restart) or
extract what you need with psql and keep the original. **A restore drill
should be executed once before the therapist's first login** — it is on
the go-live checklist.

Employee documents (blob): production has **30-day blob soft-delete**
enabled from day one — deleted files are recoverable in the portal
(Storage account → container → show deleted blobs → undelete).

## 5. Secret rotation reminder (the platform gotcha)

After rotating any Key Vault secret, **re-write the app setting** that
references it (`az webapp config appsettings set … KEY=@Microsoft.KeyVault(…)`)
— a restart alone serves the cached old value, and the old worker overlaps
~100 seconds. Verify on `/health` uptime reset.

## 6. Who does what

| Situation | First move | Who |
|---|---|---|
| Bad deploy | §1 re-run from known-good | Developer (owner approves gate) |
| Suspected account compromise | §3 suspend + §2 if severe | Owner |
| Data damage | §2 stop, then §4 restore decision | Owner + developer |
| Secret leak | Rotate in KV + §5 rewrite + audit review | Developer |
| Anything unclear | §2 stop is always safe — nothing is lost by stopping | Owner |
