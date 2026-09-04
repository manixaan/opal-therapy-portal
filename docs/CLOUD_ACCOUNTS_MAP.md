# Cloud accounts — who is who (Opal Therapy)

_Started 2 Sep 2026 while chasing the Bedrock guardrail. Verified facts are
marked ✅; open questions are marked ❓. Update this file whenever an account
fact is confirmed — losing track of accounts is exactly what this exists to
prevent. (A stray `docs/CLOUD_ACCOUNTS.md` may exist from the same day; macOS
locked it mid-write — this file is the real one.)_

## Microsoft / Azure logins (one Entra tenant)

There is **one** Entra tenant: **OT Services** (`opaltherapy.com.au`),
tenant id `ab55fe6c-cf70-4452-87aa-5c017960d362`. Three logins exist in it —
all owned/operated by Antony:

| Login | What it is | Verified |
|---|---|---|
| `ant.manixavier@gmail.com` | Personal Microsoft account, guest in the OT Services tenant. **Sees no Azure subscriptions** — portal shows "Welcome to Azure" onboarding. Not the account that runs anything. | ✅ 2 Sep 2026 |
| `ann.mathew@opaltherapy.com.au` | Tenant member. Sees **Opal Therapy Azure Subscription** (`fec1b1a7-822c-4cf5-a4cc-564f7d3d6a9e`) and the staging App Service, and CAN reveal App Service setting values in the portal. Her CLI `az webapp config appsettings list` returns an empty list (RBAC quirk worth clarifying). | ✅ 2 Sep 2026 |
| `adminservices@opaltherapy.com.au` | Presumed the admin/owner login used to provision the infrastructure. ❓ Not yet signed in during this mapping; likely holds Owner on the subscription. | ❓ |

### Azure resources (Opal Therapy Azure Subscription)

- **`opal-portal-staging`** — App Service (Linux, Node 22, Australia East),
  resource group `opal-portal-staging-rg`, plan B1. This is staging =
  `opal-portal-staging.azurewebsites.net`. Healthy, running. ✅
- There is ALSO an **Enterprise Application** named `opal-portal-staging`
  (App ID `688e00e2-a69c-4319-8d…`) in Entra — that is the identity object
  used for the AWS OIDC federation, not the web app. Easy to confuse in
  portal search: the web app has the blue globe icon. ✅
- Key Vault–sourced settings exist (e.g. `AZURE_STORAGE_CONNECTION_STRING`),
  so a Key Vault is attached to the subscription. ❓ name not recorded yet.
- The AI federation settings live here as App Service settings:
  `AWS_REGION`, `AWS_ROLE_ARN`, `AZURE_BEDROCK_AUDIENCE`, `BEDROCK_MODEL_ID`,
  `BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION` (all slot-pinned). ✅

## AWS accounts

| Account | What it is | Verified |
|---|---|---|
| **871328431562** — "Opal Therapy - AI Staging" | The account Antony's AWS console root login reaches. **Empty**: zero Bedrock guardrails in every plausible region and zero IAM roles containing "Bedrock". Despite the name, the live staging AI stack is NOT here. Candidate for adoption or closure to avoid confusion. | ✅ 2 Sep 2026 (checked as root via CloudShell) |
| **847566517126** — the REAL staging AI account | Holds the staging AI stack proven live 19 Aug 2026: IAM role `OpalPortalStagingBedrockRole` (full ARN `arn:aws:iam::847566517126:role/OpalPortalStagingBedrockRole`, read from the App Service's `AWS_ROLE_ARN` on 2 Sep 2026), the Entra OIDC provider, guardrail `OpalClinicalAIGuardrail` v1 (guardrail id `k0ixihnefq5a`, ARN `arn:aws:bedrock:ap-southeast-2:847566517126:guardrail/k0ixihnefq5a`, from the App Service BEDROCK_GUARDRAIL_ID), and Bedrock model access (`au.anthropic.claude-sonnet-4-5…` inference profile) in ap-southeast-2. ❓ Which root email / login opens this account is not yet recorded. | ✅ account id; ❓ login |

## How the pieces connect (staging AI path)

Azure App Service (`opal-portal-staging`, OT Services tenant)
→ managed identity issues an Entra OIDC token
→ AWS STS `AssumeRoleWithWebIdentity` into `OpalPortalStagingBedrockRole`
(AWS account **847566517126**)
→ Bedrock `ap-southeast-2` with `OpalClinicalAIGuardrail` v1 applied.

The mobile app and portal frontend never talk to AWS — only the portal
backend does, via `backend/ai/ai-gateway.js`.

## Open items

1. Record which login/root email opens AWS account **847566517126**.
2. Decide the fate of the empty "Opal Therapy - AI Staging" account
   (871328431562): adopt it for a purpose or close it.
3. Confirm `adminservices@opaltherapy.com.au` RBAC (Owner?) and record which
   human tasks require it.
4. Clarify why Ann's `az` CLI sees an empty app-settings list while the
   portal shows values for her.
5. DONE 2 Sep 2026: guardrail Version 2 published (NAME = Mask/Mask, was
   Block/Block in v1; console proof: "Saw {NAME} Test today..." masked, not
   refused). `BEDROCK_GUARDRAIL_VERSION` set to 2 on the App Service by
   Antony. Rollback = set it back to 1. Note: v1's working draft already had
   NAME deleted by someone before this session; v2 = v1 with NAME Mask/Mask.
