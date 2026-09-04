# Cloud accounts — who is who (Opal Therapy)

_Started 2 Sep 2026 while chasing the Bedrock guardrail. Verified facts are
marked ✅; open questions are marked ❓. Update this file whenever an account
fact is confirmed — losing track of accounts is exactly what this exists to
prevent._

## Microsoft / Azure logins (one Entra tenant)

There is **one** Entra tenant: **OT Services** (`opaltherapy.com.au`),
tenant id `ab55fe6c-cf70-4452-87aa-5c017960d362`. Three logins exist in it —
all owned/operated by Antony:

| Login | What it is | Verified |
|---|---|---|
| `ant.manixavier@gmail.com` | Personal Microsoft account, guest in the OT Services tenant. **Sees no Azure subscriptions** — portal shows "Welcome to Azure" onboarding. Not the account that runs anything. | ✅ 2 Sep 2026 |
| `ann.mathew@opaltherapy.com.au` | Tenant member. Sees **Opal Therapy Azure Subscription** (`fec1b1a7-822c-4cf5-a4cc-564f7d3d6a9e`) and the staging App Service. `az webapp config appsettings list` returns an **empty list** for her — she can see setting *names* in the portal but apparently cannot read values (Reader-level RBAC). | ✅ 2 Sep 2026 |
| `adminservices@opaltherapy.com.au` | Presumed the admin/owner login used to provision the infrastructure. ❓ Not yet signed in during this mapping; likely the login that can read App Service setting values and holds Owner on the subscription. | ❓ |

### Azure resources (Opal Therapy Azure Subscription)

- **`opal-portal-staging`** — App Service (Linux, Node 22, Australia East),
  resource group `opal-portal-staging-rg`, plan B1. This is staging =
  `opal-portal-staging.azurewebsites.net`. Healthy, running. ✅
- Key Vault–sourced settings exist (e.g. `AZURE_STORAGE_CONNECTION_STRING`),
  so a Key Vault is attached to the subscription. ❓ name not recorded yet.
- The AI federation settings live here as App Service settings:
  `AWS_REGION`, `AWS_ROLE_ARN`, `AZURE_BEDROCK_AUDIENCE`, `BEDROCK_MODEL_ID`,
  `BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION` (all slot-pinned). ✅
  (names seen in the portal; values not yet read — see AWS question below.)

## AWS accounts

| Account | What it is | Verified |
|---|---|---|
| **871328431562** — "Opal Therapy - AI Staging" | The account Antony's AWS console root login reaches. **Empty**: zero Bedrock guardrails in every plausible region and zero IAM roles containing "Bedrock". Despite the name, the live staging AI stack is NOT here. | ✅ 2 Sep 2026 (checked as root via CloudShell) |
| **❓ unknown account** | Holds the actual staging AI stack proven live on 19 Aug 2026: IAM role `OpalPortalStagingBedrockRole`, OIDC provider federating from the OT Services tenant, guardrail `OpalClinicalAIGuardrail` v1, Bedrock model access (`au.anthropic.claude-sonnet-4-5…` inference profile). The 12-digit account id is the one inside `AWS_ROLE_ARN` on `opal-portal-staging`. **To identify it: reveal `AWS_ROLE_ARN` in the App Service → Environment variables.** | ❓ THE open question |

## How the pieces connect (staging AI path)

Azure App Service (`opal-portal-staging`, OT Services tenant)
→ managed identity issues an Entra OIDC token
→ AWS STS `AssumeRoleWithWebIdentity` into `OpalPortalStagingBedrockRole`
(in the ❓ unknown AWS account)
→ Bedrock `ap-southeast-2` with `OpalClinicalAIGuardrail` v1 applied.

The mobile app and portal frontend never talk to AWS — only the portal
backend does, via `backend/ai/ai-gateway.js`.

## Open items

1. Reveal `AWS_ROLE_ARN` on `opal-portal-staging` → record the AWS account id
   here and note which login/root email opens that AWS account.
2. Record what login the "Opal Therapy - AI Staging" account (871328431562)
   was created for — it is currently empty; either adopt it for a future
   purpose or close it to avoid exactly this confusion.
3. Confirm `adminservices@opaltherapy.com.au` RBAC (Owner?) and record which
   human tasks require it (App Service settings changes, Key Vault reads).
4. Guardrail fix pending on item 1: change PII NAME action to ANONYMIZE on
   `OpalClinicalAIGuardrail`, publish a new version, update
   `BEDROCK_GUARDRAIL_VERSION` on the App Service.
