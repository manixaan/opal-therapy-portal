# AWS AI Deployment Runbook

| | |
|---|---|
| **Version** | 1.0 |
| **Effective date** | 10 August 2026 |
| **Owner** | Opal Therapy Pty Ltd |
| **Classification** | Internal — Deployment Procedure |
| **Applies to** | Milestone 3 (AWS Security Foundation, Federation, Bedrock restriction) |
| **Governed by** | [`AI_SECURITY_ARCHITECTURE.md`](AI_SECURITY_ARCHITECTURE.md) |

**Nothing in this document has been executed.** It is the plan. No AWS resources exist, no credentials have been created, and no application code has been wired to AWS.

> ## ⚠️ Correction to earlier advice
>
> I previously said that moving to a federated role would need **no application code change**, because the Bedrock provider resolves credentials through the standard AWS chain. **That was wrong**, and the error mattered enough to head this document.
>
> The standard chain's web-identity step (`fromTokenFile`) reads a token **from disk** — a mechanism built for EKS, where Kubernetes projects a service-account token into the pod. **Azure App Service has no equivalent.** Its token lives behind an HTTP endpoint, and nothing writes it to a file. The default chain therefore finds nothing and fails with "Could not load credentials from any providers."
>
> The change is small and confined to one module (§7.4), but it is real and must be scheduled. Everything else about the design stands.

---

## 1. Target architecture

```
  Azure App Service  (Opal backend, Node.js)
        │
        │  user-assigned managed identity
        ▼
  Microsoft Entra ID
        │
        │  OIDC access token, v2.0, audience = dummy app registration
        ▼
  AWS STS · AssumeRoleWithWebIdentity
        │
        │  temporary credentials (1 hour)
        ▼
  IAM role: OpalClinicalAIRuntimeRole
        │
        ▼
  Bedrock Runtime · ap-southeast-2
        │
        ▼
  AU geo inference profile
        ├── Sydney     (ap-southeast-2)
        └── Melbourne  (ap-southeast-4)
```

**No long-lived AWS credential exists anywhere** — not in `.env`, not in Azure Key Vault, not in a pipeline variable.

### The part that is counter-intuitive

Microsoft's "workload identity federation" documentation describes the **inbound** direction — an external provider federating *into* Entra. This is the **outbound** direction, which Microsoft does not name and barely documents. There is no Azure feature to enable. You simply need a signed Entra token that AWS STS can validate via OIDC discovery, and a managed identity can produce one.

Two consequences that trip people up:

- **A dummy app registration is required** — not as the caller, but as the token's *audience*. Entra will not mint a token for a resource that has no service principal in the tenant (`AADSTS500011`). It needs no secret and no certificate; creating one would reintroduce exactly the long-lived credential this design removes.
- **`api://AzureADTokenExchange` is the wrong audience.** That is what Entra requires on an *inbound* assertion. Using it here is a common and confusing mistake.

---

## 2. AWS account requirements

### Account structure

```
AWS Organisation
├── Opal Production        clinical AI only
├── Opal Staging           synthetic data only
└── Opal Security / Audit  CloudTrail sink, read-only
```

At minimum, **production and staging must be separate accounts**. Do not evaluate a new model or prompt in the account that serves clinical work.

### Staging must not share production's policy

A separate account is not enough on its own. Staging needs its own posture, or the first time someone wants to check whether a prompt change works they will reach for a real client note:

| | Production | Staging |
|---|---|---|
| Data | Clinical | **Synthetic only** |
| Provider | Bedrock, AU regions | Bedrock, AU regions (unchanged) |
| Models | Approved registry | Approved registry, cheaper default permitted |
| Audit | Required | Required |
| Human review | Required | Required |

**This implies an application change that does not yet exist** — the model registry and policy engine are currently environment-independent. Adding an environment dimension is a Milestone 4 item, tracked in [`AI_SECURITY_ARCHITECTURE.md`](AI_SECURITY_ARCHITECTURE.md) §14. Until it exists, staging inherits production's rules, which is safe but not cost-optimal.

### Region enablement

`ap-southeast-2` (Sydney) is the source region and needs nothing special. `ap-southeast-4` (Melbourne) is an **opt-in region**, but only matters if you *source* from it — as a geo-profile destination AWS manages it. Sourcing from Sydney, as designed, means there is no Melbourne enablement step.

### Model activation

Bedrock foundation-model access is granted automatically once Marketplace requirements are met. What remains is the **Anthropic first-time-use form**, once per account or organisation, performed by a principal holding Marketplace subscribe permissions. Expect a transient `AccessDeniedException` for up to ~15 minutes on first call while the subscription completes.

**The runtime role must not retain Marketplace permissions afterwards.** Activation is administrative; §4 gives it none.

---

## 3. Required IAM roles

Three roles, deliberately. A single role that can both invoke models and change which models are approved defeats the separation the application layer enforces in code.

| Role | Purpose | Assumed by |
|---|---|---|
| `OpalClinicalAIRuntimeRole` | Invoke approved models. Nothing else. | The App Service, via OIDC federation |
| `OpalAIOpsAdmin` | Change models, policies, permissions, retention settings | Humans, deliberately, with MFA |
| `OpalAIAuditReader` | Read CloudTrail and security logs | Review and incident response |

The runtime role gets **no** `bedrock:*`, no `iam:*`, no `s3:*`, no Marketplace permissions, and no ability to change Bedrock retention settings. If an application compromise cannot widen its own permissions, the blast radius stays bounded.

---

## 4. Required permissions

### 4.1 Runtime role — trust policy

**Do not write this from the values you expect. Decode a real token first (§8.1).** The `sub` claim's meaning is genuinely contradictory across Microsoft's documentation — one page says it is the managed identity's object ID, another says it is a pairwise identifier that varies per audience. Both cannot be generally true, and the value is case-sensitive.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "OpalAppServiceFederatedBedrockAccess",
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::{awsAccountId}:oidc-provider/login.microsoftonline.com/{tenantId}/v2.0"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "login.microsoftonline.com/{tenantId}/v2.0:aud":  "{managedIdentityClientId}",
        "login.microsoftonline.com/{tenantId}/v2.0:oaud": "{appRegistrationClientId}",
        "login.microsoftonline.com/{tenantId}/v2.0:sub":  "{OBSERVED-FROM-A-REAL-TOKEN}"
      }
    }
  }]
}
```

Four independent pins: the **tenant** (via the issuer in the ARN), the **calling workload** (`aud`), the **target audience** (`oaud`), and the **principal** (`sub`). This is not "any identity in the tenant" — `aud` alone already restricts to one managed identity.

**Claim-mapping facts that are easy to get wrong:**

- AWS's `:aud` condition key reads the **`azp`** claim when present, falling back to `aud`. Entra v2.0 tokens carry both. So `:aud` must be the **managed identity's** client ID, not the app registration's. Getting this backwards produces `InvalidIdentityToken: Incorrect token audience`.
- **`oid`, `appid` and `tid` are not available as condition keys.** AWS ignores non-standard claims. A condition on `:tid` will never match. Tenant restriction comes from the issuer URL, which is the correct and complete mechanism.
- Register **both** GUIDs as audiences on the IAM OIDC provider (it accepts up to 100). It costs nothing and makes the deployment robust if `azp` turns out not to be emitted for this token type.

### 4.2 Runtime role — permissions policy

A cross-region inference profile authorises against **both** the profile ARN **and** the underlying foundation-model ARN **in every destination region**. A policy naming only the model ARNs will fail. Foundation-model ARNs have an empty account field — that is correct; they are AWS-owned.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "InvokeApprovedAuProfilesOnly",
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    "Resource": [
      "arn:aws:bedrock:ap-southeast-2:{acct}:inference-profile/au.anthropic.claude-sonnet-4-6",
      "arn:aws:bedrock:ap-southeast-4:{acct}:inference-profile/au.anthropic.claude-sonnet-4-6",
      "arn:aws:bedrock:ap-southeast-2:{acct}:inference-profile/au.anthropic.claude-opus-4-8",
      "arn:aws:bedrock:ap-southeast-4:{acct}:inference-profile/au.anthropic.claude-opus-4-8",
      "arn:aws:bedrock:ap-southeast-2::foundation-model/anthropic.claude-sonnet-4-6",
      "arn:aws:bedrock:ap-southeast-4::foundation-model/anthropic.claude-sonnet-4-6",
      "arn:aws:bedrock:ap-southeast-2::foundation-model/anthropic.claude-opus-4-8",
      "arn:aws:bedrock:ap-southeast-4::foundation-model/anthropic.claude-opus-4-8"
    ]
  }]
}
```

### 4.3 Organisation guardrails

The code says *don't*; AWS says *can't*. Both namespaces are required — a `bedrock:*` deny does not cover `bedrock-mantle:*`.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyBedrockOutsideAustralia",
    "Effect": "Deny",
    "Action": ["bedrock:*", "bedrock-mantle:*"],
    "Resource": "*",
    "Condition": {
      "StringNotEquals": { "aws:RequestedRegion": ["ap-southeast-2", "ap-southeast-4"] }
    }
  }]
}
```

Global cross-region requests evaluate `aws:RequestedRegion` as the literal string `unspecified`, which this allow-list form correctly denies. A deny-list form would not — do not rewrite it that way.

---

## 5. Bedrock approved models

> **The ids below are ILLUSTRATIVE, not authoritative.** `backend/ai/ai-model-registry.js`
> deliberately carries `id: null` for both clinical entries: which inference profiles
> exist is a fact about one AWS account and cannot be read from source, and an
> unverified-but-plausible profile id is the worst kind — it passes every local check,
> is written into the audit row as the model in use, and only fails when a therapist is
> waiting. The real ids come from `BEDROCK_MODEL_ID` (and optionally the per-tier
> `BEDROCK_MODEL_ID_CLINICAL_STANDARD` / `_CLINICAL_COMPLEX`).
>
> **Verify against the account before writing anything into the IAM policy below**, and
> make the policy's resource list match what is actually configured. A resource list
> naming profiles the deployment does not use produces an `AccessDenied` that looks
> exactly like a broken federation path.

| Registry key | Purpose | Source regions |
|---|---|---|
| `clinical_standard` | Everyday structuring and summarisation; the default for most work | ap-southeast-2, ap-southeast-4 |
| `clinical_complex` | Report-grade fidelity where omission risk matters most | ap-southeast-2, ap-southeast-4 |

**Nothing else.** Not Haiku, not Sonnet 5, not global or apac profiles, not another provider — until deliberately approved through the change-control process in [`AI_SECURITY_ARCHITECTURE.md`](AI_SECURITY_ARCHITECTURE.md) §15.

**Claude Fable 5 and Mythos 5 must be denied at the organisation level**, not merely omitted. They mandate data retention with provider data sharing and are excluded from Bedrock's HIPAA eligibility. The application blocks them; AWS should too.

Adding a model means three changes, all of them: the registry, the policies that may use it, and the IAM resource list. Verify availability at runtime before any of them:

```bash
aws bedrock get-inference-profile \
  --inference-profile-identifier au.anthropic.claude-sonnet-4-6 \
  --region ap-southeast-2
```

---

## 6. CloudTrail requirements

**Enable CloudTrail before the first AI request**, so the first call is already auditable.

| Setting | Value |
|---|---|
| Trail name | `opal-ai-security-audit` |
| Scope | All regions |
| Storage | S3 in the Security/Audit account, encrypted (SSE-KMS) |
| Log file validation | **Enabled** |
| Bedrock invocation logging | **OFF** — see below |

CloudTrail records the API metadata without the content, including **`additionalEventData.inferenceRegion`** — the only authoritative record of which Australian region actually processed a call. Cross-region calls are logged in the source region.

**Bedrock model invocation logging stays off.** It writes full request and response bodies — clinical narrative — into your own S3 or CloudWatch, which then becomes your retention and access-control problem under APP 11. The application's own `ai_interactions` table already provides metadata attribution.

Also enable, in the same pass: **AWS Config** (detects IAM, policy and region drift) and **GuardDuty** (account protection generally).

### Correlating a note to its processing region

```sql
SELECT provider_request_id, source_region, created_at
  FROM ai_interactions WHERE id = '<ai_interaction_id from the draft>';
```

Then look up that request id in CloudTrail and read `additionalEventData.inferenceRegion`. `source_region` records where the request was *sent from*; only CloudTrail records where it *ran*.

---

## 7. Deployment sequence

Run in order. Steps 1–3 produce values that steps 4–5 consume.

### 7.1 Azure identity

1. Create a **user-assigned managed identity**. Assign it to the App Service.
   Record: **client ID** and **principal (object) ID**.
   *User-assigned, not system-assigned* — its IDs survive App Service recreation and slot swaps. A system-assigned identity's IDs change, which would silently break the IAM trust policy and require an AWS-side fix to recover.
2. Create an **app registration** — audience only, **no secret, no certificate**.
   Set `requestedAccessTokenVersion: 2` in the manifest. Use the default App ID URI `api://{clientId}`.
   Record: **client ID**.

### 7.2 Decode a real token — do not skip

Before creating any AWS resource, run the diagnostic in §8.1 and confirm `ver`, `iss`, `azp` and `sub`. Three unknowns are resolved by this one step, and all three would otherwise be guesses baked into a trust policy.

### 7.3 AWS resources

3. Create the **IAM OIDC identity provider**: URL `https://login.microsoftonline.com/{tenantId}/v2.0`, audiences = **both** client IDs, **no thumbprint** (AWS has auto-retrieved it since July 2024).
4. Create **`OpalClinicalAIRuntimeRole`** with the §4.1 trust policy using **observed** claim values, and the §4.2 permissions policy.
5. Apply the §4.3 SCP.

### 7.4 Application change

6. Add a credential module and pass it to the Bedrock client. This is the code change flagged at the top.

   - `AnthropicBedrock` accepts **`providerChainResolver`** — a thunk returning an AWS credential provider. **Requires `@anthropic-ai/bedrock-sdk` >= 0.23.0**; pin it. (Currently installed: 0.32.1.)
   - The token must be fetched from `IDENTITY_ENDPOINT` and exchanged via `fromWebToken`. Note `fromWebToken`'s `webIdentityToken` is a **string, not a callback** — it has no refresh logic, so the provider must be wrapped with its own caching and re-assume.
   - **Memoise the provider.** The Bedrock SDK resolves credentials **per request** and its default resolver builds a fresh chain each time. Left alone, every clinical inference would trigger an Entra token fetch and an STS `AssumeRoleWithWebIdentity` — added latency, throttling risk, and CloudTrail noise. Cache and re-assume only within 5 minutes of expiry.
   - Do **not** use the inherited `credentials` option — that is Anthropic OAuth, not AWS, and passing an AWS provider there fails confusingly.

   The change is confined to `backend/ai/providers/bedrock-provider.js` plus one new module. No call sites change, and the gateway, policy engine and audit layer are untouched.

7. Set App Service settings — **these are the names the code actually reads** (`backend/ai/aws/bedrock-config.js` is the single owner and validates all six): `AWS_REGION=ap-southeast-2`, `AWS_ROLE_ARN`, `AZURE_BEDROCK_AUDIENCE`, `BEDROCK_MODEL_ID`, `BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION`. Optionally `AWS_ROLE_SESSION_NAME`, and `BEDROCK_MODEL_ID_CLINICAL_STANDARD` / `BEDROCK_MODEL_ID_CLINICAL_COMPLEX` to give the two tiers separate profiles.

   > Earlier revisions of this step named `AWS_FED_ROLE_ARN`, `AWS_FED_ENTRA_RESOURCE`, `AWS_FED_MI_CLIENT_ID` and `AI_AWS_REGION`. **None of those is read by the application.** A deployment configured from that list has no working AI and no error saying so, because every one of the real settings is simply absent.
8. **Remove any `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.** `fromEnv` is first in the credential chain, so stale keys would mask a broken federation path — you would believe federation works when it does not. This is the single most likely way to ship a false pass.
9. Confirm `WEBSITE_DISABLE_MSI` is **not** set — it disables the local token service while leaving the identity visibly assigned.
10. Deploy. Run the acceptance test ([`AI_SECURITY_ACCEPTANCE_TEST.md`](AI_SECURITY_ACCEPTANCE_TEST.md)) before enabling any feature flag.

### Timing you cannot control

Azure caches managed-identity tokens per resource for **~24 hours**, and Microsoft states it is not possible to force a refresh before expiry. **Permission and app-role changes can take up to 24 hours to take effect.** Plan cutovers and rollbacks around this — it is the least intuitive hazard in the design.

---

## 8. Verification tests

### 8.1 Token diagnostic (run before creating AWS resources)

From the App Service (Kudu console or a temporary diagnostic route):

```bash
TOKEN=$(curl -s -H "X-IDENTITY-HEADER: $IDENTITY_HEADER" \
  "$IDENTITY_ENDPOINT?resource=api://{appRegClientId}&api-version=2019-08-01&client_id={miClientId}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

python3 -c "
import sys,json,base64
p=sys.argv[1].split('.')[1]; p+='='*(-len(p)%4)
c=json.loads(base64.urlsafe_b64decode(p))
for k in ['iss','aud','azp','sub','oid','tid','ver','exp']: print(f'{k:6}: {c.get(k)}')
" \"\$TOKEN\"
```

Confirm before proceeding: `ver` is `2.0` · `iss` ends `/v2.0` with **no** trailing slash · `azp` present and equal to the MI client ID · record `sub` verbatim.

Note App Service specifics: the env var is `IDENTITY_HEADER` but the HTTP header is `X-IDENTITY-HEADER`; api-version is `2019-08-01`; user-assigned identities use `mi_res_id`, **not** `msi_res_id`. Never hardcode `169.254.169.254` — App Service does not use the VM IMDS endpoint.

### 8.2 Post-deployment

Full checklist in [`AI_SECURITY_ACCEPTANCE_TEST.md`](AI_SECURITY_ACCEPTANCE_TEST.md). In summary: no AWS keys present; both approved models work; an unapproved model is denied; CloudTrail shows an Australian `inferenceRegion`; a clinical document creates an audit reservation; a failed audit blocks generation; the kill switch works and is recorded.

**One STS call per hour, not per request.** Verify in CloudTrail. Per-request assumes mean the memoisation in §7.4 is not working.

---

## 9. Rollback

Ordered by speed. The first is seconds and needs nothing external.

| Step | Action | Effect |
|---|---|---|
| 1 | `AI_GLOBAL_DISABLE=true` (App Service setting) | All AI stops. Needs a restart; works with the database down. |
| 2 | `UPDATE system_settings SET value='false', reason='...', updated_by='...' WHERE key='ai_global_enabled'` | All AI stops within 15s, no restart, break-glass event recorded. |
| 3 | Set `CLINICAL_NOTE_AI_ENABLED=false` / `OPA_AI_ENABLED=false` | Per-feature stop. |
| 4 | Detach the IAM role's permissions policy | AWS-side stop; app fails closed and keeps transcripts. |
| 5 | Delete the IAM OIDC provider | Federation stops entirely. Recovery requires recreating it. |

Steps 1–3 are reversible in seconds. Step 5 is not — and note the ~24-hour managed-identity token cache when planning recovery.

**Rolling back the application code** is a normal deploy: the previous build has no AWS dependency and fails closed, so no clinical work is lost — generation returns `503` and therapists keep their transcripts.

---

## 10. Incident response

### If AI may have sent data somewhere it should not

1. **Disable** — rollback step 1 or 2. Record the reason in the same statement.
2. **Revoke** — detach the runtime role's permissions policy (step 4). Do not delete the role yet; you need its CloudTrail history.
3. **Scope it** — determine what ran:
   ```sql
   SELECT id, user_id, feature, model_id, source_region, provider_request_id,
          status, deny_reason, created_at
     FROM ai_interactions
    WHERE created_at > '<suspect time>' ORDER BY created_at;
   ```
   Then correlate each `provider_request_id` against CloudTrail for the actual `inferenceRegion`.
4. **Assess** — if data reached a non-Australian region or an unapproved destination, treat it as a potential eligible data breach. The NDB scheme allows **30 days** to assess and OAIC treats that as a maximum. A breach at a processor is the practice's notifiable breach too.
5. **Do not re-enable** until the cause is understood, and record the reason on the way back up as well.

### If credentials may be compromised

There are no long-lived AWS credentials to rotate — that is the point of §1. Revoke by detaching the role policy or adding a deny statement; STS credentials expire within the hour. If the Entra side is suspect, delete the federated identity or the managed identity assignment.

### If a model or provider incident is announced

Disable (step 1 or 2), then decide whether the affected model can be removed from the registry while leaving the other approved model in service — the registry is per-model, so a single-model withdrawal is a small change rather than a shutdown.

---

## Open items requiring a prototype

Documentation cannot settle these. Budget one non-production cycle.

| # | Unknown | Resolved by |
|---|---|---|
| 1 | Whether Entra emits `azp` on managed-identity app-only tokens — decides the Audience value | §8.1 diagnostic |
| 2 | What `sub` contains — Microsoft's docs contradict; decides the trust policy | §8.1 diagnostic |
| 3 | Whether the managed identity needs an app-role assignment on the app registration | §8.1 fails if so |
| 4 | Whether AWS enforces `subject_types_supported: public` (Entra advertises `pairwise`) | Creating the OIDC provider in a non-prod account |
| 5 | End-to-end behaviour against live STS and Bedrock | Non-prod deployment |

Items 1–3 are resolved by the single diagnostic in §8.1. **Run it first.**
