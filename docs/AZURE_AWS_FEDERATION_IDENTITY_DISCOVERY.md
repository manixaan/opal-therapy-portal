# Azure → AWS Federation: Identity Discovery

| | |
|---|---|
| **Version** | 1.0 |
| **Effective date** | 10 August 2026 |
| **Owner** | Opal Therapy Pty Ltd |
| **Classification** | Internal — Commissioning Procedure |
| **Milestone** | 3A.1 — Identity Discovery |
| **Precedes** | 3A.2 (credential ambiguity) → 3B (CloudTrail → IAM → Federation → Bedrock) |
| **Governed by** | [`AI_SECURITY_ARCHITECTURE.md`](AI_SECURITY_ARCHITECTURE.md) · [`AWS_AI_DEPLOYMENT_RUNBOOK.md`](AWS_AI_DEPLOYMENT_RUNBOOK.md) |

**No AWS resource may be created until this document is completed with observed values.**

That ordering is not procedural fussiness. An AWS IAM trust policy is matched **literally** — a `sub` or `aud` value that is one character or one identifier-type wrong produces either a role nobody can assume, or worse, a trust condition that silently matches more than intended. Azure exposes at least six GUIDs that all look alike, and Microsoft's own documentation contradicts itself about what one of the claims contains. Both problems are solved by reading a real token instead of predicting one.

**This is a commissioning procedure:** establish identity → verify protection → test failure → energise. This document is the first step. Nothing is energised.

---

## 1. Azure identity architecture

```
  Azure App Service  (Opal backend, Node.js)
        │
        │  assigned identity
        ▼
  User-assigned Managed Identity          ← the CALLER
        │
        │  requests a token for a resource
        ▼
  Microsoft Entra ID
        │
        │  issues a v2.0 access token
        │  audience = App Registration     ← the AUDIENCE (a placeholder, not a caller)
        ▼
  [ token is handed to AWS STS in Milestone 3B ]
```

### The direction that confuses everyone

Microsoft's extensive **"workload identity federation"** documentation describes the **inbound** direction — an external provider (GitHub, AWS, GCP) federating *into* Entra. **This is the outbound direction**, which Microsoft does not name and barely documents.

Two consequences:

- **There is no Azure feature to switch on.** You need a signed Entra token that AWS can validate via OIDC discovery. A managed identity can already produce one, for an arbitrary resource.
- **`api://AzureADTokenExchange` is the wrong audience.** That is what Entra requires on an *inbound* assertion. Using it here is a common and confusing mistake, and it will not do what you want.

### Why an app registration exists at all

Entra will not mint a token for a resource that has no service principal in the tenant — the request fails with `AADSTS500011: The resource principal named [X] was not found in the tenant`. The app registration exists **solely to be a valid audience**.

It must have **no client secret and no certificate**. Creating one would reintroduce exactly the long-lived credential this architecture removes, and it is not needed: the managed identity is the caller, the app registration is only a name to point at.

### Why user-assigned, not system-assigned

A system-assigned identity's client and object IDs are destroyed and recreated with the App Service. If the app is recreated, or a slot is swapped, the identifiers change — and the AWS trust policy, which pins them literally, silently stops matching. Recovery would require an AWS-side change during whatever incident caused the recreation.

**Use a user-assigned managed identity.** Its identifiers are stable and independent of the app's lifecycle.

---

## 2. The identifier problem

**This is the single most likely source of a wrong trust policy.** Azure exposes six GUIDs across two objects, several of which are synonyms and several of which are not.

| Identifier | Belongs to | Also called | Where to find it | Used in AWS? |
|---|---|---|---|---|
| **Tenant ID** | The directory | Directory ID | Entra ID → Overview | ✅ **In the issuer URL** — this is how the tenant is pinned |
| **MI client ID** | Managed identity | Application ID | The UAMI's Overview blade | ✅ **IAM OIDC audience** and the `:aud` condition |
| **MI object ID** | Managed identity | **Principal ID** — same value, two names | The UAMI's Overview blade | ⚠️ **Possibly `sub`** — must be observed, §3 |
| **MI resource ID** | Managed identity | ARM resource ID | UAMI → Properties | ❌ Azure only (`mi_res_id` query param) |
| **App reg client ID** | App registration | Application ID | App registrations → Overview | ✅ The `resource` requested, and the `:oaud` condition |
| **App reg object ID** | App registration | — | App registrations → Overview | ❌ Never |
| **Service principal object ID** | The app registration's *enterprise app* | Enterprise app object ID | Enterprise applications → Overview | ❌ Never |

Three traps worth stating plainly:

1. **"Object ID" and "Principal ID" are the same value** for a managed identity. Different blades label it differently; it is not two things.
2. **An app registration has two object IDs.** The *application object* (App registrations) and its *service principal* (Enterprise applications) are separate directory objects with separate object IDs, sharing one client ID. Neither object ID is used here.
3. **`mi_res_id`, not `msi_res_id`.** The App Service token endpoint uses the former. The one-letter difference is a real and commonly copied error.

### Record the values before running the diagnostic

**Observed 10 August 2026 from `opal-portal-staging`.** These are directory
*identifiers*, not credentials — Microsoft treats tenant, client and object IDs
as non-secret, which is why they can live in a repository document while the
token itself never leaves the App Service.

| Value | Observed |
|---|---|
| Tenant ID | `ab55fe6c-cf70-4452-87aa-5c017960d362` |
| UAMI name | *(record)* |
| UAMI client ID | `688e00e2-a69c-4319-8dfa-bbf4dc2d319c` |
| UAMI object (principal) ID | `6633a4a6-a29c-4594-a14e-90e75e12e760` |
| App registration name | *(record)* |
| App registration client ID | `cf3d4e18-e058-4236-8d23-68dc7ddffb72` |
| App ID URI | `api://cf3d4e18-e058-4236-8d23-68dc7ddffb72` |
| App Service name / slot | `opal-portal-staging` |

---

## 3. Token diagnostic

Run this **on the App Service** — Kudu console (`https://{app}.scm.azurewebsites.net`) or a temporary authenticated diagnostic route. It cannot be run locally: the token endpoint only exists inside the App Service sandbox.

### 3.1 Preconditions

- The user-assigned managed identity is assigned to the App Service.
- The app registration exists with `requestedAccessTokenVersion: 2` in its manifest. **Without this you get a v1.0 token**, whose issuer carries a trailing slash and whose signing keys come from the tenant-agnostic `common` key set — see §4.
- **`WEBSITE_DISABLE_MSI` is not set.** It disables the local token service while leaving the identity visibly assigned, which produces a baffling failure.

### 3.2 Fetch a token

```bash
RESOURCE="api://{appRegistrationClientId}"
MI_CLIENT_ID="{managedIdentityClientId}"

TOKEN=$(curl -s \
  -H "X-IDENTITY-HEADER: $IDENTITY_HEADER" \
  "$IDENTITY_ENDPOINT?resource=$RESOURCE&api-version=2019-08-01&client_id=$MI_CLIENT_ID" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

**App Service specifics that differ from an Azure VM** — every one of these is a documented failure mode:

| | Azure VM | **App Service** |
|---|---|---|
| Endpoint | `http://169.254.169.254/...` (fixed) | **`$IDENTITY_ENDPOINT`** — host and port vary; never hardcode |
| api-version | `2018-02-01`+ | **`2019-08-01`** |
| Anti-SSRF header | `Metadata: true` | **`X-IDENTITY-HEADER: $IDENTITY_HEADER`** |
| UAMI by resource ID | `msi_res_id` | **`mi_res_id`** |

Note the env var is `IDENTITY_HEADER` but the HTTP header is `X-IDENTITY-HEADER`. They are not the same string, and mixing them is a common failure.

The response has `expires_on` (epoch seconds, as a string) and **no** `expires_in`, unlike the VM endpoint. Parse defensively.

### 3.3 Decode and record

```bash
python3 -c "
import sys, json, base64
p = sys.argv[1].split('.')[1]; p += '=' * (-len(p) % 4)
c = json.loads(base64.urlsafe_b64decode(p))
for k in ['ver','iss','aud','azp','appid','sub','oid','tid','idtyp','roles','exp','iat']:
    print(f'{k:6}: {c.get(k)}')
print()
print('ALL CLAIMS PRESENT:', sorted(c.keys()))
" "$TOKEN"
```

**Do not paste a real token into a chat, a ticket, or this document.** It is a bearer credential until it expires. Record the decoded claim *values* only, and only the ones below.

### 3.4 Record the observed claims

| Claim | Observed value | Expected |
|---|---|---|
| `ver` | `2.0` ✅ | `2.0` — if `1.0`, fix `requestedAccessTokenVersion` and re-run |
| `iss` | `https://login.microsoftonline.com/ab55fe6c-cf70-4452-87aa-5c017960d362/v2.0` ✅ | `https://login.microsoftonline.com/{tenantId}/v2.0` — **no trailing slash** |
| `aud` | `cf3d4e18-e058-4236-8d23-68dc7ddffb72` ✅ | App registration client ID |
| `azp` | `688e00e2-a69c-4319-8dfa-bbf4dc2d319c` ✅ | MI client ID — **⚠️ if absent, see §4.2** |
| `sub` | `6633a4a6-a29c-4594-a14e-90e75e12e760` ✅ | **⚠️ record verbatim, case-sensitive — see §4.3** |
| `oid` | | MI object ID (informational; not usable in AWS) |
| `tid` | | Tenant ID (informational; not usable in AWS) |
| `idtyp` | | Optional — absence is normal and is **not** a failure |
| Full claim list | | |

### 3.5 Diagnostic gate

Do not proceed to §5 until **all** of these are true:

- ☑ `ver` is `2.0`
- ☑ `iss` matches the v2.0 form exactly, with no trailing slash
- ☑ `aud` equals the app registration's client ID
- ☑ `azp` is present **and** equals the managed identity's client ID *(if not, resolve via §4.2 before continuing)*
- ☑ `sub` recorded verbatim

**`idtyp` is NOT a gate condition.** An earlier draft of this document required `idtyp: app`, which was wrong: Microsoft documents the claim as optional, and the real staging token omits it. That gate would have blocked a perfectly valid deployment. `appid` is likewise absent and expected to be — it is the v1.0 spelling, superseded by `azp` in v2.0. Both are informational only.

**If the token request itself fails**, the most likely cause is that the app registration requires assignment. Assign an app role to the managed identity and retry. This is unknown #3 in the runbook and this diagnostic is what resolves it.

---

## 4. Which claims AWS uses, and why

AWS maps OIDC claims to condition keys through a **default mapping** — there is no Microsoft-specific provider tab in the IAM documentation. The mapping is narrower than it looks.

| AWS condition key | Reads which claim | Purpose here |
|---|---|---|
| `…/v2.0:aud` | **`azp`**, falling back to `aud` | Pins the **calling workload** |
| `…/v2.0:oaud` | `aud` | Pins the **target audience** |
| `…/v2.0:sub` | `sub` | Pins the **principal** |

Condition key names are the provider URL **minus the scheme**, then `:claim` — e.g. `login.microsoftonline.com/{tenantId}/v2.0:sub`.

### 4.1 What you cannot use

**`oid`, `appid` and `tid` are not available as condition keys.** AWS ignores non-standard claims. A condition written on `…:tid` will never match — and if it is the only restriction on an `Allow`, the role becomes unassumable; written carelessly on a `Deny`, it does nothing at all.

**The tenant is pinned by the issuer**, which is embedded in the `Principal.Federated` ARN. That is the correct and complete mechanism; no `tid` condition is needed or possible.

### 4.2 The audience trap

AWS documents this explicitly: *if the token contains `azp`, AWS STS uses `azp` as the audience.* Entra v2.0 tokens carry both `aud` and `azp`.

So the **IAM OIDC provider audience must be the managed identity's client ID**, not the app registration's. Getting this backwards produces `InvalidIdentityToken: Incorrect token audience`.

**Hedge:** an IAM OIDC provider accepts up to 100 audiences. Register **both** GUIDs. It costs nothing and makes the deployment robust if `azp` turns out not to be emitted for this token type. The `:aud` *condition*, however, must still be set to whichever value the real token actually produces — which is why §3.4 records it.

### 4.3 The `sub` contradiction

Microsoft's documentation says two incompatible things:

- The federated-identity-credential page states `subject` is the **object (principal) ID** of the managed identity — implying it is audience-independent.
- The access token claims reference states `sub` is *"a pairwise identifier that's unique to a particular application ID"* — implying it **varies by audience** and is not the object ID.

Both cannot be generally true, and no normative statement covers the app-only-token-to-a-custom-audience case.

**This does not block the design.** Either way, `sub` is *stable* for a fixed (managed identity, resource) pair, so it pins trust correctly. What it does mean is that **the value must be read, never assumed** — and it is case-sensitive.

### Observed 10 August 2026 — and the limit of what it proves

For the staging token, **`sub` == `oid`** (`6633a4a6-a29c-4594-a14e-90e75e12e760`). On this evidence the federated-credential page's account is the operative one: `sub` is the managed identity's object ID.

**But one observation against one audience cannot distinguish the two readings.** A pairwise identifier would only reveal itself by *changing* when the audience changes — and there has only ever been one audience here. The claims reference may still be right in general, with this token being a case where the two coincide.

So the operational rule stands, and is now sharper: **if the app registration used as the audience is ever replaced, rotated, or a second one introduced, re-run §3 and re-read `sub` before touching the trust policy.** Assuming it carries over is the exact mistake this section exists to prevent.

### 4.4 Why v2.0 and not v1.0

| | v1.0 | **v2.0** |
|---|---|---|
| Issuer | `https://sts.windows.net/{tid}/` — **trailing slash** | `https://login.microsoftonline.com/{tid}/v2.0` |
| Signing keys | `common` key set — **not tenant-scoped** | Tenant-scoped |
| `azp` claim | Absent | Present |

AWS requires `iss` to correspond to the registered provider URL, and IAM stores provider URLs without a trailing slash. Beyond that, v1.0's signing keys are not tenant-bound, so only the issuer *string* would scope the trust. **Use v2.0.**

### 4.5 The resulting trust policy shape

For reference only — the actual policy is created in Milestone 3B, from observed values.

```json
{
  "Principal": { "Federated": "arn:aws:iam::{acct}:oidc-provider/login.microsoftonline.com/{tenantId}/v2.0" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": { "StringEquals": {
    "login.microsoftonline.com/{tenantId}/v2.0:aud":  "{OBSERVED azp}",
    "login.microsoftonline.com/{tenantId}/v2.0:oaud": "{app registration client ID}",
    "login.microsoftonline.com/{tenantId}/v2.0:sub":  "{OBSERVED sub}"
  }}
}
```

Four independent pins: tenant (issuer), workload (`aud`), audience (`oaud`), principal (`sub`). This is not "any identity in the tenant" — `aud` alone already narrows to one managed identity.

---

## 5. Credential ambiguity checks

**Milestone 3A.2. Complete before any federation testing.**

The failure this prevents is the most dangerous state in the whole deployment:

```
  Federation is broken
        │
  A forgotten AWS key is still present
        │
  The SDK silently uses the key          ← fromEnv is FIRST in the credential chain
        │
  Bedrock responds, everything looks green
        │
  Nobody notices for months
```

Every identity check would pass. The architecture would be entirely fictional.

### 5.1 Sources to eliminate

The AWS SDK credential chain resolves in this order. **Anything earlier than web-identity can mask a broken federation.**

| # | Source | How to check | Required state |
|---|---|---|---|
| 1 | Environment variables | App Service → Configuration; and `env \| grep -i aws` in Kudu | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` **all absent** |
| 2 | Shared credentials file | `ls -la ~/.aws/` in the app's runtime user | No `credentials` file |
| 3 | Shared config file | `ls -la ~/.aws/` | No `config` file with credentials |
| 4 | `AWS_PROFILE` | `env \| grep AWS_PROFILE` | Unset |
| 5 | SSO cache | `ls -la ~/.aws/sso/` | Absent |
| 6 | Container/EC2 metadata | n/a on App Service | Not reachable |
| 7 | Key Vault references resolving to keys | Review every Key Vault reference in App Settings | None resolve to an AWS key |
| 8 | Deployment pipeline variables | Review the pipeline definition | No AWS key injected at deploy time |

**Permitted AWS-related settings:** `AWS_REGION`, `AWS_ROLE_ARN`, `AZURE_BEDROCK_AUDIENCE`, `AWS_ROLE_SESSION_NAME`. Nothing else. (`AWS_FED_*` and `AI_AWS_REGION` appeared in earlier drafts and are not read by the application — see `backend/ai/aws/bedrock-config.js`, which owns and validates every Bedrock setting.)

### 5.2 Record

| Check | Result | Evidence |
|---|---|---|
| ☐ No AWS key in App Settings | | |
| ☐ No AWS key in the running process env | | |
| ☐ No `~/.aws/` directory or files | | |
| ☐ `AWS_PROFILE` unset | | |
| ☐ No Key Vault reference resolves to an AWS key | | |
| ☐ No pipeline variable injects an AWS key | | |
| ☐ Only the permitted `AWS_*` settings present | | |

### 5.3 Also check the developer machines

A key in a developer's shell does not affect production, but it does mean local testing proves nothing about federation. Anyone validating this work locally should confirm the same absence, or knowingly accept that their local result is not evidence.

---

## 6. Acceptance criteria

**Federation must be proven to work with no static AWS credential available to the process.** Proving that it *works* is not sufficient on its own — you must also prove it *stops working* when federation is broken, because that is the only way to know federation was doing the work.

### 6.1 Gate — identity discovery (this document)

| | Criterion |
|---|---|
| ☐ | All identifiers in §2 recorded, with each GUID's type unambiguous |
| ☐ | Token successfully obtained on the App Service |
| ☐ | All six §3.5 gate conditions met |
| ☐ | `sub` and `azp` recorded verbatim |
| ☐ | Full claim list recorded |
| ☐ | Every §5.2 credential-ambiguity check passed |
| ☐ | No token value written to any document, ticket or chat |

### 6.2 Gate — federation proof (Milestone 3B, recorded here for completeness)

The two-directional test. **Both halves are required.**

| | Criterion |
|---|---|
| ☐ | **Negative:** with federation deliberately broken (e.g. `AWS_FED_ROLE_ARN` pointed at a non-existent role), a clinical generation attempt **fails** |
| ☐ | **Positive:** with federation restored, the same attempt **succeeds** |
| ☐ | CloudTrail shows `AssumeRoleWithWebIdentity` events from the federated principal |
| ☐ | The assumed role in a Bedrock call is `OpalClinicalAIRuntimeRole` |
| ☐ | STS credential `Expiration` is ~1 hour |
| ☐ | Ten generations produce **one** `AssumeRoleWithWebIdentity` event, not ten |

The negative half is the one people skip, and it is the only one that detects the stale-key scenario in §5. A positive result alone is compatible with federation being entirely broken.

### 6.3 What this does not prove

Stated so nobody over-reads a green result:

- **Nothing about where inference ran.** That is CloudTrail `additionalEventData.inferenceRegion`, tested separately.
- **Nothing about model restrictions.** Tested in the acceptance test §B.
- **Nothing about the application boundary.** Already proven; unaffected by this work.

---

## 7. Known unknowns entering Milestone 3B

Three of the five open items from the runbook are resolved by §3 alone.

| # | Unknown | Resolved by |
|---|---|---|
| ~~1~~ | ~~Whether Entra emits `azp`~~ | **RESOLVED 10 Aug 2026.** It does. IAM audience = `688e00e2-…` (the managed identity), not the app registration |
| ~~2~~ | ~~What `sub` contains~~ | **RESOLVED for this audience.** `sub` == `oid`. Re-observe if the audience app registration ever changes — see §4.3 |
| ~~3~~ | ~~Whether the MI needs an app-role assignment~~ | **RESOLVED.** It does not — the token request succeeded without one |
| 4 | Whether AWS enforces `subject_types_supported: public` (Entra advertises `pairwise`) | **Not resolved here.** Creating the OIDC provider in a non-production account |
| 5 | End-to-end behaviour against live STS and Bedrock | **Not resolved here.** Milestone 3B in a non-production account |

Items 4 and 5 need a non-production AWS account. Neither is a reason to delay §3 — run the diagnostic first, because if item 1 or 2 comes back unexpectedly, the trust policy you would otherwise have written was wrong.

---

## Sign-off

| | |
|---|---|
| Date completed | |
| Performed by | |
| Reviewed by | |

**Outcome:** ☐ Identity established — proceed to 3A.2 / 3B ☐ Blocked — record below

| Blocker | Detail |
|---|---|
| | |
