# AI Security Acceptance Test

| | |
|---|---|
| **Version** | 1.0 |
| **Effective date** | 10 August 2026 |
| **Owner** | Opal Therapy Pty Ltd |
| **Classification** | Internal — Security Acceptance |
| **Governed by** | [`AI_SECURITY_ARCHITECTURE.md`](AI_SECURITY_ARCHITECTURE.md) |
| **Preceded by** | [`AWS_AI_DEPLOYMENT_RUNBOOK.md`](AWS_AI_DEPLOYMENT_RUNBOOK.md) |

**This must pass in full before any therapist uses AI on real client data.** A partial pass is a fail. If a check cannot be performed, it is a fail — record why rather than marking it not-applicable.

**Use synthetic data only.** Every test below runs against a fabricated client. Using a real client note to test the boundary is precisely the behaviour the boundary exists to prevent.

---

## Run details

| | |
|---|---|
| Date | |
| Environment | ☐ Staging ☐ Production |
| Application version / commit | |
| `@anthropic-ai/bedrock-sdk` version | |
| AWS account id | |
| Performed by | |

---

## A. Identity — no standing credentials

| # | Check | How to verify | Pass criterion |
|---|---|---|---|
| A1 | ☐ No AWS keys in application configuration | Inspect App Service settings, Key Vault, pipeline variables, `.env` | `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are **absent everywhere** |
| A2 | ☐ No AWS keys in the running process | Kudu console: `env \| grep -i aws` | Only `AWS_REGION` and the `AWS_FED_*` settings appear. No key, no secret, no session token |
| A3 | ☐ App obtains temporary credentials | CloudTrail: filter `eventName = AssumeRoleWithWebIdentity` | Events present, principal is the federated identity |
| A4 | ☐ Credentials are short-lived | Inspect an `AssumeRoleWithWebIdentity` response element | `Expiration` ≈ 1 hour from issue |
| A5 | ☐ IAM role confirmed | CloudTrail `userIdentity` on a Bedrock call | `arn:aws:sts::{acct}:assumed-role/OpalClinicalAIRuntimeRole/...` |
| A6 | ☐ Credentials are memoised, not per-request | Generate **10** case notes, then count `AssumeRoleWithWebIdentity` events in that window | **1 event, not 10.** Per-request assumes mean the memoisation in runbook §7.4 is not working |
| A7 | ☐ Role cannot widen itself | IAM policy simulator on `OpalClinicalAIRuntimeRole` for `iam:*`, `s3:*`, `bedrock:PutAccountDataRetention`, `aws-marketplace:Subscribe` | All **denied** |

> **A1 and A2 are the two most likely false passes in this document.** `fromEnv` is first in the AWS credential chain, so a stale key would make everything below appear to work while federation is silently broken.

---

## B. Model restrictions

| # | Check | How to verify | Pass criterion |
|---|---|---|---|
| B1 | ☐ Sonnet 4.6 works | Generate a synthetic case note with `CLINICAL_NOTE_MODEL` policy default set to `clinical_standard` | Draft produced; `ai_interactions.model_id = au.anthropic.claude-sonnet-4-6` |
| B2 | ☐ Opus 4.8 works | Same with `clinical_complex` | Draft produced; `model_id = au.anthropic.claude-opus-4-8` |
| B3 | ☐ Unapproved model denied | `gateway.evaluate({feature:'clinical_note_generation', modelKey:'au.anthropic.claude-sonnet-5'})` | `ok: false`, reason `model_not_permitted_for_feature:...` |
| B4 | ☐ Global profile denied | Same with `global.anthropic.claude-opus-4-8` | `ok: false` |
| B5 | ☐ apac profile denied | Same with `apac.anthropic.claude-sonnet-4-6` | `ok: false` — apac also reaches Tokyo, Seoul, Osaka, Mumbai, Hyderabad, Singapore |
| B6 | ☐ Retention-mandating models denied at AWS | AWS CLI: attempt `bedrock:InvokeModel` on a Fable 5 profile using the runtime role | `AccessDenied` from IAM, not merely refused by the app |
| B7 | ☐ IAM resource list matches the registry | Compare the role's `Resource` array against `ai-model-registry.js` | Exactly the four profile ARNs + four foundation-model ARNs; nothing extra |

---

## C. Geography

| # | Check | How to verify | Pass criterion |
|---|---|---|---|
| C1 | ☐ CloudTrail confirms Australian inference | Generate a synthetic note; find its `provider_request_id` in `ai_interactions`; locate that request in CloudTrail | `additionalEventData.inferenceRegion` is `ap-southeast-2` **or** `ap-southeast-4` |
| C2 | ☐ Non-AU region denied by the app | Set `AWS_REGION=us-east-1`, attempt generation | Denied, reason `region_not_permitted`. **Nothing transmitted** |
| C3 | ☐ Non-AU region denied by AWS | With the runtime role, attempt `bedrock:InvokeModel` in `us-east-1` | `AccessDenied` from the SCP — the app is not the only control |
| C4 | ☐ Endpoint is pinned in code | Set `ANTHROPIC_BEDROCK_BASE_URL` to a us-east-1 host; restart; run the self-check | Boundary check **fails**, AI disabled. The variable name appears in `boundary_failures`; its **value does not** |
| C5 | ☐ Bedrock invocation logging is off | `aws bedrock get-model-invocation-logging-configuration --region ap-southeast-2` | Not configured, or explicitly disabled |
| C6 | ☐ CloudTrail is on, all regions, validated | Trail configuration | Multi-region, log file validation enabled, S3 encrypted |

> **C1 is the check that proves the entire architecture.** `source_region` in the application database records where the request was *sent from*; only CloudTrail records where it *ran*.

---

## D. Governance

| # | Check | How to verify | Pass criterion |
|---|---|---|---|
| D1 | ☐ Clinical document creates an audit reservation | Generate a synthetic note; inspect `ai_interactions` | Row exists with `status='generated'`, `output_type='clinical_document'`, `review_required=true`, `review_status='review_required'` |
| D2 | ☐ The interaction is attributable to a person | Same row | `user_id` is the therapist's id, **not null**. `organisation_id` populated |
| D3 | ☐ The draft links to the interaction | `case_note_drafts.ai_interaction_id` | Matches `ai_interactions.id`; `generation_source='ai_assisted'` |
| D4 | ☐ Failed audit blocks generation | Temporarily revoke `INSERT` on `ai_interactions` from the app's database role; attempt generation | Denied, reason `audit_unavailable`. **Nothing transmitted.** Restore the grant afterwards |
| D5 | ☐ Human review is required | Inspect a fresh draft via the API | `reviewStatus: 'review_required'`; nothing auto-approves |
| D6 | ☐ Review records the reviewer | `POST /api/mobile/case-note-drafts/:id/review` with `{"decision":"approved"}` | Draft **and** interaction both show `approved`, with `reviewed_by` and `reviewed_at` set on each |
| D7 | ☐ Another therapist cannot approve | Attempt D6 as a different user | `404` — and the interaction is unchanged |
| D8 | ☐ Regeneration voids a prior approval | Approve a draft, then regenerate it | `review_status` returns to `review_required`; `reviewed_by`/`reviewed_at` cleared; `ai_interaction_id` points at the **new** interaction |
| D9 | ☐ No clinical content in the audit trail | `SELECT * FROM ai_interactions ORDER BY created_at DESC LIMIT 20;` | No prompt, transcript, note text or client name in any column |
| D10 | ☐ No clinical content in application logs | Search the Azure log stream for a distinctive phrase from the synthetic transcript | **Zero matches** |
| D11 | ☐ Debug logging cannot leak content | Set `ANTHROPIC_LOG=debug`, restart, generate a note, search logs for the synthetic phrase | **Zero matches** — the provider pins a silent logger |

---

## E. Emergency controls

| # | Check | How to verify | Pass criterion |
|---|---|---|---|
| E1 | ☐ Database kill switch disables AI | `UPDATE system_settings SET value='false', reason='acceptance test', updated_by='<id>' WHERE key='ai_global_enabled';` then attempt generation within 30s | Denied, reason `ai_globally_disabled:setting` |
| E2 | ☐ The disable is recorded | `SELECT * FROM ai_security_events ORDER BY created_at DESC LIMIT 1;` | `event_type='ai_disabled'`, `previous_state='enabled'`, `new_state='disabled'`, reason and actor present |
| E3 | ☐ Re-enabling is recorded | Set back to `'true'` with a reason | `event_type='ai_enabled'` row appears |
| E4 | ☐ The database refuses a malformed value | `UPDATE system_settings SET value='OFF' WHERE key='ai_global_enabled';` | **Constraint violation.** The write fails rather than appearing to succeed |
| E4b | ☐ A malformed value that does get through fails safe | Temporarily drop `system_settings_ai_global_bool_chk`, set `'OFF'`, attempt generation, then restore the constraint | AI **disabled**; an `invalid_kill_switch_value` row appears in `ai_security_events` naming the offending value |
| E5 | ☐ Env kill switch works without the database | Set `AI_GLOBAL_DISABLE=true`, restart | All AI denied, reason `ai_globally_disabled:env` |
| E6 | ☐ Per-feature flags work | Set `CLINICAL_NOTE_AI_ENABLED=false` | Case notes denied; Opa unaffected |
| E7 | ☐ Failure keeps the user's work | With AI disabled, attempt a case note from the mobile app | Clear error, transcript retained and savable. **No data loss** |
| E8 | ☐ Boot self-check reports and gates | Restart; read the startup log | `AI SECURITY CHECK` block printed, all ✓, `AI READY` |
| E9 | ☐ Health endpoint is accurate and safe | `GET /api/ai/security-status` as owner/admin | Reflects the true current state; contains **no** credentials, client data or identifiers |
| E10 | ☐ Health endpoint is access-controlled | Same request as a therapist, and unauthenticated | `403` and `401` respectively |

---

## F. Development controls

| # | Check | How to verify | Pass criterion |
|---|---|---|---|
| F1 | ☐ CI blocks a direct SDK import | Add `require('@anthropic-ai/sdk')` to a file under `backend/fca/`; run the suite | `tests/ai-gateway-boundary.test.js` **fails**. Remove afterwards |
| F2 | ☐ CI blocks a raw model literal | Add `const m = 'claude-opus-4-8';` to a feature module; run the suite | Boundary test **fails**. Remove afterwards |
| F3 | ☐ CI blocks a vendor endpoint | Add `'https://api.anthropic.com'` to a feature module; run the suite | Boundary test **fails**. Remove afterwards |
| F4 | ☐ Full suite green | `npm test` | All suites pass |

---

## FC. False confidence tests

**The most dangerous outcome of this document is a clean pass on a system that is not actually protected.** Every other section asks "does the control work?". This section asks "is the evidence real?" — because the failures most likely to reach production are the ones where something else quietly stands in for the control you meant to test.

Run these **last**, after everything above has passed.

| # | Check | How to verify | Pass criterion |
|---|---|---|---|
| FC1 | ☐ Application metadata is not accepted as proof of inference location | Generate a synthetic note. Record `ai_interactions.source_region`. Independently look up its `provider_request_id` in CloudTrail | **Both** consulted. `source_region` records where the request was *sent from*; only CloudTrail's `additionalEventData.inferenceRegion` records where it *ran*. A pass requires the CloudTrail value to be Australian — the application's own field is **not** evidence and must never be cited as such |
| FC2 | ☐ Federation is genuinely in use, not masked by a stale key | 1. Confirm no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` anywhere. 2. Temporarily break federation (e.g. point `AWS_FED_ROLE_ARN` at a non-existent role). 3. Attempt generation. 4. Restore | Step 3 **fails**. If it succeeds, something other than federation is supplying credentials — `fromEnv` is first in the AWS chain, so a forgotten key would make every check in section A pass while the identity architecture is broken |
| FC3 | ☐ The boundary guard can actually fail | Add `require('@anthropic-ai/sdk')` to a file under `backend/fca/`; run the suite; remove it | Suite **fails**, then passes again. A guard nobody has seen fail is a guard nobody has tested |
| FC4 | ☐ The self-check can actually fail | Set `ANTHROPIC_BEDROCK_BASE_URL` to any value; restart; observe startup output; unset and restart | Startup prints `AI DISABLED` with the failing check named, and AI is denied. A check that always passes proves nothing |
| FC5 | ☐ The kill switch stops generation, not just reporting | With AI disabled by E1, attempt an actual case-note generation from the mobile app — do not rely on the status endpoint | Generation **blocked**. The health endpoint agreeing that AI is off is not the same as AI being off |

> **FC2 is the single most likely false pass in this document.** A stale AWS key satisfies every identity check in section A while federation is entirely broken, and nothing else would reveal it.

---

## Result

| | |
|---|---|
| Checks passed | ___ / 51 |
| Failures (list by id) | |
| Deviations accepted, with reason | |

**Outcome:** ☐ PASS — approved for clinical use ☐ FAIL — remediate and re-run

| Role | Name | Signature | Date |
|---|---|---|---|
| Performed by | | | |
| Approved by (practice owner) | | | |

---

### Re-run triggers

Re-run this test in full when any of the following changes: the approved model registry · a feature policy · the AWS IAM role or SCP · the AWS account or region · the Bedrock SDK major version · the federation configuration · the style prompt or output schema of a clinical feature.

Otherwise re-run at each 6-month architecture review.
